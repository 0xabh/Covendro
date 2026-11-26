import type { InvoiceStatus } from "@covendro/shared";
import { canTransitionInvoice } from "@covendro/shared";
import { prisma } from "../db/prisma.js";
import { lockTreasuryWorkspace } from "./treasury-lock.js";
import { currentPayableTerms, hashPayableTerms } from "./payable-terms.js";
import { ApiError } from "../errors.js";

type Actor = { id: string; role: string; organizationId: string };

function requireReviewer(actor: Actor) {
  if (actor.role !== "REVIEWER" && actor.role !== "TREASURY_ADMINISTRATOR") {
    throw new ApiError(403, "REVIEWER_ROLE_REQUIRED", "A reviewer or treasury administrator is required for this action");
  }
}

async function findInvoice(invoiceId: string, organizationId: string) {
  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, organizationId },
    include: { vendor: true, createdBy: true, lineItems: true, approvals: { orderBy: { createdAt: "desc" }, include: { reviewer: true } }, payment: true, auditEvents: { orderBy: { createdAt: "desc" } } },
  });
  if (!invoice) throw new ApiError(404, "INVOICE_NOT_FOUND", "Invoice was not found");
  return invoice;
}

async function activePolicy(organizationId: string) {
  const policy = await prisma.treasuryPolicy.findFirst({ where: { organizationId, active: true }, orderBy: { version: "desc" } });
  if (!policy) throw new ApiError(500, "TREASURY_POLICY_MISSING", "No active treasury policy is configured");
  return policy;
}

function assertTransition(from: string, to: InvoiceStatus) {
  if (!canTransitionInvoice(from, to)) throw new ApiError(409, "INVALID_STATUS_TRANSITION", `Invoice cannot move from ${from} to ${to}`);
}

async function blockInvoice(invoice: { id: string; status: string }, actor: Actor, requestId: string) {
  if (invoice.status !== "BLOCKED") {
    await prisma.invoice.update({
      where: { id: invoice.id },
      data: { status: "BLOCKED", auditEvents: { create: { organizationId: actor.organizationId, actorId: actor.id, eventType: "PAYMENT_BLOCKED", description: "Payment request blocked by vendor risk or treasury policy", requestId } } },
    });
  }
  throw new ApiError(409, "PAYMENT_BLOCKED", "This payment request is blocked by vendor risk or treasury policy");
}

export async function submitInvoice(invoiceId: string, actor: Actor, requestId: string) {
  const invoice = await findInvoice(invoiceId, actor.organizationId);
  if (invoice.createdById !== actor.id && actor.role !== "TREASURY_ADMINISTRATOR") throw new ApiError(403, "SUBMITTER_ONLY_OWN_REQUEST", "Only the request creator or treasury administrator can submit this request");
  if (invoice.status === "REVIEW_REQUIRED") return { invoice, idempotent: true };
  if (invoice.status === "REJECTED") throw new ApiError(409, "RESUBMIT_REQUIRED", "Rejected requests require explicit resubmission");
  if (invoice.status === "BLOCKED" || invoice.vendorRiskDecision === "BLOCK" || invoice.policyDecision === "BLOCK") await blockInvoice(invoice, actor, requestId);
  assertTransition(invoice.status, "REVIEW_REQUIRED");
  const updated = await prisma.invoice.update({
    where: { id: invoice.id },
    data: {
      status: "REVIEW_REQUIRED",
      auditEvents: { create: { organizationId: actor.organizationId, actorId: actor.id, eventType: "INVOICE_SUBMITTED", description: "Invoice submitted for treasury review", requestId } },
    },
    include: { vendor: true, lineItems: true, approvals: { include: { reviewer: true } }, payment: true, auditEvents: { orderBy: { createdAt: "desc" } } },
  });
  return { invoice: updated, idempotent: false };
}

