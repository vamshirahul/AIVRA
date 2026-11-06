import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, mkdir, writeFile } from "node:fs/promises";

// Focused shipped-source review. Never reads local .env values or prints matches.
const tracked = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
const production = tracked.filter(p => /^(app|components|lib|public)\//.test(p));
const credential = /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}|\bAKIA[A-Z0-9]{16}\b|\bgh[pousr]_[A-Za-z0-9]{30,}/;
for (const file of production) {
  if (!/\.(?:[cm]?[jt]sx?|json|css|html|svg)$/.test(file)) continue;
  const source = await readFile(file, "utf8");
  assert.ok(!credential.test(source), `Potential credential in tracked production file: ${file}`);
  assert.ok(!/NEXT_PUBLIC_[A-Z_]*(?:API_KEY|SECRET|TOKEN|PASSWORD)/.test(source), `Public credential configuration: ${file}`);
}
assert.equal(tracked.some(p => /(^|\/)\.env(?:$|\.(?!example$))/.test(p)), false, "Only blank .env.example may be tracked");
const example = await readFile(".env.example", "utf8");
for (const line of example.split(/\r?\n/).filter(s => s.trim() && !s.trim().startsWith("#"))) assert.ok(/^[A-Z_]+=\s*$/.test(line), "Example environment values stay blank");
await mkdir(".temp/u90-03", { recursive: true });
await writeFile(".temp/u90-03/privacy-review.json", JSON.stringify({ status: "PASS", production_files_reviewed: production.length, matched_secret_values_logged: false, local_env_values_read: false, limitations: "High-confidence pattern review, not an exhaustive secret scanner or penetration test. Browser bundle/public ingress boundaries remain covered by existing AI suites." }, null, 2));
console.log(`PASS: U90.03 tracked-source secrets review (${production.length} production paths), no public credential variables or tracked private env files; blank environment template.`);
