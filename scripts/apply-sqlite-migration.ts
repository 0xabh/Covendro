import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const databaseUrl = process.env.DATABASE_URL ?? "file:./dev.db";
const databasePathValue = databaseUrl.replace(/^file:/, "").split("?")[0];
const databasePath = databasePathValue.startsWith("/")
  ? databasePathValue
  : path.resolve("prisma", databasePathValue);
const migrationPath = path.resolve("prisma/migrations/00000000000000_init/migration.sql");
const aiMigrationPath = path.resolve("prisma/migrations/20261113000100_invoice_ai_analysis/migration.sql");
const treasuryMigrationPath = path.resolve("prisma/migrations/20261113000200_treasury_controls/migration.sql");
const identityMigrationPath = path.resolve("prisma/migrations/20261113000300_treasury_identity/migration.sql");
const approvalMigrationPath = path.resolve("prisma/migrations/20261113000400_approval_workflow/migration.sql");
const approvalRoundsMigrationPath = path.resolve("prisma/migrations/20261113000500_approval_rounds/migration.sql");
const paymentRailsMigrationPath = path.resolve("prisma/migrations/20261113000600_payment_rails/migration.sql");

try {
  const hasOrganizationTable = existsSync(databasePath)
    ? execFileSync("sqlite3", [databasePath, "SELECT 1 FROM sqlite_master WHERE type='table' AND name='Organization' LIMIT 1;"], {
        encoding: "utf8",
      }).trim() === "1"
    : false;

  if (!hasOrganizationTable) {
    execFileSync("sqlite3", [databasePath], {
      input: readFileSync(migrationPath, "utf8"),
      stdio: ["pipe", "inherit", "inherit"],
    });
    console.log(`Applied Covendro SQLite migration at ${databasePath}`);
  }

  const hasAiColumns = existsSync(databasePath)
    ? execFileSync("sqlite3", [databasePath, "PRAGMA table_info('Invoice');"], { encoding: "utf8" }).includes("extractionRequestId")
    : false;

  if (!hasAiColumns) {
    execFileSync("sqlite3", [databasePath], {
      input: readFileSync(aiMigrationPath, "utf8"),
      stdio: ["pipe", "inherit", "inherit"],
    });
    console.log(`Applied Covendro invoice AI migration at ${databasePath}`);
  } else {
    console.log(`SQLite invoice AI schema already exists at ${databasePath}`);
  }

  const hasTreasuryColumns = existsSync(databasePath)
    ? execFileSync("sqlite3", [databasePath, "PRAGMA table_info('Invoice');"], { encoding: "utf8" }).includes("vendorRiskDecision")
    : false;

  if (!hasTreasuryColumns) {
    execFileSync("sqlite3", [databasePath], {
      input: readFileSync(treasuryMigrationPath, "utf8"),
      stdio: ["pipe", "inherit", "inherit"],
    });
    console.log(`Applied Covendro treasury controls migration at ${databasePath}`);
  } else {
    console.log(`SQLite treasury controls schema already exists at ${databasePath}`);
  }

  const hasTreasuryIdentityTable = existsSync(databasePath)
    ? execFileSync("sqlite3", [databasePath, "SELECT 1 FROM sqlite_master WHERE type='table' AND name='TreasuryIdentity' LIMIT 1;"], { encoding: "utf8" }).trim() === "1"
    : false;

  if (!hasTreasuryIdentityTable) {
    execFileSync("sqlite3", [databasePath], {
      input: readFileSync(identityMigrationPath, "utf8"),
      stdio: ["pipe", "inherit", "inherit"],
    });
    console.log(`Applied Covendro treasury identity migration at ${databasePath}`);
  } else {
    console.log(`SQLite treasury identity schema already exists at ${databasePath}`);
  }

  const hasApprovalColumns = existsSync(databasePath)
    ? execFileSync("sqlite3", [databasePath, "PRAGMA table_info('Approval');"], { encoding: "utf8" }).includes("idempotencyKey")
    : false;

  if (!hasApprovalColumns) {
    execFileSync("sqlite3", [databasePath], {
      input: readFileSync(approvalMigrationPath, "utf8"),
      stdio: ["pipe", "inherit", "inherit"],
    });
    console.log(`Applied Covendro approval workflow migration at ${databasePath}`);
  } else {
    console.log(`SQLite approval workflow schema already exists at ${databasePath}`);
  }

  const hasApprovalRound = existsSync(databasePath)
    ? execFileSync("sqlite3", [databasePath, "PRAGMA table_info('Invoice');"], { encoding: "utf8" }).includes("approvalRound")
    : false;

  if (!hasApprovalRound) {
    execFileSync("sqlite3", [databasePath], {
      input: readFileSync(approvalRoundsMigrationPath, "utf8"),
      stdio: ["pipe", "inherit", "inherit"],
    });
    console.log(`Applied Covendro approval rounds migration at ${databasePath}`);
  } else {
    console.log(`SQLite approval rounds schema already exists at ${databasePath}`);
  }

  const hasPaymentRailColumns = existsSync(databasePath)
    ? execFileSync("sqlite3", [databasePath, "PRAGMA table_info('Payment');"], { encoding: "utf8" }).includes("quoteMode")
    : false;

  if (!hasPaymentRailColumns) {
    execFileSync("sqlite3", [databasePath], {
      input: readFileSync(paymentRailsMigrationPath, "utf8"),
      stdio: ["pipe", "inherit", "inherit"],
    });
    console.log(`Applied Covendro payment rails migration at ${databasePath}`);
  } else {
    console.log(`SQLite payment rails schema already exists at ${databasePath}`);
  }
} catch (error) {
  if (error instanceof Error && "code" in error && error.code === "ENOENT") {
    throw new Error("SQLite CLI not found. Install sqlite3 or use `npm run db:migrate:prisma`.");
  }
  throw error;
}
