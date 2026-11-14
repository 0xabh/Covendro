import type { PaymentOutcome, PaymentQuoteInput } from "@covendro/shared";
import { canTransitionInvoice } from "@covendro/shared";
import { prisma } from "../db/prisma.js";
import { ApiError } from "../errors.js";
import { getPaymentRail } from "./payments/payment-rail-factory.js";
import { MockPaymentRail } from "./payments/mock-payment-rail.js";
import { syncLedgerEntry } from "./ledger-service.js";

type Actor = { id: string; role: string; organizationId: string };

function requirePaymentOperator(actor: Actor) {
  if (actor.role !== "REVIEWER" && actor.role !== "TREASURY_ADMINISTRATOR") throw new ApiError(403, "PAYMENT_OPERATOR_ROLE_REQUIRED", "A reviewer or treasury administrator is required for payment actions");
}

export async function findPayment(paymentId: string, organizationId: string) {
  const payment = await prisma.payment.findFirst({ where: { id: paymentId, organizationId }, include: { invoice: { include: { vendor: true, approvals: { include: { reviewer: true } }, auditEvents: { orderBy: { createdAt: "desc" } } } }, ledgerEntry: true } });
  if (!payment) throw new ApiError(404, "PAYMENT_NOT_FOUND", "Payment was not found");
  return payment;
}

export async function listPayments(organizationId: string) {
  return prisma.payment.findMany({ where: { organizationId }, include: { invoice: { include: { vendor: true } }, ledgerEntry: true }, orderBy: { createdAt: "desc" } });
}

export async function createPaymentQuote(invoiceId: string, actor: Actor, requestId: string, idempotencyKey?: string) {
  requirePaymentOperator(actor);
  const invoice = await prisma.invoice.findFirst({ where: { id: invoiceId, organizationId: actor.organizationId }, include: { vendor: true, payment: true } });
  if (!invoice) throw new ApiError(404, "INVOICE_NOT_FOUND", "Invoice was not found");
  if (idempotencyKey) {
    const prior = await prisma.payment.findUnique({ where: { idempotencyKey } });
    if (prior) {
      if (prior.invoiceId !== invoice.id) throw new ApiError(409, "IDEMPOTENCY_KEY_REUSED", "Idempotency key was already used for another invoice");
      // A failed quote is safe to retry with the same logical operation. Keep
      // successful and in-flight operations idempotent, but allow the request
      // to rebuild the quote after a provider rejection or timeout.
      if (prior.status !== "FAILED") return { payment: await findPayment(prior.id, actor.organizationId), idempotent: true };
    }
  }
  if (invoice.payment && ["QUOTE_REQUESTED", "QUOTE_READY", "PAYMENT_PENDING", "PAID"].includes(invoice.payment.status)) return { payment: await findPayment(invoice.payment.id, actor.organizationId), idempotent: true };
  if (invoice.status !== "APPROVED") throw new ApiError(409, "INVOICE_NOT_APPROVED", "Only approved invoices can receive a payment quote");
  if (invoice.vendorRiskDecision === "BLOCK" || invoice.policyDecision === "BLOCK") throw new ApiError(409, "PAYMENT_BLOCKED", "Treasury policy or vendor risk blocked this payment");

  const rail = getPaymentRail();
  const treasuryIdentity = await prisma.treasuryIdentity.findFirst({ where: { organizationId: actor.organizationId }, orderBy: { createdAt: "asc" } });
  // Live 1Click quotes validate the refund account on the origin chain. The
  // seeded demo identity is intentionally fictional, so prefer the explicit
  // integration setting when the real dry-quote adapter is configured.
  const refundDestination = process.env.NEAR_INTENTS_REFUND_TO ?? treasuryIdentity?.nearAccountId ?? "treasury.covendro.testnet";
  const destinationChain = invoice.paymentChain ?? invoice.vendor.accountChain ?? "near";
  const quoteInput: PaymentQuoteInput = {
    paymentId: invoice.payment?.id ?? `payment-${invoice.id}`,
    amountMinor: invoice.amountMinor,
    currency: invoice.currency,
    sourceChain: "near",
    destinationChain,
    destination: invoice.paymentDestination,
    refundDestination,
    slippageBps: 100,
    deadline: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
  };

  const payment = invoice.payment
    ? await prisma.payment.update({ where: { id: invoice.payment.id }, data: { status: "QUOTE_REQUESTED", rail: rail.name, quoteMode: null, providerStatus: "REQUESTED", quoteId: null, idempotencyKey } })
    : await prisma.payment.create({ data: { organizationId: actor.organizationId, invoiceId: invoice.id, status: "QUOTE_REQUESTED", rail: rail.name, amountMinor: invoice.amountMinor, idempotencyKey } });
  await prisma.invoice.update({ where: { id: invoice.id }, data: { status: "QUOTE_REQUESTED", auditEvents: { create: { organizationId: actor.organizationId, actorId: actor.id, eventType: "PAYMENT_QUOTE_REQUESTED", description: `Payment quote requested through ${rail.name}`, metadataJson: JSON.stringify({ rail: rail.name, mode: rail.mode }), requestId } } } });

  try {
    const quote = await rail.createQuote({ ...quoteInput, paymentId: payment.id });
    const updated = await prisma.$transaction(async (tx) => {
      const savedPayment = await tx.payment.update({ where: { id: payment.id }, data: { status: "QUOTE_READY", quoteId: quote.quoteId, quoteMode: quote.mode, providerStatus: quote.providerStatus, quoteRequestId: quote.requestId, sourceAsset: quote.sourceAsset, destinationAsset: quote.destinationAsset, sourceChain: quote.sourceChain, destinationChain: quote.destinationChain, estimatedReceivedMinor: quote.estimatedReceivedMinor, slippageBps: quote.slippageBps, quoteExpiresAt: new Date(quote.quoteExpiresAt), refundDestination: quote.refundDestination, depositAddress: quote.depositAddress, depositMemo: quote.depositMemo, depositRequirementsJson: quote.depositRequirements ? JSON.stringify(quote.depositRequirements) : null } });
      await tx.invoice.update({ where: { id: invoice.id }, data: { status: "QUOTE_READY", auditEvents: { create: { organizationId: actor.organizationId, actorId: actor.id, eventType: "QUOTE_GENERATED", description: `Payment quote ready through ${rail.name}`, metadataJson: JSON.stringify({ quoteId: quote.quoteId, mode: quote.mode, providerStatus: quote.providerStatus }), requestId } } } });
      const approval = await tx.approval.findFirst({ where: { invoiceId: invoice.id, decision: "APPROVED" }, orderBy: { createdAt: "asc" } });
      await syncLedgerEntry(tx, { invoiceId: invoice.id, paymentId: savedPayment.id, grossAmountMinor: invoice.amountMinor, currency: invoice.currency, paymentStatus: "QUOTE_READY", paymentRail: savedPayment.rail, quoteId: savedPayment.quoteId, refundStatus: savedPayment.refundStatus, approvedAt: approval?.createdAt });
      return savedPayment;
    });
    return { payment: await findPayment(updated.id, actor.organizationId), idempotent: false };
  } catch (error) {
    await prisma.payment.update({ where: { id: payment.id }, data: { status: "FAILED", providerStatus: "QUOTE_FAILED" } });
    await prisma.invoice.update({ where: { id: invoice.id, status: "QUOTE_REQUESTED" }, data: { status: "APPROVED", auditEvents: { create: { organizationId: actor.organizationId, actorId: actor.id, eventType: "QUOTE_FAILED", description: "Payment quote request failed", metadataJson: JSON.stringify({ rail: rail.name }), requestId } } } });
    throw new ApiError(502, "PAYMENT_QUOTE_FAILED", error instanceof Error ? error.message : "Payment quote failed");
  }
}

