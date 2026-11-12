import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import {
  invoiceInputSchema,
  lineItemToMinorUnits,
  sourceDocumentSchema,
  toMinorUnits,
  type InvoiceInput,
} from "@covendro/shared";
import { prisma } from "../db/prisma.js";
import { ApiError } from "../errors.js";
import { getDemoUser } from "../repositories/organization-repository.js";
import { parseSourceDocument } from "../services/document-parser.js";
import { analyzeInvoice } from "../services/ai/invoice-analysis-service.js";

const fixturesDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../fixtures");

function getUserEmail(request: { headers: Record<string, unknown> }) {
  const header = request.headers["x-demo-user-email"];
  return typeof header === "string" && header.length > 0 ? header : "submitter@covendro.local";
}

async function requireDemoUser(request: { headers: Record<string, unknown> }) {
  const user = await getDemoUser(getUserEmail(request));
  if (!user) throw new ApiError(401, "DEMO_USER_NOT_FOUND", "Choose a seeded demo user before creating invoices");
  return user;
}

function parseDate(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

function buildFileHash(content?: string) {
  return content ? createHash("sha256").update(content, "utf8").digest("hex") : undefined;
}

function validationDetails(error: { issues: Array<{ path: readonly PropertyKey[]; message: string }> }) {
  return error.issues.map((issue) => ({ path: issue.path.map(String), message: issue.message }));
}

function normalizeInput(input: InvoiceInput) {
  return {
    invoiceDate: parseDate(input.invoiceDate),
    dueDate: input.dueDate ? parseDate(input.dueDate) : undefined,
    amountMinor: toMinorUnits(input.amount),
    lineItems: input.lineItems.map((item) => ({
      description: item.description,
      quantity: Number(item.quantity),
      unitAmountMinor: toMinorUnits(item.unitAmount),
      totalAmountMinor: lineItemToMinorUnits(item),
    })),
  };
}

export function registerInvoiceRoutes(app: FastifyInstance) {
  app.post<{ Body: unknown }>("/api/invoices/parse-document", async (request) => {
    const parsedBody = sourceDocumentSchema.safeParse(request.body);
    if (!parsedBody.success) {
      throw new ApiError(422, "DOCUMENT_VALIDATION_FAILED", "The uploaded document could not be processed", validationDetails(parsedBody.error));
    }

    try {
      const parsedDocument = await parseSourceDocument(parsedBody.data);
      return { data: parsedDocument };
    } catch {
      throw new ApiError(422, "DOCUMENT_PARSE_FAILED", "The document could not be parsed. Try a text file or enter the fields manually.");
    }
  });

  app.get("/api/invoices/fixtures", async () => {
    const names = ["sample-invoice-001.json", "sample-invoice-002.json", "suspicious-invoice.json"];
    const fixtures = await Promise.all(names.map(async (name) => ({
      name,
      invoice: JSON.parse(await readFile(path.join(fixturesDirectory, name), "utf8")),
    })));
    return { data: fixtures };
  });

  app.get<{ Params: { name: string } }>("/api/invoices/fixtures/:name", async (request) => {
    const safeName = path.basename(request.params.name);
    if (!safeName.endsWith(".json")) throw new ApiError(400, "INVALID_FIXTURE", "Only JSON fixtures are supported");

    try {
      const content = await readFile(path.join(fixturesDirectory, safeName), "utf8");
      return { data: { name: safeName, invoice: JSON.parse(content) } };
    } catch {
      throw new ApiError(404, "FIXTURE_NOT_FOUND", "Invoice fixture was not found");
    }
  });

  app.get("/api/invoices", async (request) => {
    const user = await requireDemoUser(request);
    const invoices = await prisma.invoice.findMany({
      where: { organizationId: user.organizationId },
      include: { vendor: true, lineItems: true, createdBy: true },
      orderBy: { createdAt: "desc" },
    });
    return { data: invoices };
  });

  app.post<{ Body: unknown }>("/api/invoices", async (request, reply) => {
    const parsed = invoiceInputSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ApiError(422, "INVOICE_VALIDATION_FAILED", "Invoice fields need attention", validationDetails(parsed.error));
    }

    const user = await requireDemoUser(request);
    const input = parsed.data;
    const normalized = normalizeInput(input);
    const vendor = await prisma.vendor.upsert({
      where: {
        organizationId_accountAddress: {
          organizationId: user.organizationId,
          accountAddress: input.vendorAddress,
        },
      },
      update: { name: input.vendorName, accountChain: input.vendorChain },
      create: {
        organizationId: user.organizationId,
        name: input.vendorName,
        accountAddress: input.vendorAddress,
        accountChain: input.vendorChain,
      },
    });

    const duplicate = await prisma.invoice.findFirst({
      where: {
        organizationId: user.organizationId,
        vendorId: vendor.id,
        invoiceNumber: input.invoiceNumber,
      },
      select: { id: true },
    });
    if (duplicate) {
      throw new ApiError(409, "DUPLICATE_INVOICE", "This invoice number already exists for this vendor", { invoiceId: duplicate.id });
    }

    const invoice = await prisma.invoice.create({
      data: {
        organizationId: user.organizationId,
        vendorId: vendor.id,
        createdById: user.id,
        status: "DRAFT",
        invoiceNumber: input.invoiceNumber,
        invoiceDate: normalized.invoiceDate,
        dueDate: normalized.dueDate,
        currency: input.currency,
        amountMinor: normalized.amountMinor,
        paymentDestination: input.paymentDestination,
        paymentChain: input.paymentChain ?? input.vendorChain,
        memo: input.memo,
        fileHash: buildFileHash(input.sourceDocument?.content),
        fileType: input.sourceDocument?.fileType,
        lineItems: { create: normalized.lineItems },
        auditEvents: {
          create: {
            organizationId: user.organizationId,
            actorId: user.id,
            eventType: "INVOICE_UPLOADED",
            description: "Invoice uploaded and saved as a draft",
            metadataJson: JSON.stringify({ fileType: input.sourceDocument?.fileType ?? "manual-entry" }),
            requestId: request.id,
          },
        },
      },
      include: { vendor: true, lineItems: true, createdBy: true },
    });

    return reply.code(201).send({ data: invoice });
  });

  app.get<{ Params: { id: string } }>("/api/invoices/:id", async (request) => {
    const user = await requireDemoUser(request);
    const invoice = await prisma.invoice.findFirst({
      where: { id: request.params.id, organizationId: user.organizationId },
      include: { vendor: true, lineItems: true, createdBy: true, approvals: { orderBy: { createdAt: "desc" }, include: { reviewer: true } }, payment: true, auditEvents: { orderBy: { createdAt: "desc" } } },
    });
    if (!invoice) throw new ApiError(404, "INVOICE_NOT_FOUND", "Invoice was not found");
    return { data: invoice };
  });

  app.post<{ Params: { id: string } }>("/api/invoices/:id/analyze", async (request) => {
    const user = await requireDemoUser(request);
    const result = await analyzeInvoice(request.params.id, user.organizationId, request.id);
    return { data: result };
  });
}
