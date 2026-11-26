-- CreateTable
CREATE TABLE "LivePaymentAttempt" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "activeInvoiceId" TEXT,
    "preparedById" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PREPARED',
    "payableTermsJson" TEXT NOT NULL,
    "sourceAsset" TEXT NOT NULL,
    "sourceContract" TEXT NOT NULL,
    "destinationAsset" TEXT NOT NULL,
    "destinationContract" TEXT NOT NULL,
    "originDebitAtomic" TEXT NOT NULL,
    "destinationAmountAtomic" TEXT NOT NULL,
    "refundFeeAtomic" TEXT,
    "withdrawFeeAtomic" TEXT,
    "slippageBps" INTEGER NOT NULL,
    "depositAccountId" TEXT NOT NULL,
    "depositMemo" TEXT,
    "quoteHash" TEXT NOT NULL,
    "providerCorrelationId" TEXT,
    "quoteExpiresAt" TIMESTAMP(3) NOT NULL,
    "reservationDay" TEXT,
    "reservedDebitAtomic" TEXT,
    "handedOffAt" TIMESTAMP(3),
    "fundingTxHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LivePaymentAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LivePaymentAttempt_activeInvoiceId_key" ON "LivePaymentAttempt"("activeInvoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "LivePaymentAttempt_quoteHash_key" ON "LivePaymentAttempt"("quoteHash");

-- CreateIndex
CREATE UNIQUE INDEX "LivePaymentAttempt_fundingTxHash_key" ON "LivePaymentAttempt"("fundingTxHash");

-- CreateIndex
CREATE INDEX "LivePaymentAttempt_organizationId_sourceAsset_reservationDa_idx" ON "LivePaymentAttempt"("organizationId", "sourceAsset", "reservationDay");

-- CreateIndex
CREATE INDEX "LivePaymentAttempt_invoiceId_createdAt_idx" ON "LivePaymentAttempt"("invoiceId", "createdAt");

-- AddForeignKey
ALTER TABLE "LivePaymentAttempt" ADD CONSTRAINT "LivePaymentAttempt_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
