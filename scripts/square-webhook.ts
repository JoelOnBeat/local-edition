/**
 * Creates (or re-keys) the Square webhook subscription for catalog.version.updated and delivers its signature key to the Worker secret
 * SQUARE_WEBHOOK_SIGNATURE_KEY and the secret store (LOCALEDITION_SQUARE_WEBHOOK_KEY). The key is only ever piped; it is never printed.
 *
 *   npx tsx scripts/square-webhook.ts                       # https://localedition.pages.dev/api/connectors/square/webhook
 *   npx tsx scripts/square-webhook.ts --url https://...     # another notification URL (https only)
 *   npx tsx scripts/square-webhook.ts --skip-wrangler       # secret store only (Worker not deployed yet)
 *
 * The signature covers the notification URL, so the URL registered here must equal APP_URL + /api/connectors/square/webhook in the Worker.
 * Re-running rotates the key and updates both stores; Square keeps the old key valid only until the rotation, so run it with the secret put.
 */
import { SQUARE_VERSION } from "@/server/connectors/square/config";
import { sandboxClient, secretSet, wranglerSecretPut } from "./square/lib";

const arg = (name: string) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : undefined; };
const URL_ = arg("--url") ?? "https://localedition.pages.dev/api/connectors/square/webhook";
const EVENTS = ["catalog.version.updated"];

async function main() {
  if (!URL_.startsWith("https://")) throw new Error("The notification URL must be https.");
  const client = await sandboxClient();
  const existing = (await client.listSubscriptions()).find((s) => s.notification_url === URL_);
  let key: string | undefined;
  if (existing) {
    key = await client.rotateSignatureKey(existing.id, `le-webhook-rotate-${Date.now()}`);
    process.stdout.write(`Subscription ${existing.id} exists; signature key rotated.\n`);
  } else {
    const created = await client.createSubscription({ name: "Local Edition: catalog changes", eventTypes: EVENTS, notificationUrl: URL_ }, "le-webhook-create-v1");
    key = created.signature_key;
    process.stdout.write(`Subscription ${created.id} created for ${EVENTS.join(", ")} (API ${SQUARE_VERSION}).\n`);
  }
  if (!key) throw new Error("Square did not return a signature key.");

  const stored = secretSet("LOCALEDITION_SQUARE_WEBHOOK_KEY", key);
  const pushed = process.argv.includes("--skip-wrangler") ? null : wranglerSecretPut("SQUARE_WEBHOOK_SIGNATURE_KEY", key);
  process.stdout.write(`secret store LOCALEDITION_SQUARE_WEBHOOK_KEY: ${stored ? "stored" : "FAILED"}\n`);
  process.stdout.write(`worker secret SQUARE_WEBHOOK_SIGNATURE_KEY: ${pushed === null ? "skipped" : pushed ? "stored" : "FAILED (deploy the Worker, then run wrangler secret put from the secret store)"}\n`);
  if (!stored || pushed === false) process.exit(1);
}

main().catch((e) => {
  process.stderr.write(`square-webhook failed: ${(e as Error).message}\n`);
  process.exit(1);
});
