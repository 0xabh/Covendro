import type { FastifyInstance } from "fastify";
import { requireWorkspaceUser } from "../services/workspace-access.js";
import { csvToList } from "@covendro/shared";
import { prisma } from "../db/prisma.js";


function csvValue(value: unknown) {
  const raw = value === null || value === undefined ? "" : String(value);
  const text = /^[\s\uFEFF]*[=+@-]|^[\t\r\n]/.test(raw) ? "'" + raw : raw;
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function csv(rows: Array<Record<string, unknown>>, columns: string[]) {
  return [columns.join(","), ...rows.map((row) => columns.map((column) => csvValue(row[column])).join(","))].join("\n") + "\n";
}

async function ledgerRows(organizationId: string) {
  return prisma.ledgerEntry.findMany({ where: { invoice: { organizationId } }, include: { invoice: { include: { vendor: true } }, payment: true }, orderBy: { createdAt: "desc" } });
}

function ledgerResponse(entry: Awaited<ReturnType<typeof ledgerRows>>[number]) {
  return {
    id: entry.id,
    invoiceId: entry.invoiceId,
    invoiceNumber: entry.invoice.invoiceNumber,
    vendor: entry.invoice.vendor.name,
    grossAmountMinor: entry.grossAmountMinor,
    currency: entry.currency,
    paymentStatus: entry.paymentStatus,
    paymentRail: entry.paymentRail,
    quoteId: entry.quoteId,
    transactionHash: entry.transactionHash,
    refundStatus: entry.refundStatus,
    createdAt: entry.createdAt,
    approvedAt: entry.approvedAt,
    paidAt: entry.paidAt,
    paymentId: entry.paymentId,
    quoteMode: entry.payment?.quoteMode ?? null,
  };
}

const ledgerColumns = ["invoiceId", "invoiceNumber", "vendor", "grossAmount", "currency", "paymentStatus", "paymentRail", "quoteMode", "quoteId", "transactionHash", "refundStatus", "createdAt", "approvedAt", "paidAt"];

export function registerReportingRoutes(app: FastifyInstance) {
  app.get("/api/ledger", async (request) => {
    const user = await requireWorkspaceUser(request, "submitter@covendro.local");
    return { data: (await ledgerRows(user.organizationId)).map(ledgerResponse) };
  });

  app.get("/api/ledger.csv", async (request, reply) => {
    const user = await requireWorkspaceUser(request, "submitter@covendro.local");
    const rows = (await ledgerRows(user.organizationId)).map((entry) => {
      const item = ledgerResponse(entry);
      return { invoiceId: item.invoiceId, invoiceNumber: item.invoiceNumber, vendor: item.vendor, grossAmount: `${item.currency} ${(item.grossAmountMinor / 100).toFixed(2)}`, currency: item.currency, paymentStatus: item.paymentStatus, paymentRail: item.paymentRail, quoteMode: item.quoteMode, quoteId: item.quoteId, transactionHash: item.transactionHash, refundStatus: item.refundStatus, createdAt: item.createdAt.toISOString(), approvedAt: item.approvedAt?.toISOString() ?? "", paidAt: item.paidAt?.toISOString() ?? "" };
    });
    return reply.type("text/csv; charset=utf-8").header("content-disposition", "attachment; filename=covendro-ledger.csv").send(csv(rows, ledgerColumns));
  });

  app.get<{ Querystring: { eventType?: string; invoiceId?: string; limit?: string } }>("/api/audit-events", async (request) => {
    const user = await requireWorkspaceUser(request, "submitter@covendro.local");
    const parsedLimit = Number(request.query.limit ?? 100);
    const limit = Number.isFinite(parsedLimit) ? Math.min(Math.max(Math.floor(parsedLimit), 1), 500) : 100;
    const events = await prisma.auditEvent.findMany({ where: { organizationId: user.organizationId, eventType: request.query.eventType, invoiceId: request.query.invoiceId }, include: { actor: true, invoice: { select: { invoiceNumber: true } }, payment: { select: { id: true, quoteId: true } } }, orderBy: { createdAt: "desc" }, take: limit });
    return { data: events };
  });

  app.get("/api/audit-events.csv", async (request, reply) => {
    const user = await requireWorkspaceUser(request, "submitter@covendro.local");
    const events = await prisma.auditEvent.findMany({ where: { organizationId: user.organizationId }, include: { actor: true, invoice: { select: { invoiceNumber: true } }, payment: { select: { id: true } } }, orderBy: { createdAt: "desc" } });
    const rows = events.map((event) => ({ id: event.id, createdAt: event.createdAt.toISOString(), eventType: event.eventType, description: event.description, invoiceNumber: event.invoice?.invoiceNumber ?? "", paymentId: event.payment?.id ?? "", actor: event.actor?.email ?? "", requestId: event.requestId ?? "" }));
    return reply.type("text/csv; charset=utf-8").header("content-disposition", "attachment; filename=covendro-audit.csv").send(csv(rows, ["id", "createdAt", "eventType", "description", "invoiceNumber", "paymentId", "actor", "requestId"]));
  });

  app.get("/api/dashboard", async (request) => {
    const user = await requireWorkspaceUser(request, "submitter@covendro.local");
    const [invoices, recentActivity, policy, treasuryIdentity] = await Promise.all([
      prisma.invoice.findMany({ where: { organizationId: user.organizationId }, select: { id: true, status: true, amountMinor: true, vendorRiskDecision: true, policyDecision: true, currency: true } }),
      prisma.auditEvent.findMany({ where: { organizationId: user.organizationId }, include: { actor: true, invoice: { select: { invoiceNumber: true } } }, orderBy: { createdAt: "desc" }, take: 8 }),
      prisma.treasuryPolicy.findFirst({ where: { organizationId: user.organizationId, active: true }, orderBy: { version: "desc" } }),
      prisma.treasuryIdentity.findFirst({ where: { organizationId: user.organizationId }, orderBy: { createdAt: "asc" } }),
    ]);
    const pendingStatuses = new Set(["DRAFT", "EXTRACTED", "REVIEW_REQUIRED", "APPROVED", "QUOTE_REQUESTED", "QUOTE_READY", "PAYMENT_PENDING"]);
    const approvedStatuses = new Set(["APPROVED", "QUOTE_REQUESTED", "QUOTE_READY", "PAYMENT_PENDING"]);
    return { data: { pendingInvoices: invoices.filter((invoice) => pendingStatuses.has(invoice.status)).length, approvedAmountMinor: invoices.filter((invoice) => approvedStatuses.has(invoice.status)).reduce((total, invoice) => total + invoice.amountMinor, 0), paidAmountMinor: invoices.filter((invoice) => invoice.status === "PAID").reduce((total, invoice) => total + invoice.amountMinor, 0), warningCount: invoices.filter((invoice) => invoice.vendorRiskDecision === "WARN" || invoice.policyDecision === "WARN").length, blockedCount: invoices.filter((invoice) => invoice.status === "BLOCKED" || invoice.vendorRiskDecision === "BLOCK" || invoice.policyDecision === "BLOCK").length, recentActivity, currentPolicy: policy ? { version: policy.version, demoMode: policy.demoMode, freezePayments: policy.freezePayments, allowedCurrencies: csvToList(policy.allowedCurrenciesCsv), allowedChains: csvToList(policy.allowedChainsCsv) } : null, treasuryIdentity } };
  });
}
