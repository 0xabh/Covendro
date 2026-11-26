import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db/prisma.js";
import { ApiError } from "../errors.js";
import { requireWorkspaceUser } from "../services/workspace-access.js";
import { readPayableTerms, hashPayableTerms } from "../services/payable-terms.js";
import { approveInvoice, rejectInvoice, resubmitInvoice, submitInvoice } from "../services/workflow-service.js";

const rejectionSchema = z.object({ reason: z.string().trim().min(3, "Rejection reason is required").max(500) });


function idempotencyKey(request: { headers: Record<string, unknown> }) {
  const value = request.headers["idempotency-key"];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function validationDetails(error: { issues: Array<{ path: readonly PropertyKey[]; message: string }> }) {
  return error.issues.map((issue) => ({ path: issue.path.map(String), message: issue.message }));
}

export function registerWorkflowRoutes(app: FastifyInstance) {
  app.post<{ Params: { id: string } }>("/api/invoices/:id/submit", async (request) => {
    const user = await requireWorkspaceUser(request, "submitter@covendro.local");
    const result = await submitInvoice(request.params.id, user, request.id);
    return { data: result };
  });

  app.post<{ Params: { id: string } }>("/api/invoices/:id/resubmit", async (request) => {
    const user = await requireWorkspaceUser(request, "submitter@covendro.local");
    const result = await resubmitInvoice(request.params.id, user, request.id);
    return { data: result };
  });

  app.get<{ Params: { id: string } }>("/api/invoices/:id/payable-terms", async (request) => {
    if (process.env.DEMO_MODE !== "false") throw new ApiError(404, "ROUTE_UNAVAILABLE", "Payable terms are available in pilot workspaces");
    const user = await requireWorkspaceUser(request);
    if (!["REVIEWER", "TREASURY_ADMINISTRATOR"].includes(user.role)) throw new ApiError(403, "REVIEWER_REQUIRED", "Reviewer access is required");
    const invoice = await prisma.invoice.findFirst({ where: { id: request.params.id, organizationId: user.organizationId } });
    if (!invoice) throw new ApiError(404, "INVOICE_NOT_FOUND", "Invoice was not found");
    const terms = await readPayableTerms(prisma, invoice);
    return { data: { terms, termsHash: hashPayableTerms(JSON.stringify(terms)) } };
  });

  app.post<{ Params: { id: string }; Body: { termsHash?: string } }>("/api/invoices/:id/approve", async (request) => {
    const user = await requireWorkspaceUser(request, "submitter@covendro.local");
    const result = await approveInvoice(request.params.id, user, request.id, idempotencyKey(request), request.body?.termsHash);
    return { data: result };
  });

  app.post<{ Params: { id: string }; Body: unknown }>("/api/invoices/:id/reject", async (request) => {
    const parsed = rejectionSchema.safeParse(request.body);
    if (!parsed.success) throw new ApiError(422, "REJECTION_VALIDATION_FAILED", "A rejection reason is required", validationDetails(parsed.error));
    const user = await requireWorkspaceUser(request, "submitter@covendro.local");
    const result = await rejectInvoice(request.params.id, user, request.id, parsed.data.reason, idempotencyKey(request));
    return { data: result };
  });

  app.get<{ Params: { id: string } }>("/api/invoices/:id/approvals", async (request) => {
    const user = await requireWorkspaceUser(request, "submitter@covendro.local");
    const invoice = await prisma.invoice.findFirst({ where: { id: request.params.id, organizationId: user.organizationId }, include: { approvals: { orderBy: { createdAt: "desc" }, include: { reviewer: true } } } });
    if (!invoice) throw new ApiError(404, "INVOICE_NOT_FOUND", "Invoice was not found");
    return { data: invoice.approvals };
  });
}
