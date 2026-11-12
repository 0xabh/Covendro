CREATE TABLE "TreasuryIdentity" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nearAccountId" TEXT NOT NULL,
    "keyPurpose" TEXT NOT NULL,
    "accessKeyPermissionScope" TEXT NOT NULL,
    "keyType" TEXT NOT NULL DEFAULT 'FUNCTION_CALL',
    "demoIdentity" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TreasuryIdentity_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "TreasuryIdentity_organizationId_nearAccountId_key" ON "TreasuryIdentity"("organizationId", "nearAccountId");
CREATE INDEX "TreasuryIdentity_organizationId_demoIdentity_idx" ON "TreasuryIdentity"("organizationId", "demoIdentity");
