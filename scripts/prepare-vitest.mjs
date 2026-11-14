import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const databasePath = path.join(tmpdir(), "covendro-vitest.db");
rmSync(databasePath, { force: true });

execFileSync("npm", ["run", "db:setup"], {
  stdio: "inherit",
  env: { ...process.env, DATABASE_URL: `file:${databasePath}` },
});
