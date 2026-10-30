/**
 * Pushes the Square secrets from the secret store to the Worker, generating the token-encryption key on first use.
 *
 *   npx tsx scripts/square-secrets.ts
 *
 * secret store LOCALEDITION_SQUARE_ACCESS_TOKEN -> SQUARE_ACCESS_TOKEN   (sample chain's sandbox token)
 * secret store LOCALEDITION_SQUARE_APP_ID       -> SQUARE_APP_ID         (OAuth application)
 * secret store LOCALEDITION_SQUARE_APP_SECRET   -> SQUARE_APP_SECRET
 * secret store LOCALEDITION_SQUARE_TOKEN_KEY    -> SQUARE_TOKEN_KEY      (AES-256 key for tokens at rest; generated here when absent)
 * Values are piped, never printed. SQUARE_WEBHOOK_SIGNATURE_KEY is handled by scripts/square-webhook.ts.
 */
import { randomBytes } from "node:crypto";
import { secretGet, secretSet, wranglerSecretPut } from "./square/lib";

const PAIRS: [string, string][] = [
  ["LOCALEDITION_SQUARE_ACCESS_TOKEN", "SQUARE_ACCESS_TOKEN"],
  ["LOCALEDITION_SQUARE_APP_ID", "SQUARE_APP_ID"],
  ["LOCALEDITION_SQUARE_APP_SECRET", "SQUARE_APP_SECRET"],
  ["LOCALEDITION_SQUARE_TOKEN_KEY", "SQUARE_TOKEN_KEY"],
];

let held = secretGet(PAIRS.map(([v]) => v));
if (!held.LOCALEDITION_SQUARE_TOKEN_KEY) {
  const fresh = randomBytes(32).toString("base64");
  if (!secretSet("LOCALEDITION_SQUARE_TOKEN_KEY", fresh)) {
    process.stderr.write("Could not store the generated token key in the secret store.\n");
    process.exit(1);
  }
  held = { ...held, LOCALEDITION_SQUARE_TOKEN_KEY: fresh };
  process.stdout.write("Generated LOCALEDITION_SQUARE_TOKEN_KEY into the secret store.\n");
}
let failed = 0;
for (const [secretName, workerName] of PAIRS) {
  if (!held[secretName]) { process.stdout.write(`${workerName}: not in the secret store yet, skipped\n`); continue; }
  const ok = wranglerSecretPut(workerName, held[secretName]);
  process.stdout.write(`${workerName}: ${ok ? "stored" : "FAILED"}\n`);
  if (!ok) failed++;
}
process.exit(failed ? 1 : 0);
