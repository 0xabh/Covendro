import type { Prisma } from "@prisma/client";

export async function syncLedgerEntry(
  tx: Prisma.TransactionClient,
  input: {
    invoiceId: string;
    paymentId: string;
    grossAmountMinor: number;
    currency: string;
    paymentStatus: string;
    paymentRail?: string | null;
    quoteId?: string | null;
    transactionHash?: string | null;
    refundStatus?: string | null;
    paidAt?: Date | null;
    approvedAt?: Date | null;
  },
) {
  return tx.ledgerEntry.upsert({
    where: { invoiceId: input.invoiceId },
    create: input,
    update: {
      paymentId: input.paymentId,
      grossAmountMinor: input.grossAmountMinor,
      currency: input.currency,
      paymentStatus: input.paymentStatus,
      paymentRail: input.paymentRail,
      quoteId: input.quoteId,
      transactionHash: input.transactionHash,
      refundStatus: input.refundStatus,
      paidAt: input.paidAt,
      approvedAt: input.approvedAt,
    },
  });
}
