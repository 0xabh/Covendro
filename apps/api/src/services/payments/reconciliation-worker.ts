import { randomUUID } from "node:crypto";
import type { LivePaymentAttempt, Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma.js";
import { ApiError } from "../../errors.js";
import { lockTreasuryWorkspace } from "../treasury-lock.js";
import { nearTransactionHash, verifyNearFunding } from "./near-funding-evidence.js";
import { readProviderStatus, verifyBasePayout } from "./reconciliation-evidence.js";

type Funding = Awaited<ReturnType<typeof verifyNearFunding>>;
type Payout = Awaited<ReturnType<typeof verifyBasePayout>>;
const retryMs = 30_000;

async function inspect(attempt: LivePaymentAttempt) {
  const report = await readProviderStatus(attempt);
  const terms = JSON.parse(attempt.payableTermsJson) as { sourceAccountId: string; refundAccountId: string; destinationAddress: string };
  const hints = report.swapDetails;
  const originHashes = [...new Set(hints?.originChainTxHashes?.map(({ hash }) => hash) ?? [])];
  const destinationHashes = [...new Set(hints?.destinationChainTxHashes?.map(({ hash }) => hash.toLowerCase()) ?? [])];
  let funding: Funding | undefined;
  let payout: Payout | undefined;
  let refund: Funding | undefined;
  let issue: string | null = null;

  if (originHashes.length > 1 || (attempt.fundingTxHash && originHashes.some((hash) => hash !== attempt.fundingTxHash))) {
    return { providerStatus: report.status, issue: "ORIGIN_HASH_CONFLICT" };
  }
  if (hints?.depositedAmount && hints.depositedAmount !== "0" && hints.depositedAmount !== attempt.originDebitAtomic) {
    return { providerStatus: report.status, issue: "ORIGIN_DEBIT_MISMATCH" };
  }
  if (!attempt.fundingTxHash && originHashes.length) {
    const txHash = nearTransactionHash.safeParse(originHashes[0]);
    if (!txHash.success) return { providerStatus: report.status, issue: "ORIGIN_HASH_INVALID" };
    funding = await verifyNearFunding({
      txHash: txHash.data, signerId: terms.sourceAccountId, tokenContract: attempt.sourceContract,
      recipient: attempt.depositAccountId, amountAtomic: attempt.originDebitAtomic, memo: attempt.depositMemo,
    });
  }

  const hasFunding = Boolean(attempt.fundingTxHash || funding);
  if (report.status === "SUCCESS" && hasFunding && destinationHashes.length === 1) {
    payout = await verifyBasePayout({
      txHash: destinationHashes[0], tokenContract: attempt.destinationContract,
      recipient: terms.destinationAddress, amountAtomic: attempt.destinationAmountAtomic,
    });
    if (!hints?.amountIn || BigInt(hints.amountIn) + BigInt(hints.refundedAmount ?? "0") !== BigInt(attempt.originDebitAtomic)) {
      issue = "ORIGIN_ACCOUNTING_MISMATCH";
    } else if (hints.refundedAmount && hints.refundedAmount !== "0") {
      issue = "REFUND_EVIDENCE_REQUIRED";
    }
  } else if (report.status === "SUCCESS") {
    issue = hasFunding ? "BASE_PAYOUT_EVIDENCE_REQUIRED" : "ORIGIN_EVIDENCE_REQUIRED";
  } else if (report.status === "REFUNDED") {
    issue = "REFUND_EVIDENCE_REQUIRED";
  } else if (report.status === "FAILED" || report.status === "INCOMPLETE_DEPOSIT") {
    issue = report.status === "FAILED" ? "PROVIDER_FAILURE" : "PARTIAL_DEPOSIT";
  } else if (!hasFunding && attempt.quoteExpiresAt.getTime() <= Date.now()) {
    issue = "EXPIRED_AFTER_HANDOFF";
  }
  if (issue === "REFUND_EVIDENCE_REQUIRED" && hasFunding && hints?.refundedAmount &&
      BigInt(hints.refundedAmount) > 0n && BigInt(hints.refundedAmount) <= BigInt(attempt.originDebitAtomic)) {
    const refundSigner = process.env.PILOT_NEAR_REFUND_SENDER;
    const candidates = [...new Set(hints.nearTxHashes ?? [])].filter((hash) =>
      hash !== (attempt.fundingTxHash ?? funding?.txHash) && nearTransactionHash.safeParse(hash).success);
    if (refundSigner && candidates.length === 1) {
      refund = await verifyNearFunding({
        txHash: candidates[0], signerId: refundSigner, tokenContract: attempt.sourceContract,
        recipient: terms.refundAccountId, amountAtomic: hints.refundedAmount, memo: null,
      });
      issue = null;
    }
  }
  return { providerStatus: report.status, funding, payout, refund, issue };
}

async function persistOutcome(attempt: LivePaymentAttempt, result: Awaited<ReturnType<typeof inspect>>) {
  return prisma.$transaction(async (tx) => {
    await lockTreasuryWorkspace(tx, attempt.organizationId);
    const current = await tx.livePaymentAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
    if (!current.activeInvoiceId || current.leaseToken !== attempt.leaseToken) return;
    if (current.destinationTxHash && result.payout && current.destinationTxHash !== result.payout.hash) {
      result = { providerStatus: result.providerStatus, issue: "BASE_PAYOUT_HASH_CONFLICT" };
    }
    if (result.funding && current.fundingTxHash && current.fundingTxHash !== result.funding.txHash) {
      result = { providerStatus: result.providerStatus, issue: "ORIGIN_HASH_CONFLICT" };
    }
    const now = new Date();
    const payment = await tx.payment.findUniqueOrThrow({ where: { invoiceId: current.invoiceId } });
    const events: Prisma.AuditEventCreateManyInput[] = [];
    const audit = (eventType: string, description: string, evidence: object) => events.push({
      organizationId: current.organizationId, invoiceId: current.invoiceId, paymentId: payment.id,
      eventType, description, metadataJson: JSON.stringify({ attemptId: current.id, ...evidence }),
    });
    const data: Prisma.LivePaymentAttemptUpdateInput = {
      nextCheckAt: new Date(now.getTime() + retryMs), leaseUntil: null, leaseToken: null, checkFailures: 0,
      providerStatus: result.providerStatus, reconcileIssue: result.issue,
    };
    const paymentData: Prisma.PaymentUpdateInput = { providerStatus: result.providerStatus };
    const ledgerData: Prisma.LedgerEntryUpdateInput = {};
    if (result.funding && !current.fundingTxHash) {
      data.fundingTxHash = result.funding.txHash;
      data.fundedAt = now;
      data.status = "FUNDING_CONFIRMED";
      paymentData.transactionHash = result.funding.txHash;
      ledgerData.transactionHash = result.funding.txHash;
      audit("LIVE_ORIGIN_FUNDING_CONFIRMED", "Verified the finalized NEAR funding transfer", result.funding);
    }
    if (result.payout && !current.destinationTxHash) {
      data.destinationTxHash = result.payout.hash;
      audit("LIVE_BASE_DELIVERY_VERIFIED", "Verified finalized Base USDC delivery against the approved payable", result.payout);
    }
    if (result.refund && !current.refundTxHash) {
      data.refundTxHash = result.refund.txHash;
      data.refundedAtomic = result.refund.amountAtomic;
      paymentData.refundStatus = "REFUNDED";
      ledgerData.refundStatus = "REFUNDED";
      audit("LIVE_NEAR_REFUND_VERIFIED", "Verified a finalized NEAR refund against the approved treasury account", result.refund);
    }
    const outcome = result.payout && !result.issue ? "PAID" : result.refund && result.providerStatus === "REFUNDED" ? "REFUNDED" : null;
    if (outcome) {
      data.status = outcome === "PAID" ? "SETTLED" : "REFUNDED";
      data.settledAt = now;
      data.activeInvoiceId = null;
      data.nextCheckAt = null;
      paymentData.status = outcome;
      paymentData.paidAt = outcome === "PAID" ? now : null;
      ledgerData.paymentStatus = outcome;
      ledgerData.paidAt = outcome === "PAID" ? now : null;
      await tx.invoice.update({ where: { id: current.invoiceId }, data: { status: outcome } });
    }
    if (result.issue && current.reconcileIssue !== result.issue) {
      audit("LIVE_RECONCILIATION_REQUIRED", "A payment attempt needs reconciliation", { issue: result.issue });
    }
    await tx.livePaymentAttempt.update({ where: { id: current.id }, data });
    await tx.payment.update({ where: { id: payment.id }, data: paymentData });
    if (Object.keys(ledgerData).length) await tx.ledgerEntry.update({ where: { invoiceId: current.invoiceId }, data: ledgerData });
    if (events.length) await tx.auditEvent.createMany({ data: events });
  });
}

export async function reconcileDuePayments(limit = 10) {
  const now = new Date();
  const due: Prisma.LivePaymentAttemptWhereInput = {
    activeInvoiceId: { not: null }, handedOffAt: { not: null }, nextCheckAt: { lte: now },
    OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }],
  };
  const jobs = await prisma.livePaymentAttempt.findMany({ where: due, select: { id: true }, orderBy: { nextCheckAt: "asc" }, take: limit });
  for (const { id } of jobs) {
    const leaseToken = randomUUID();
    const lease = await prisma.livePaymentAttempt.updateMany({
      where: { ...due, id }, data: { leaseToken, leaseUntil: new Date(Date.now() + 120_000) },
    });
    if (!lease.count) continue;
    const attempt = await prisma.livePaymentAttempt.findUniqueOrThrow({ where: { id } });
    try {
      await persistOutcome(attempt, await inspect(attempt));
    } catch (error) {
      const issue = error instanceof ApiError ? error.code : "RECONCILIATION_RETRY";
      const retry = Math.min(15 * 60_000, retryMs * 2 ** Math.min(attempt.checkFailures, 5));
      await prisma.livePaymentAttempt.updateMany({
        where: { id, leaseToken }, data: {
          checkFailures: { increment: 1 }, reconcileIssue: issue, nextCheckAt: new Date(Date.now() + retry),
          leaseUntil: null, leaseToken: null,
        },
      });
    }
  }
  return jobs.length;
}
