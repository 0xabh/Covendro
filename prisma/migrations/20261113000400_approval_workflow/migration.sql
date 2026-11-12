ALTER TABLE "TreasuryPolicy" ADD COLUMN "allowSelfApproval" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Approval" ADD COLUMN "idempotencyKey" TEXT;
CREATE UNIQUE INDEX "Approval_idempotencyKey_key" ON "Approval"("idempotencyKey");
