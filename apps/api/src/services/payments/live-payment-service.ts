import type { LivePaymentAttempt, Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma.js";
import { ApiError } from "../../errors.js";
import { hasMainnetFullAccessKey, treasuryProofBinding } from "../treasury-proof.js";
import { assessInvoiceControls } from "../risk-assessment-service.js";
import { readPayableTerms } from "../payable-terms.js";
import { lockTreasuryWorkspace } from "../treasury-lock.js";
import { syncLedgerEntry } from "../ledger-service.js";
import { verifyNearFunding } from "./near-funding-evidence.js";
import { pilotRoute, requestLiveQuote, usdcAtomicPerCent } from "./one-click-live.js";

type Signer = { id: string; role: string; organizationId: string; organization: { slug: string } };
const nearGas = "30000000000000";
const oneYoctoNear = "1";

export function requireLiveSigner(actor: Signer) {
  if (process.env.DEMO_MODE !== "false" || !process.env.PILOT_LIVE_WORKSPACE_SLUG ||
      actor.organization.slug !== process.env.PILOT_LIVE_WORKSPACE_SLUG) {
    throw new ApiError(404, "LIVE_PAYMENT_UNAVAILABLE", "Live quote preparation is unavailable for this workspace");
  }
  if (actor.role !== "TREASURY_SIGNER") throw new ApiError(403, "TREASURY_SIGNER_REQUIRED", "Treasury signer access is required");
}

export function summarizeAttempt(attempt: LivePaymentAttempt) {
  const terms = JSON.parse(attempt.payableTermsJson) as Awaited<ReturnType<typeof readPayableTerms>>;
  return {
    sourceAccountId: terms.sourceAccountId, refundAccountId: terms.refundAccountId,
    destinationAddress: terms.destinationAddress, maxAuthorizedDebitMinor: terms.maxAuthorizedDebitMinor,
    id: attempt.id, status: attempt.status, invoiceId: attempt.invoiceId,
    sourceAsset: attempt.sourceAsset, sourceContract: attempt.sourceContract,
    destinationAsset: attempt.destinationAsset, destinationContract: attempt.destinationContract,
    originDebitAtomic: attempt.originDebitAtomic, destinationAmountAtomic: attempt.destinationAmountAtomic,
    refundFeeAtomic: attempt.refundFeeAtomic, withdrawFeeAtomic: attempt.withdrawFeeAtomic,
    slippageBps: attempt.slippageBps, quoteExpiresAt: attempt.quoteExpiresAt, handedOffAt: attempt.handedOffAt,
    fundingTxHash: attempt.fundingTxHash, destinationTxHash: attempt.destinationTxHash,
    reconcileIssue: attempt.reconcileIssue, settledAt: attempt.settledAt, fundedAt: attempt.fundedAt,
    refundTxHash: attempt.refundTxHash, refundedAtomic: attempt.refundedAtomic,
  };
}

async function authorizePayable(db: Prisma.TransactionClient, invoiceId: string, actor: Signer) {
  const invoice = await db.invoice.findFirst({
    where: { id: invoiceId, organizationId: actor.organizationId },
    include: { payment: true },
  });
  if (!invoice) throw new ApiError(404, "INVOICE_NOT_FOUND", "Invoice was not found");
  if (invoice.createdById === actor.id || !["APPROVED", "QUOTE_READY"].includes(invoice.status) ||
      (invoice.status === "QUOTE_READY" && invoice.payment?.quoteMode !== "REAL_DRY") ||
      invoice.verificationState !== "HUMAN_VERIFIED") {
    throw new ApiError(409, "LIVE_PAYABLE_NOT_AUTHORIZED", "A confirmed and independently approved invoice is required");
  }
  const terms = await readPayableTerms(db, invoice);
  if (terms.destinationChain !== "base" || terms.invoiceCurrency !== "USDC" ||
      terms.destinationAddress === "0x0000000000000000000000000000000000000000" ||
      !terms.maxAuthorizedDebitMinor || terms.payableAmountMinor <= 0) {
    throw new ApiError(409, "LIVE_TERMS_UNSUPPORTED", "A Base USDC payable and an approved maximum debit are required");
  }
  const termsJson = JSON.stringify(terms);
  const approvals = await db.approval.findMany({
    where: {
      invoiceId, approvalRound: invoice.approvalRound, decision: "APPROVED", payableTermsJson: termsJson,
      reviewerId: { notIn: [actor.id, invoice.createdById] },
      reviewer: { organizationId: actor.organizationId, role: { in: ["REVIEWER", "TREASURY_ADMINISTRATOR"] } },
    },
    orderBy: { createdAt: "desc" },
  });
  const controls = await assessInvoiceControls(invoiceId, actor.organizationId, db);
  if (controls.policySnapshot.demoMode || controls.policy.decision === "BLOCK" || controls.vendorRisk.decision === "BLOCK") {
    throw new ApiError(409, "PAYMENT_BLOCKED", "The current policy or vendor risk blocks this payable");
  }
  if (approvals.length < Math.max(controls.policySnapshot.reviewerQuorum ?? 1, invoice.requiredApprovals ?? 1, controls.policy.requiredApprovals, controls.vendorRisk.requiredApprovals)) {
    throw new ApiError(409, "APPROVAL_TERMS_CHANGED", "The current payable needs fresh reviewer approval");
  }
  return { invoice, terms, termsJson, policy: controls.policySnapshot, approvedAt: approvals[0].createdAt };
}

function verifyDebitCap(originDebitAtomic: string, capMinor: number | undefined) {
  if (!capMinor || BigInt(originDebitAtomic) > BigInt(capMinor) * usdcAtomicPerCent) {
    throw new ApiError(409, "LIVE_DEBIT_CAP_EXCEEDED", "The quote exceeds the approved treasury debit");
  }
}

export async function prepareLiveAttempt(invoiceId: string, actor: Signer, requestId: string) {
  requireLiveSigner(actor);
  const active = await prisma.livePaymentAttempt.findFirst({ where: { activeInvoiceId: invoiceId, organizationId: actor.organizationId } });
  if (active && (active.handedOffAt || active.quoteExpiresAt > new Date())) return summarizeAttempt(active);

  const route = pilotRoute();
  const initial = await authorizePayable(prisma, invoiceId, actor);
  const quote = await requestLiveQuote(route, initial.terms);
  verifyDebitCap(quote.originDebitAtomic, initial.terms.maxAuthorizedDebitMinor);
  const result = await prisma.$transaction(async (tx) => {
    await lockTreasuryWorkspace(tx, actor.organizationId);
    const existing = await tx.livePaymentAttempt.findUnique({ where: { activeInvoiceId: invoiceId } });
    const now = new Date();
    if (existing && (existing.handedOffAt || existing.quoteExpiresAt > now)) return existing;
    const current = await authorizePayable(tx, invoiceId, actor);
    if (current.termsJson !== initial.termsJson || quote.quoteExpiresAt.getTime() <= now.getTime() + 30_000) {
      throw new ApiError(409, "LIVE_QUOTE_STALE", "The payable or quote changed; prepare a fresh quote");
    }
    if (existing) {
      await tx.livePaymentAttempt.update({ where: { id: existing.id }, data: { status: "EXPIRED_UNEXPOSED", activeInvoiceId: null } });
    }
    const attempt = await tx.livePaymentAttempt.create({ data: {
      organizationId: actor.organizationId, invoiceId, activeInvoiceId: invoiceId, preparedById: actor.id,
      payableTermsJson: current.termsJson,
      sourceAsset: route.sourceAsset, sourceContract: route.sourceContract,
      destinationAsset: route.destinationAsset, destinationContract: route.destinationContract, ...quote,
    } });
    await tx.auditEvent.create({ data: {
      organizationId: actor.organizationId, invoiceId, actorId: actor.id, requestId,
      eventType: "LIVE_QUOTE_PREPARED", description: "Verified and persisted an exact-output quote",
      metadataJson: JSON.stringify({ attemptId: attempt.id, quoteHash: attempt.quoteHash }),
    } });
    return attempt;
  });
  return summarizeAttempt(result);
}

async function activeProof(db: Prisma.TransactionClient, treasuryId: string, actor: Signer, sessionDigest: string) {
  const now = new Date();
  const binding = treasuryProofBinding(treasuryId, sessionDigest);
  const [session, proof] = await Promise.all([
    db.workspaceCredential.findFirst({ where: { digest: sessionDigest, userId: actor.id, purpose: "SESSION", expiresAt: { gt: now }, user: { role: "TREASURY_SIGNER", organizationId: actor.organizationId } } }),
    db.workspaceCredential.findFirst({ where: { userId: actor.id, purpose: { startsWith: binding }, expiresAt: { gt: now } } }),
  ]);
  if (!session || !proof) throw new ApiError(403, "TREASURY_PROOF_REQUIRED", "Verify the treasury wallet in this session before funding");
  return proof.purpose.slice(binding.length);
}

async function verifyFundingPreflight(attempt: LivePaymentAttempt, sourceAccountId: string, publicKey: string) {
  if (!await hasMainnetFullAccessKey(sourceAccountId, publicKey)) {
    throw new ApiError(403, "TREASURY_PROOF_REJECTED", "The verified treasury key is no longer active on NEAR mainnet");
  }
  const url = process.env.NEAR_TREASURY_RPC_URL!;
  async function query(params: object) {
    try {
      const response = await fetch(url, {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(5_000),
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method: "query", id: "covendro-funding-preflight", params: { finality: "final", ...params } }),
      });
      const result = await response.json() as { result?: { result?: number[]; amount?: string }; error?: unknown };
      if (!response.ok || !result.result || result.error) throw new Error("Invalid NEAR RPC result");
      return result.result;
    } catch {
      throw new ApiError(503, "NEAR_RPC_UNAVAILABLE", "The NEAR funding preflight is temporarily unavailable");
    }
  }
  async function view(method: string, account: string): Promise<unknown> {
    const response = await query({
      request_type: "call_function", account_id: attempt.sourceContract, method_name: method,
      args_base64: Buffer.from(JSON.stringify({ account_id: account })).toString("base64"),
    });
    try {
      return JSON.parse(Buffer.from(response.result ?? []).toString());
    } catch {
      throw new ApiError(503, "TOKEN_VIEW_UNAVAILABLE", "The approved token contract returned invalid funding data");
    }
  }
  const [balance, storage, treasury] = await Promise.all([
    view("ft_balance_of", sourceAccountId),
    view("storage_balance_of", attempt.depositAccountId),
    query({ request_type: "view_account", account_id: sourceAccountId }),
  ]);
  const storageTotal = storage && typeof storage === "object" && "total" in storage ? storage.total : null;
  if (typeof storageTotal !== "string" || !/^\d+$/.test(storageTotal) || BigInt(storageTotal) <= 0n) throw new ApiError(409, "DEPOSIT_STORAGE_REQUIRED", "The quote deposit account is not registered for the origin token");
  if (typeof balance !== "string" || !/^\d+$/.test(balance) || BigInt(balance) < BigInt(attempt.originDebitAtomic)) {
    throw new ApiError(409, "INSUFFICIENT_TOKEN_BALANCE", "The treasury wallet balance cannot fund the quote");
  }
  // Maintain a small pilot gas buffer instead of adding a storage or NEAR transfer.
  if (!treasury.amount || !/^\d+$/.test(treasury.amount) || BigInt(treasury.amount) < 10n ** 22n) {
    throw new ApiError(409, "INSUFFICIENT_GAS_BALANCE", "The treasury wallet must have at least 0.01 NEAR for gas");
  }
}

