CREATE TABLE "WorkspaceCredential" (
  "digest" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "purpose" TEXT NOT NULL,
  "expiresAt" DATETIME NOT NULL,
  CONSTRAINT "WorkspaceCredential_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "WorkspaceCredential_userId_idx" ON "WorkspaceCredential"("userId");
