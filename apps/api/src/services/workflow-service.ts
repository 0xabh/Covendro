import type { InvoiceStatus } from "@covendro/shared";
import { canTransitionInvoice } from "@covendro/shared";
import { prisma } from "../db/prisma.js";
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

async function handleDecision(invoiceId: string, actor: Actor, requestId: string, decision: "APPROVED" | "REJECTED", reason: string | undefined, idempotencyKey?: string) {
  requireReviewer(actor);
  const invoice = await findInvoice(invoiceId, actor.organizationId);
  if (idempotencyKey) {
    const previous = await prisma.approval.findUnique({ where: { idempotencyKey }, include: { invoice: true } });
    if (previous) {
      if (previous.invoiceId !== invoice.id) throw new ApiError(409, "IDEMPOTENCY_KEY_REUSED", "Idempotency key was already used for another invoice");
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
  if (actor.id === invoice.createdById && !policy.allowSelfApproval) throw new ApiError(403, "SELF_APPROVAL_NOT_ALLOWED", "The request creator cannot approve their own request");
  if (invoice.vendorRiskDecision === "BLOCK" || invoice.policyDecision === "BLOCK") await blockInvoice(invoice, actor, requestId);
  assertTransition(invoice.status, decision);
  const updated = await prisma.$transaction(async (tx) => {
    await tx.approval.create({ data: { invoiceId: invoice.id, reviewerId: actor.id, decision, reason, idempotencyKey, approvalRound: invoice.approvalRound } });
    return tx.invoice.update({
      where: { id: invoice.id },
      data: { status: decision, auditEvents: { create: { organizationId: actor.organizationId, actorId: actor.id, eventType: decision === "APPROVED" ? "INVOICE_APPROVED" : "INVOICE_REJECTED", description: decision === "APPROVED" ? "Invoice approved for payment processing" : "Invoice rejected by reviewer", metadataJson: JSON.stringify({ decision, reason, approvalRound: invoice.approvalRound }), requestId } } },
      include: { vendor: true, lineItems: true, approvals: { orderBy: { createdAt: "desc" }, include: { reviewer: true } }, payment: true, auditEvents: { orderBy: { createdAt: "desc" } } },
    });
  });
  return { invoice: updated, idempotent: false };
}

export function approveInvoice(invoiceId: string, actor: Actor, requestId: string, idempotencyKey?: string) {
  return handleDecision(invoiceId, actor, requestId, "APPROVED", undefined, idempotencyKey);
}

export function rejectInvoice(invoiceId: string, actor: Actor, requestId: string, reason: string, idempotencyKey?: string) {
  return handleDecision(invoiceId, actor, requestId, "REJECTED", reason, idempotencyKey);
}