export async function handoffLiveAttempt(attemptId: string, actor: Signer, sessionDigest: string, requestId: string) {
  requireLiveSigner(actor);
  if (process.env.PILOT_ENABLE_WALLET_HANDOFF !== "true") {
    throw new ApiError(503, "WALLET_HANDOFF_DISABLED", "Wallet handoff has not been enabled for this pilot");
  }
  const candidate = await prisma.livePaymentAttempt.findFirst({ where: { id: attemptId, organizationId: actor.organizationId } });
  if (!candidate) throw new ApiError(404, "LIVE_ATTEMPT_NOT_FOUND", "Payment attempt was not found");
  if (candidate.handedOffAt) throw new ApiError(409, "WALLET_HANDOFF_ALREADY_ISSUED", "This attempt is already awaiting funding evidence");
  const initial = await authorizePayable(prisma, candidate.invoiceId, actor);
  const key = await activeProof(prisma, initial.terms.treasuryIdentityId, actor, sessionDigest);
  if (candidate.status !== "PREPARED" || candidate.payableTermsJson !== initial.termsJson || candidate.quoteExpiresAt.getTime() <= Date.now() + 30_000) {
    throw new ApiError(409, "LIVE_QUOTE_STALE", "The payable or quote changed; prepare a fresh quote");
  }
  await verifyFundingPreflight(candidate, initial.terms.sourceAccountId, key);

  return prisma.$transaction(async (tx) => {
    await lockTreasuryWorkspace(tx, actor.organizationId);
    const current = await tx.livePaymentAttempt.findFirst({ where: { id: attemptId, organizationId: actor.organizationId } });
    const payable = await authorizePayable(tx, candidate.invoiceId, actor);
    const proofKey = await activeProof(tx, payable.terms.treasuryIdentityId, actor, sessionDigest);
    const route = pilotRoute();
    const now = new Date();
    if (!current || current.status !== "PREPARED" || current.activeInvoiceId !== current.invoiceId ||
        current.quoteExpiresAt.getTime() <= now.getTime() + 30_000 || current.payableTermsJson !== payable.termsJson ||
        proofKey !== key || current.sourceAsset !== route.sourceAsset || current.sourceContract !== route.sourceContract ||
        current.destinationAsset !== route.destinationAsset || current.destinationContract !== route.destinationContract) {
      throw new ApiError(409, "LIVE_QUOTE_STALE", "The quote or wallet authorization is no longer current");
    }
    verifyDebitCap(current.originDebitAtomic, payable.terms.maxAuthorizedDebitMinor);
    const reservationDay = now.toISOString().slice(0, 10);
    const exposure = await tx.livePaymentAttempt.findMany({
      where: { organizationId: actor.organizationId, sourceAsset: current.sourceAsset,
        reservedDebitAtomic: { not: null },
        OR: [{ reservationDay }, { activeInvoiceId: { not: null }, fundingTxHash: null }, { fundedAt: { gte: new Date(reservationDay + "T00:00:00Z") } }],
      },
      select: { reservedDebitAtomic: true },
    });
    const reserved = exposure.reduce((sum, item) => sum + BigInt(item.reservedDebitAtomic!), 0n);
    if (reserved + BigInt(current.originDebitAtomic) > BigInt(payable.policy.maxDailyPaymentTotalMinor) * usdcAtomicPerCent) {
      throw new ApiError(409, "DAILY_SPEND_LIMIT_EXCEEDED", "The debit would exceed the workspace daily limit including outstanding reservations");
    }
    const claimed = await tx.invoice.updateMany({
      where: { id: current.invoiceId, status: payable.invoice.status, approvalRound: payable.invoice.approvalRound },
      data: { status: "PAYMENT_PENDING" },
    });
    if (claimed.count !== 1) throw new ApiError(409, "APPROVAL_TERMS_CHANGED", "The invoice changed while reserving the debit");
    const attempt = await tx.livePaymentAttempt.update({ where: { id: current.id }, data: {
      status: "AWAITING_FUNDING", handedOffAt: now, nextCheckAt: now, reservationDay, reservedDebitAtomic: current.originDebitAtomic,
    } });
    const payment = await tx.payment.upsert({
      where: { invoiceId: current.invoiceId },
      create: { invoiceId: current.invoiceId, organizationId: actor.organizationId, amountMinor: payable.invoice.amountMinor,
        status: "PAYMENT_PENDING", rail: "NEAR_INTENTS", quoteMode: "LIVE_HANDOFF", quoteId: current.quoteHash },
      update: { status: "PAYMENT_PENDING", rail: "NEAR_INTENTS", quoteMode: "LIVE_HANDOFF", quoteId: current.quoteHash },
    });
    await syncLedgerEntry(tx, { invoiceId: current.invoiceId, paymentId: payment.id, grossAmountMinor: payable.invoice.amountMinor,
      currency: payable.invoice.currency, paymentStatus: "PAYMENT_PENDING", paymentRail: payment.rail, quoteId: current.quoteHash, approvedAt: payable.approvedAt });
    await tx.auditEvent.create({ data: {
      organizationId: actor.organizationId, actorId: actor.id, invoiceId: current.invoiceId, paymentId: payment.id, requestId,
      eventType: "LIVE_WALLET_HANDOFF_ISSUED", description: "Reserved the quoted debit before issuing wallet instructions",
      metadataJson: JSON.stringify({ attemptId: current.id, reservationDay, reservedDebitAtomic: current.originDebitAtomic }),
    } });
    return {
      attempt: summarizeAttempt(attempt),
      walletRequest: {
        network: "mainnet",
        signerId: payable.terms.sourceAccountId,
        receiverId: current.sourceContract,
        actions: [{ type: "FunctionCall", params: { methodName: "ft_transfer",
          args: { receiver_id: current.depositAccountId, amount: current.originDebitAtomic, ...(current.depositMemo ? { memo: current.depositMemo } : {}) },
          gas: nearGas, deposit: oneYoctoNear } }],
      },
    };
  });
}

