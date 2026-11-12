import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const databaseUrl = process.env.DATABASE_URL ?? "file:./dev.db";
const databasePathValue = databaseUrl.replace(/^file:/, "").split("?")[0];
const databasePath = databasePathValue.startsWith("/")
  ? databasePathValue
  : path.resolve("prisma", databasePathValue);
const migrationPath = path.resolve("prisma/migrations/00000000000000_init/migration.sql");

try {
  const hasOrganizationTable = existsSync(databasePath)
    ? execFileSync("sqlite3", [databasePath, "SELECT 1 FROM sqlite_master WHERE type='table' AND name='Organization' LIMIT 1;"], {
        encoding: "utf8",
      }).trim() === "1"
    : false;

  if (hasOrganizationTable) {
    console.log(`SQLite schema already exists at ${databasePath}`);
  } else {
    execFileSync("sqlite3", [databasePath], {
      input: readFileSync(migrationPath, "utf8"),
      stdio: ["pipe", "inherit", "inherit"],
    });
    console.log(`Applied Covendro SQLite migration at ${databasePath}`);
  }
} catch (error) {
  if (error instanceof Error && "code" in error && error.code === "ENOENT") {
    throw new Error("SQLite CLI not found. Install sqlite3 or use `npm run db:migrate:prisma`.");
  }
  throw error;
}