export async function resubmitInvoice(invoiceId: string, actor: Actor, requestId: string) {
  const invoice = await findInvoice(invoiceId, actor.organizationId);
  if (invoice.createdById !== actor.id && actor.role !== "TREASURY_ADMINISTRATOR") throw new ApiError(403, "SUBMITTER_ONLY_OWN_REQUEST", "Only the request creator or treasury administrator can resubmit this request");
  if (process.env.DEMO_MODE === "false" && ["APPROVED", "REVIEW_REQUIRED", "QUOTE_READY"].includes(invoice.status)) {
    await prisma.$transaction(async (tx) => {
      await lockTreasuryWorkspace(tx, actor.organizationId);
      const locked = await tx.invoice.updateMany({
        where: { id: invoice.id, status: invoice.status, approvalRound: invoice.approvalRound },
        data: { status: invoice.status },
      });
      if (!locked.count) throw new ApiError(409, "INVALID_APPROVAL_STATE", "The payable changed while restarting review");
      const payment = await tx.payment.findUnique({ where: { invoiceId: invoice.id } });
      const dryPreview = payment?.status === "QUOTE_READY" && payment.quoteMode === "REAL_DRY";
      if (payment && !dryPreview && !["FAILED", "EXPIRED"].includes(payment.status)) {
        throw new ApiError(409, "PAYMENT_ALREADY_STARTED", "The existing payment attempt must be resolved first");
      }
      const current = await tx.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
      const terms = await currentPayableTerms(tx, current);
      const approvals = await tx.approval.findMany({
        where: { invoiceId: current.id, approvalRound: current.approvalRound, decision: "APPROVED" },
        select: { payableTermsJson: true },
      });
      if (!approvals.some((approval) => approval.payableTermsJson !== terms)) {
        throw new ApiError(409, "APPROVAL_TERMS_CURRENT", "The payable terms have not changed");
      }
      if (dryPreview && payment) {
        await tx.payment.update({ where: { id: payment.id }, data: { status: "EXPIRED" } });
        await tx.ledgerEntry.updateMany({ where: { invoiceId: invoice.id }, data: { paymentStatus: "EXPIRED" } });
      }
      await tx.livePaymentAttempt.updateMany({
        where: { activeInvoiceId: invoice.id, handedOffAt: null },
        data: { activeInvoiceId: null, status: "EXPIRED_UNEXPOSED" },
      });
      await tx.invoice.update({
        where: { id: invoice.id },
        data: {
          status: "REVIEW_REQUIRED",
          approvalRound: { increment: 1 },
          auditEvents: { create: {
            organizationId: actor.organizationId, actorId: actor.id, eventType: "INVOICE_REVIEW_RESTARTED",
            description: "Review restarted after payable terms changed", requestId,
          } },
        },
      });
    });
    return { invoice: await findInvoice(invoiceId, actor.organizationId), idempotent: false };
  }
  if (invoice.status === "REVIEW_REQUIRED") return { invoice, idempotent: true };
  if (invoice.status !== "REJECTED") throw new ApiError(409, "RESUBMIT_NOT_ALLOWED", "Only rejected requests can be explicitly resubmitted");
  if (invoice.vendorRiskDecision === "BLOCK" || invoice.policyDecision === "BLOCK") await blockInvoice(invoice, actor, requestId);
  assertTransition(invoice.status, "REVIEW_REQUIRED");
  const updated = await prisma.invoice.update({
    where: { id: invoice.id },
    data: {
      status: "REVIEW_REQUIRED",
      approvalRound: { increment: 1 },
      auditEvents: { create: { organizationId: actor.organizationId, actorId: actor.id, eventType: "INVOICE_RESUBMITTED", description: "Invoice explicitly resubmitted for treasury review", requestId } },
    },
    include: { vendor: true, lineItems: true, approvals: { orderBy: { createdAt: "desc" }, include: { reviewer: true } }, payment: true, auditEvents: { orderBy: { createdAt: "desc" } } },
  });
  return { invoice: updated, idempotent: false };
}

