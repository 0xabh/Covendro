ALTER TABLE "Invoice" ADD COLUMN "extractionRequestId" TEXT;
ALTER TABLE "Invoice" ADD COLUMN "analysisCompletedAt" DATETIME;
ALTER TABLE "Invoice" ADD COLUMN "verificationExplanation" TEXT;
ALTER TABLE "Invoice" ADD COLUMN "anomalyResultJson" TEXT;
