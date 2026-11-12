import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";

const databasePath = "/private/tmp/covendro-playwright.db";
rmSync(databasePath, { force: true });
execFileSync("npm", ["run", "db:setup"], {
  stdio: "inherit",
  env: { ...process.env, DATABASE_URL: `file:${databasePath}` },
});
