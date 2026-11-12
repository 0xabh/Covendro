ALTER TABLE "Payment" ADD COLUMN "quoteMode" TEXT;
ALTER TABLE "Payment" ADD COLUMN "providerStatus" TEXT;
ALTER TABLE "Payment" ADD COLUMN "quoteRequestId" TEXT;
ALTER TABLE "Payment" ADD COLUMN "depositAddress" TEXT;
ALTER TABLE "Payment" ADD COLUMN "depositMemo" TEXT;
ALTER TABLE "Payment" ADD COLUMN "depositRequirementsJson" TEXT;
ALTER TABLE "Payment" ADD COLUMN "idempotencyKey" TEXT;
CREATE UNIQUE INDEX "Payment_idempotencyKey_key" ON "Payment"("idempotencyKey");
