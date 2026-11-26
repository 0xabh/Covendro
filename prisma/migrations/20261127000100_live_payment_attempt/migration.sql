-- CreateTable
CREATE TABLE "LivePaymentAttempt" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    "quoteExpiresAt" DATETIME NOT NULL,
    "reservationDay" TEXT,
    "reservedDebitAtomic" TEXT,
    "handedOffAt" DATETIME,
    "fundingTxHash" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LivePaymentAttempt_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "LivePaymentAttempt_activeInvoiceId_key" ON "LivePaymentAttempt"("activeInvoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "LivePaymentAttempt_quoteHash_key" ON "LivePaymentAttempt"("quoteHash");

-- CreateIndex
CREATE UNIQUE INDEX "LivePaymentAttempt_fundingTxHash_key" ON "LivePaymentAttempt"("fundingTxHash");

-- CreateIndex
CREATE INDEX "LivePaymentAttempt_organizationId_sourceAsset_reservationDay_idx" ON "LivePaymentAttempt"("organizationId", "sourceAsset", "reservationDay");

-- CreateIndex
CREATE INDEX "LivePaymentAttempt_invoiceId_createdAt_idx" ON "LivePaymentAttempt"("invoiceId", "createdAt");
