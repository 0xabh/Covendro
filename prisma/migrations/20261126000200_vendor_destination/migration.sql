BEGIN;
CREATE TABLE "VendorDestination" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "vendorId" TEXT NOT NULL REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "chain" TEXT NOT NULL,
  "address" TEXT NOT NULL,
  "proposedById" TEXT NOT NULL,
  "verifiedById" TEXT,
  "verifiedAt" DATETIME,
  "revokedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "VendorDestination_vendorId_chain_address_idx" ON "VendorDestination"("vendorId","chain","address");
COMMIT;
