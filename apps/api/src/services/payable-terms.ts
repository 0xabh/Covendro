import { createHash } from "node:crypto";
import type { Invoice, Prisma } from "@prisma/client";
import { pilotMaxDebitMinor } from "./payments/one-click-live.js";
import { ApiError } from "../errors.js";

export async function readPayableTerms(db: Prisma.TransactionClient, invoice: Invoice) {
  const policy = await db.treasuryPolicy.findFirst({
    where: { organizationId: invoice.organizationId, active: true },
    orderBy: { version: "desc" },
  });
  if (!policy || policy.freezePayments) throw new ApiError(409, "PAYMENT_BLOCKED", "The treasury policy does not authorize payment");
  const address = invoice.paymentChain === "base" ? invoice.paymentDestination.toLowerCase() : invoice.paymentDestination;
  const destination = await db.vendorDestination.findFirst({
    where: { vendorId: invoice.vendorId, chain: invoice.paymentChain ?? "", address, verifiedAt: { not: null }, revokedAt: null },
    orderBy: [{ verifiedAt: "desc" }, { id: "desc" }],
  });
  if (!destination) throw new ApiError(409, "VENDOR_DESTINATION_UNVERIFIED", "Verify the vendor destination before authorizing this payable");
  const treasury = await db.treasuryIdentity.findFirst({ where: { organizationId: invoice.organizationId, demoIdentity: false } });
  if (!treasury) throw new ApiError(409, "PILOT_TREASURY_REQUIRED", "Configure the workspace mainnet treasury first");
  const pilotCap = pilotMaxDebitMinor();
  return {
    invoiceId: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    approvalRound: invoice.approvalRound,
    destinationId: destination.id,
    destinationChain: destination.chain,
    destinationAddress: destination.address,
    invoiceCurrency: invoice.currency,
    payableAmountMinor: invoice.amountMinor,
    policyVersion: policy.version,
    treasuryIdentityId: treasury.id,
    sourceAccountId: treasury.nearAccountId,
    refundAccountId: treasury.nearAccountId,
    ...(pilotCap !== null ? { maxAuthorizedDebitMinor: Math.min(pilotCap, policy.maxPaymentPerTransactionMinor) } : {}),
  };
}

export async function currentPayableTerms(db: Prisma.TransactionClient, invoice: Invoice) {
  return JSON.stringify(await readPayableTerms(db, invoice));
}

export function hashPayableTerms(termsJson: string) {
  return createHash("sha256").update(termsJson).digest("hex");
}
