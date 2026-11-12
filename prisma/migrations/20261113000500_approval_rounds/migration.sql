ALTER TABLE "Invoice" ADD COLUMN "approvalRound" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Approval" ADD COLUMN "approvalRound" INTEGER NOT NULL DEFAULT 1;
DROP INDEX "Approval_invoiceId_reviewerId_key";
CREATE UNIQUE INDEX "Approval_invoiceId_reviewerId_approvalRound_key" ON "Approval"("invoiceId", "reviewerId", "approvalRound");
