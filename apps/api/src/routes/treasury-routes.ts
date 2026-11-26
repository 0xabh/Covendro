import type { FastifyInstance, FastifyRequest } from "fastify";
import { csvToList, policyToSnapshot, treasuryPolicyUpdateSchema } from "@covendro/shared";
import { prisma } from "../db/prisma.js";
import { ApiError } from "../errors.js";
import { requireWorkspaceUser } from "../services/workspace-access.js";
import { lockTreasuryWorkspace } from "../services/treasury-lock.js";
import { assessInvoiceControls } from "../services/risk-assessment-service.js";


async function requireTreasuryAdmin(request: FastifyRequest) {
  const user = await requireWorkspaceUser(request, "submitter@covendro.local");
  if (user.role !== "TREASURY_ADMINISTRATOR") throw new ApiError(403, "TREASURY_ADMIN_REQUIRED", "Only the treasury administrator can change policy");
  return user;
}

function policyResponse(policy: Parameters<typeof policyToSnapshot>[0]) {
  return {
    ...policy,
    allowedCurrencies: csvToList(policy.allowedCurrenciesCsv),
    allowedChains: csvToList(policy.allowedChainsCsv),
    allowedRecipients: csvToList(policy.allowedRecipientsCsv),
  };
}

function validationDetails(error: { issues: Array<{ path: readonly PropertyKey[]; message: string }> }) {
  return error.issues.map((issue) => ({ path: issue.path.map(String), message: issue.message }));
}

async function createPolicyVersion(input: {
  organizationId: string;
  actorId: string;
  currentId: string;
  requestId: string;
  update: ReturnType<typeof treasuryPolicyUpdateSchema.parse>;
  eventType: string;
  description: string;
}) {
  return prisma.$transaction(async (tx) => {
    await lockTreasuryWorkspace(tx, input.organizationId);
    const current = await tx.treasuryPolicy.findFirst({ where: { id: input.currentId, organizationId: input.organizationId, active: true } });
    if (!current) throw new ApiError(404, "POLICY_NOT_FOUND", "Active treasury policy was not found");
    await tx.treasuryPolicy.updateMany({ where: { organizationId: input.organizationId, active: true }, data: { active: false } });
    const next = await tx.treasuryPolicy.create({
      data: {
        organizationId: input.organizationId,
        version: current.version + 1,
        maxPaymentPerTransactionMinor: input.update.maxPaymentPerTransactionMinor,
        maxDailyPaymentTotalMinor: input.update.maxDailyPaymentTotalMinor,
        allowedCurrenciesCsv: input.update.allowedCurrencies.join(","),
        allowedChainsCsv: input.update.allowedChains.join(","),
        allowedRecipientsCsv: input.update.allowedRecipients.join(","),
        reviewerQuorum: input.update.reviewerQuorum ?? current.reviewerQuorum,
        requireApprovalAboveMinor: input.update.requireApprovalAboveMinor,
        blockUnknownRecipients: input.update.blockUnknownRecipients,
        warningsRequireManualReview: input.update.warningsRequireManualReview,
        allowSelfApproval: input.update.allowSelfApproval,
        freezePayments: input.update.freezePayments,
        demoMode: input.update.demoMode,
        active: true,
      },
    });
    await tx.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorId: input.actorId,
        eventType: input.eventType,
        description: input.description,
        metadataJson: JSON.stringify({ policyVersion: next.version, freezePayments: next.freezePayments }),
        requestId: input.requestId,
      },
    });
    return next;
  });
}

