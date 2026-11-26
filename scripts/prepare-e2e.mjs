import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync } from "node:fs";

const databaseUrl = process.env.DATABASE_URL ?? `file:${join(tmpdir(), "covendro-playwright.db")}`;
const databasePath = databaseUrl.slice("file:".length);
if (!databaseUrl.startsWith("file:") || !databasePath.endsWith("/covendro-playwright.db")) {
  throw new Error("Browser tests require the isolated Covendro test database path");
}
rmSync(databasePath, { force: true });
execFileSync("npm", ["run", "db:setup"], {
  stdio: "inherit",
  env: { ...process.env, DATABASE_URL: databaseUrl },
});
