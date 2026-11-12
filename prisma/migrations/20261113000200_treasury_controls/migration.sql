ALTER TABLE "Invoice" ADD COLUMN "vendorRiskDecision" TEXT;
ALTER TABLE "Invoice" ADD COLUMN "vendorRiskReasonsJson" TEXT;
ALTER TABLE "Invoice" ADD COLUMN "policyDecision" TEXT;
ALTER TABLE "Invoice" ADD COLUMN "policyReasonsJson" TEXT;
ALTER TABLE "Invoice" ADD COLUMN "requiredApprovals" INTEGER;
ALTER TABLE "Invoice" ADD COLUMN "policyVersion" INTEGER;