export async function simulatePayment(paymentId: string, actor: Actor, outcome: PaymentOutcome, requestId: string) {
  requirePaymentOperator(actor);
  const payment = await findPayment(paymentId, actor.organizationId);
  if (payment.quoteMode !== "MOCK") throw new ApiError(409, "REAL_DRY_NOT_EXECUTABLE", "Only mock quotes can be simulated; a real dry quote has not settled funds");
  if (payment.status !== "QUOTE_READY" && payment.status !== "PAYMENT_PENDING") throw new ApiError(409, "PAYMENT_NOT_SIMULATABLE", "Only a ready mock quote can be simulated");
  const result = await new MockPaymentRail().simulate!(payment.id, outcome);
  if (outcome !== "EXPIRED" && payment.status === "QUOTE_READY") {
    await prisma.payment.update({ where: { id: payment.id }, data: { status: "PAYMENT_PENDING", providerStatus: "PROCESSING" } });
    await prisma.invoice.update({ where: { id: payment.invoiceId }, data: { status: "PAYMENT_PENDING", auditEvents: { create: { organizationId: actor.organizationId, actorId: actor.id, eventType: "PAYMENT_SIMULATION_STARTED", description: "Mock payment simulation started", metadataJson: JSON.stringify({ outcome }), requestId } } } });
  }
  const finalStatus = result.status;
  const transitionFrom = outcome === "EXPIRED" ? payment.invoice.status : payment.invoice.status === "QUOTE_READY" ? "PAYMENT_PENDING" : payment.invoice.status;
  if (!canTransitionInvoice(transitionFrom, finalStatus)) throw new ApiError(409, "INVALID_PAYMENT_TRANSITION", `Invoice cannot move from ${transitionFrom} to ${finalStatus}`);
  const eventType = outcome === "SUCCESS" ? "PAYMENT_SIMULATED" : outcome === "REFUNDED" ? "PAYMENT_REFUNDED" : outcome === "FAILED" ? "PAYMENT_FAILED" : "PAYMENT_EXPIRED";
  const updated = await prisma.$transaction(async (tx) => {
    const savedPayment = await tx.payment.update({ where: { id: payment.id }, data: { status: finalStatus, providerStatus: result.providerStatus, transactionHash: result.transactionHash, refundStatus: result.refundStatus, paidAt: finalStatus === "PAID" ? new Date() : null } });
    await tx.invoice.update({ where: { id: payment.invoiceId }, data: { status: finalStatus, auditEvents: { create: { organizationId: actor.organizationId, actorId: actor.id, eventType, description: `Mock payment outcome: ${outcome}`, metadataJson: JSON.stringify({ outcome, paymentId: payment.id }), requestId } } } });
    const approval = payment.invoice.approvals.find((item) => item.decision === "APPROVED");
    await syncLedgerEntry(tx, { invoiceId: payment.invoiceId, paymentId: savedPayment.id, grossAmountMinor: payment.invoice.amountMinor, currency: payment.invoice.currency, paymentStatus: finalStatus, paymentRail: savedPayment.rail, quoteId: savedPayment.quoteId, transactionHash: savedPayment.transactionHash, refundStatus: savedPayment.refundStatus, paidAt: savedPayment.paidAt, approvedAt: approval?.createdAt });
    return savedPayment;
  });
  return { payment: await findPayment(updated.id, actor.organizationId), idempotent: false };
}
