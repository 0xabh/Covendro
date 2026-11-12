import type { DecisionResult, VendorRiskResult } from "@covendro/shared";
import { policyToSnapshot } from "@covendro/shared";
import { prisma } from "../db/prisma.js";
import { ApiError } from "../errors.js";
import { assessVendorRisk } from "./vendor-risk-service.js";
import { evaluateTreasuryPolicy } from "./policy-engine.js";

export type InvoiceControls = {
  vendorRisk: VendorRiskResult;
  policy: DecisionResult;
  policySnapshot: ReturnType<typeof policyToSnapshot>;
  dailyTotalMinor: number;
};

function startOfUtcDay() {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

export async function assessInvoiceControls(invoiceId: string, organizationId: string): Promise<InvoiceControls> {
  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, organizationId },
    include: { vendor: true },
  });
  if (!invoice) throw new ApiError(404, "INVOICE_NOT_FOUND", "Invoice was not found");

  const [policyRecord, previousInvoices, previousPaymentCount, dailyInvoices, duplicateInvoice, duplicateDocument] = await Promise.all([
    prisma.treasuryPolicy.findFirst({ where: { organizationId, active: true }, orderBy: { version: "desc" } }),
    prisma.invoice.findMany({ where: { organizationId, vendorId: invoice.vendorId, id: { not: invoice.id } }, select: { paymentDestination: true } }),
    prisma.invoice.count({ where: { organizationId, vendorId: invoice.vendorId, payment: { isNot: null } } }),
    prisma.invoice.findMany({ where: { organizationId, createdAt: { gte: startOfUtcDay() }, id: { not: invoice.id }, status: { notIn: ["REJECTED", "BLOCKED"] } }, select: { amountMinor: true } }),
    prisma.invoice.findFirst({ where: { organizationId, vendorId: invoice.vendorId, invoiceNumber: invoice.invoiceNumber, id: { not: invoice.id } }, select: { id: true } }),
    invoice.fileHash ? prisma.invoice.findFirst({ where: { organizationId, fileHash: invoice.fileHash, id: { not: invoice.id } }, select: { id: true } }) : null,
  ]);
  if (!policyRecord) throw new ApiError(500, "TREASURY_POLICY_MISSING", "No active treasury policy is configured");

  const policySnapshot = policyToSnapshot(policyRecord);
  const dailyTotalMinor = dailyInvoices.reduce((total, item) => total + item.amountMinor, 0);
  const policy = evaluateTreasuryPolicy({
    amountMinor: invoice.amountMinor,
    currency: invoice.currency,
    paymentChain: invoice.paymentChain,
    paymentDestination: invoice.paymentDestination,
    existingDailyTotalMinor: dailyTotalMinor,
    policy: policySnapshot,
  });
  const vendorRisk = assessVendorRisk({
    vendorName: invoice.vendor.name,
    vendorAddress: invoice.vendor.accountAddress,
    vendorChain: invoice.vendor.accountChain,
    allowlisted: invoice.vendor.allowlisted,
    previousPaymentCount,
    destinationChanged: previousInvoices.some((item) => item.paymentDestination !== invoice.paymentDestination),
    duplicateInvoice: Boolean(duplicateInvoice),
    duplicateDocument: Boolean(duplicateDocument),
    amountMinor: invoice.amountMinor,
    policyDecision: policy.decision,
  });

  return { vendorRisk, policy, policySnapshot, dailyTotalMinor };
}

export async function persistInvoiceControls(invoiceId: string, organizationId: string, actorId: string, requestId: string, controls: InvoiceControls) {
  const updated = await prisma.invoice.update({
    where: { id: invoiceId },
    data: {
      vendorRiskDecision: controls.vendorRisk.decision,
      vendorRiskReasonsJson: JSON.stringify(controls.vendorRisk),
      policyDecision: controls.policy.decision,
      policyReasonsJson: JSON.stringify(controls.policy),
      requiredApprovals: Math.max(controls.vendorRisk.requiredApprovals, controls.policy.requiredApprovals),
      policyVersion: controls.policySnapshot.version,
      vendor: { update: { riskStatus: controls.vendorRisk.decision } },
      auditEvents: {
        create: [
          { organizationId, actorId, eventType: "VENDOR_RISK_ASSESSED", description: `Vendor risk assessed as ${controls.vendorRisk.decision}`, metadataJson: JSON.stringify({ decision: controls.vendorRisk.decision, riskScore: controls.vendorRisk.riskScore, reasons: controls.vendorRisk.reasons }), requestId },
          { organizationId, actorId, eventType: "POLICY_EVALUATED", description: `Treasury policy evaluated as ${controls.policy.decision}`, metadataJson: JSON.stringify({ decision: controls.policy.decision, policyVersion: controls.policy.policyVersion, reasons: controls.policy.reasons }), requestId },
        ],
      },
    },
    include: {
      vendor: true,
      lineItems: true,
      approvals: { orderBy: { createdAt: "desc" }, include: { reviewer: true } },
      payment: true,
      auditEvents: { orderBy: { createdAt: "desc" } },
    },
  });
  return updated;
}