export function registerTreasuryRoutes(app: FastifyInstance) {
  app.get("/api/policies", async (request) => {
    const user = await requireWorkspaceUser(request, "submitter@covendro.local");
    const [policies, treasuryIdentity] = await Promise.all([
      prisma.treasuryPolicy.findMany({ where: { organizationId: user.organizationId }, orderBy: { version: "desc" } }),
      prisma.treasuryIdentity.findFirst({ where: { organizationId: user.organizationId }, orderBy: { createdAt: "asc" } }),
    ]);
    return { data: { active: policies.find((policy) => policy.active) ? policyResponse(policies.find((policy) => policy.active)!) : null, history: policies.map(policyResponse), treasuryIdentity } };
  });

  app.put<{ Params: { id: string }; Body: unknown }>("/api/policies/:id", async (request) => {
    const user = await requireTreasuryAdmin(request);
    const parsed = treasuryPolicyUpdateSchema.safeParse(request.body);
    if (!parsed.success) throw new ApiError(422, "POLICY_VALIDATION_FAILED", "Treasury policy fields need attention", validationDetails(parsed.error));
    const policy = await createPolicyVersion({ organizationId: user.organizationId, actorId: user.id, currentId: request.params.id, requestId: request.id, update: parsed.data, eventType: "TREASURY_POLICY_CHANGED", description: "Treasury policy updated" });
    const treasuryIdentity = await prisma.treasuryIdentity.findFirst({ where: { organizationId: user.organizationId }, orderBy: { createdAt: "asc" } });
    return { data: { ...policyResponse(policy), treasuryIdentity } };
  });

  for (const [action, freezePayments, eventType] of [["freeze", true, "TREASURY_FROZEN"], ["unfreeze", false, "TREASURY_UNFROZEN"]] as const) {
    app.post<{ Params: { id: string } }>(`/api/policies/:id/${action}`, async (request) => {
      const user = await requireTreasuryAdmin(request);
      const current = await prisma.treasuryPolicy.findFirst({ where: { id: request.params.id, organizationId: user.organizationId, active: true } });
      if (!current) throw new ApiError(404, "POLICY_NOT_FOUND", "Active treasury policy was not found");
      const update = {
        maxPaymentPerTransactionMinor: current.maxPaymentPerTransactionMinor,
        maxDailyPaymentTotalMinor: current.maxDailyPaymentTotalMinor,
        allowedCurrencies: csvToList(current.allowedCurrenciesCsv),
        allowedChains: csvToList(current.allowedChainsCsv),
        allowedRecipients: csvToList(current.allowedRecipientsCsv),
        requireApprovalAboveMinor: current.requireApprovalAboveMinor,
        blockUnknownRecipients: current.blockUnknownRecipients,
        warningsRequireManualReview: current.warningsRequireManualReview,
        allowSelfApproval: current.allowSelfApproval,
        freezePayments,
        demoMode: current.demoMode,
      };
      const policy = await createPolicyVersion({ organizationId: user.organizationId, actorId: user.id, currentId: current.id, requestId: request.id, update, eventType, description: freezePayments ? "Treasury payment execution frozen" : "Treasury payment execution unfrozen" });
      const treasuryIdentity = await prisma.treasuryIdentity.findFirst({ where: { organizationId: user.organizationId }, orderBy: { createdAt: "asc" } });
      return { data: { ...policyResponse(policy), treasuryIdentity } };
    });
  }

  app.get("/api/vendors", async (request) => {
    const user = await requireWorkspaceUser(request, "submitter@covendro.local");
    const vendors = await prisma.vendor.findMany({ where: { organizationId: user.organizationId }, include: { _count: { select: { invoices: true } }, destinations: { orderBy: { createdAt: "desc" } } }, orderBy: { name: "asc" } });
    return { data: vendors };
  });

  app.get<{ Params: { id: string }; Querystring: { invoiceId?: string } }>("/api/vendors/:id/risk", async (request) => {
    const user = await requireWorkspaceUser(request, "submitter@covendro.local");
    const vendor = await prisma.vendor.findFirst({ where: { id: request.params.id, organizationId: user.organizationId } });
    if (!vendor) throw new ApiError(404, "VENDOR_NOT_FOUND", "Vendor was not found");
    if (!request.query.invoiceId) return { data: { vendor, risk: { decision: vendor.riskStatus, reasons: ["Risk is based on the latest persisted vendor assessment."], riskScore: null } } };
    const invoice = await prisma.invoice.findFirst({ where: { id: request.query.invoiceId, organizationId: user.organizationId, vendorId: vendor.id }, select: { id: true } });
    if (!invoice) throw new ApiError(404, "INVOICE_NOT_FOUND", "Invoice was not found for this vendor");
    const controls = await assessInvoiceControls(invoice.id, user.organizationId);
    return { data: { vendor, risk: controls.vendorRisk, policy: controls.policy } };
  });
}
