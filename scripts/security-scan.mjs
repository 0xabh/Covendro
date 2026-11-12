import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const repositoryFiles = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean);

const forbiddenNames = new Set([".env", ".env.local", ".env.production", "dev.db"]);
const privateKeyPattern = /-----BEGIN [A-Z ]*PRIVATE KEY-----/;
const credentialAssignmentPattern = /(?:API_KEY|JWT|SECRET|PRIVATE_KEY)\s*[:=]\s*["']?[^\s"']{12,}/;
const failures = [];

for (const relativeFile of repositoryFiles) {
  const fileName = path.basename(relativeFile);
  if (forbiddenNames.has(fileName)) failures.push(`${relativeFile}: prohibited secret/local-data file`);

  let content;
  try {
    content = readFileSync(path.join(root, relativeFile), "utf8");
  } catch {
    continue;
  }

  if (privateKeyPattern.test(content)) failures.push(`${relativeFile}: private key material detected`);
  if (!relativeFile.endsWith(".example") && !relativeFile.endsWith(".md") && credentialAssignmentPattern.test(content)) {
    failures.push(`${relativeFile}: non-empty credential assignment detected`);
  }
}

if (failures.length > 0) {
  console.error("Security scan failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Security scan passed: ${repositoryFiles.length} repository files checked; no keys, private keys, or local databases found.`);