async function handleDecision(invoiceId: string, actor: Actor, requestId: string, decision: "APPROVED" | "REJECTED", reason: string | undefined, idempotencyKey?: string, termsHash?: string) {
  requireReviewer(actor);
  const invoice = await findInvoice(invoiceId, actor.organizationId);
  if (idempotencyKey && process.env.DEMO_MODE === "false") idempotencyKey = `${actor.id}:${idempotencyKey}`;
  if (idempotencyKey) {
    const previous = await prisma.approval.findUnique({ where: { idempotencyKey }, include: { invoice: true } });
    if (previous) {
      if (previous.invoiceId !== invoice.id || previous.reviewerId !== actor.id || previous.decision !== decision || previous.approvalRound !== invoice.approvalRound) throw new ApiError(409, "IDEMPOTENCY_KEY_REUSED", "Idempotency key was already used for another invoice");
      return { invoice: await findInvoice(invoice.id, actor.organizationId), idempotent: true };
    }
  }
  const existing = invoice.approvals.find((approval) => approval.reviewerId === actor.id && approval.approvalRound === invoice.approvalRound);
  if (existing) {
    if (existing.decision !== decision) throw new ApiError(409, "APPROVAL_ALREADY_RECORDED", "A different decision was already recorded for this reviewer");
    return { invoice, idempotent: true };
  }
  if (invoice.status === "APPROVED" && decision === "APPROVED") return { invoice, idempotent: true };
  if (invoice.status === "REJECTED") throw new ApiError(409, "RESUBMIT_REQUIRED", "Rejected requests require explicit resubmission before review");
  if (invoice.status !== "REVIEW_REQUIRED") throw new ApiError(409, "INVALID_APPROVAL_STATE", "Only requests in review can be approved or rejected");
  const policy = await activePolicy(actor.organizationId);
  if (actor.id === invoice.createdById && (process.env.DEMO_MODE === "false" || !policy.allowSelfApproval)) throw new ApiError(403, "SELF_APPROVAL_NOT_ALLOWED", "The request creator cannot approve their own request");
  if (invoice.vendorRiskDecision === "BLOCK" || invoice.policyDecision === "BLOCK") await blockInvoice(invoice, actor, requestId);
  assertTransition(invoice.status, decision);
  const idempotent = await prisma.$transaction(async (tx) => {
    const locked = await tx.invoice.updateMany({
      where: { id: invoice.id, status: "REVIEW_REQUIRED", approvalRound: invoice.approvalRound },
      data: { status: "REVIEW_REQUIRED" },
    });
    if (!locked.count) {
      const current = await tx.invoice.findUniqueOrThrow({ where: { id: invoice.id }, select: { status: true, approvalRound: true } });
      if (current.approvalRound === invoice.approvalRound && current.status === "APPROVED" && decision === "APPROVED") return true;
      throw new ApiError(409, "INVALID_APPROVAL_STATE", "The pending approval round has changed");
    }

    const recorded = await tx.approval.findUnique({
      where: { invoiceId_reviewerId_approvalRound: { invoiceId: invoice.id, reviewerId: actor.id, approvalRound: invoice.approvalRound } },
    });
    if (recorded) {
      if (recorded.decision !== decision) throw new ApiError(409, "APPROVAL_ALREADY_RECORDED", "A different decision was already recorded for this reviewer");
      return true;
    }

    let payableTermsJson: string | undefined;
    if (process.env.DEMO_MODE === "false" && decision === "APPROVED") {
      const current = await tx.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
      payableTermsJson = await currentPayableTerms(tx, current);
      if (termsHash !== hashPayableTerms(payableTermsJson)) {
        throw new ApiError(409, "APPROVAL_TERMS_CHANGED", "Read and confirm the current payable terms before approving");
      }
      const staleDecision = await tx.approval.findFirst({
        where: { invoiceId: current.id, approvalRound: current.approvalRound, decision: "APPROVED", OR: [
          { payableTermsJson: null }, { payableTermsJson: { not: payableTermsJson } },
        ] },
      });
      if (staleDecision) throw new ApiError(409, "APPROVAL_TERMS_CHANGED", "The payable terms changed during review");
    }

    await tx.approval.create({ data: { invoiceId: invoice.id, reviewerId: actor.id, decision, reason, idempotencyKey, payableTermsJson, approvalRound: invoice.approvalRound } });
    const active = await tx.treasuryPolicy.findFirst({ where: { organizationId: actor.organizationId, active: true }, orderBy: { version: "desc" } });
    const requiredApprovals = Math.max(active?.reviewerQuorum ?? 1, invoice.requiredApprovals ?? 1);
    const approvalsRecorded = await tx.approval.count({ where: { invoiceId: invoice.id, approvalRound: invoice.approvalRound, decision: "APPROVED" } });
    const status = decision === "APPROVED" && approvalsRecorded < requiredApprovals ? "REVIEW_REQUIRED" : decision;
    const eventType = status === "REVIEW_REQUIRED" ? "INVOICE_APPROVAL_RECORDED" : status === "APPROVED" ? "INVOICE_APPROVED" : "INVOICE_REJECTED";
    await tx.invoice.update({
      where: { id: invoice.id },
      data: { status, auditEvents: { create: {
        organizationId: actor.organizationId, actorId: actor.id, eventType,
        description: status === "REVIEW_REQUIRED" ? "Approval recorded; more reviewers are required" : status === "APPROVED" ? "Invoice approved for payment processing" : "Invoice rejected by reviewer",
        metadataJson: JSON.stringify({ decision, reason, approvalRound: invoice.approvalRound, approvalsRecorded, requiredApprovals }),
        requestId,
      } } },
    });
    return false;
  });
  return { invoice: await findInvoice(invoice.id, actor.organizationId), idempotent };
}

export function approveInvoice(invoiceId: string, actor: Actor, requestId: string, idempotencyKey?: string, termsHash?: string) {
  return handleDecision(invoiceId, actor, requestId, "APPROVED", undefined, idempotencyKey, termsHash);
}

export function rejectInvoice(invoiceId: string, actor: Actor, requestId: string, reason: string, idempotencyKey?: string) {
  return handleDecision(invoiceId, actor, requestId, "REJECTED", reason, idempotencyKey);
}