export async function confirmLiveFunding(attemptId: string, txHash: string, actor: Signer, requestId: string) {
  requireLiveSigner(actor);
  const attempt = await prisma.livePaymentAttempt.findFirst({ where: { id: attemptId, organizationId: actor.organizationId } });
  if (!attempt) throw new ApiError(404, "LIVE_ATTEMPT_NOT_FOUND", "Payment attempt was not found");
  if (attempt.fundingTxHash === txHash) return summarizeAttempt(attempt);
  if (attempt.status !== "AWAITING_FUNDING" || !attempt.handedOffAt || attempt.fundingTxHash) {
    throw new ApiError(409, "FUNDING_EVIDENCE_NOT_EXPECTED", "This attempt is not awaiting a funding transaction");
  }
  const terms = JSON.parse(attempt.payableTermsJson) as Awaited<ReturnType<typeof readPayableTerms>>;
  const evidence = await verifyNearFunding({
    txHash, signerId: terms.sourceAccountId, tokenContract: attempt.sourceContract,
    recipient: attempt.depositAccountId, amountAtomic: attempt.originDebitAtomic, memo: attempt.depositMemo,
  });

  const result = await prisma.$transaction(async (tx) => {
    await lockTreasuryWorkspace(tx, actor.organizationId);
    const current = await tx.livePaymentAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
    if (current.fundingTxHash === txHash) return current;
    if (current.status !== "AWAITING_FUNDING" || current.fundingTxHash) {
      throw new ApiError(409, "FUNDING_EVIDENCE_NOT_EXPECTED", "A different funding outcome is already recorded");
    }
    const existing = await tx.livePaymentAttempt.findUnique({ where: { fundingTxHash: txHash } });
    if (existing) throw new ApiError(409, "FUNDING_EVIDENCE_REUSED", "This origin transaction was already recorded");
    const updated = await tx.livePaymentAttempt.update({
      where: { id: current.id }, data: { fundingTxHash: evidence.txHash, status: "FUNDING_CONFIRMED", fundedAt: new Date(), nextCheckAt: new Date() },
    });
    const payment = await tx.payment.update({
      where: { invoiceId: current.invoiceId },
      data: { transactionHash: evidence.txHash, providerStatus: "ORIGIN_FUNDING_CONFIRMED" },
    });
    await tx.ledgerEntry.update({ where: { invoiceId: current.invoiceId }, data: { transactionHash: evidence.txHash } });
    await tx.auditEvent.create({ data: {
      organizationId: actor.organizationId, actorId: actor.id, invoiceId: current.invoiceId, paymentId: payment.id, requestId,
      eventType: "LIVE_ORIGIN_FUNDING_CONFIRMED", description: "Verified a finalized NEAR token transfer against the funding attempt",
      metadataJson: JSON.stringify({ attemptId, ...evidence }),
    } });
    return updated;
  });
  return summarizeAttempt(result);
}
