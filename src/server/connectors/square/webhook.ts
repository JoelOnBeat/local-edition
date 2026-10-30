import type { SquareWebhookAck } from "@/contract";
import { HttpError } from "../../http/errors";
import { createLogger } from "../../log";
import { PROVIDER, recordEvent, squareDeps, type SquareDeps } from "./deps";
import { CatalogVersionUpdated } from "./schemas";
import { importFromSquare } from "./sync";

const log = createLogger("square-webhook");

export const SIGNATURE_HEADER = "x-square-hmacsha256-signature";
/** Most workspaces one notification fans out to (the sample sandbox is shared by every visitor who connected it). */
export const MAX_FAN_OUT = 25;

const fromBase64 = (s: string): Uint8Array | null => {
  try {
    return Uint8Array.from(atob(s.trim()), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
};

/**
 * Square signs `notificationUrl + rawBody` with HMAC-SHA256 using the subscription's signature key and sends it base64 in
 * `x-square-hmacsha256-signature`. The URL is the one registered with Square (our config), never the incoming request's. The comparison is
 * `crypto.subtle.verify`, which is constant time.
 */
export async function verifySquareSignature(input: { rawBody: string; signature: string | null; signatureKey: string; notificationUrl: string }): Promise<boolean> {
  if (!input.signature || !input.signatureKey) return false;
  const given = fromBase64(input.signature);
  if (!given || given.length !== 32) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(input.signatureKey), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  return crypto.subtle.verify("HMAC", key, given as BufferSource, new TextEncoder().encode(input.notificationUrl + input.rawBody));
}

/** Throws 401 for a missing or wrong signature, 503 when the server has no signature key. Run it on the raw bytes before parsing. */
export async function authenticateWebhook(deps: SquareDeps, request: Request, bytes: Uint8Array): Promise<void> {
  const signatureKey = deps.config.webhookKey;
  if (!signatureKey) throw new HttpError(503, "webhook_not_configured", "Square webhooks are not set up on this server yet.");
  const ok = await verifySquareSignature({
    rawBody: new TextDecoder().decode(bytes),
    signature: request.headers.get(SIGNATURE_HEADER),
    signatureKey,
    notificationUrl: deps.config.webhookUrl,
  });
  if (!ok) throw new HttpError(401, "bad_signature", "The webhook signature is not valid.");
}

/**
 * A signed `catalog.version.updated`: every workspace connected to that merchant re-reads the menu, flags the editions the
 * change touches and logs it. `work` receives the background promise (ctx.waitUntil on Workers) so Square gets its 200 quickly.
 */
export async function handleSquareWebhook(deps: SquareDeps, body: unknown, work: (p: Promise<unknown>) => void): Promise<SquareWebhookAck> {
  const parsed = CatalogVersionUpdated.safeParse(body);
  if (!parsed.success) return { ok: true, handled: false, eventType: "unknown" };
  const event = parsed.data;
  if (event.type !== "catalog.version.updated") return { ok: true, handled: false, eventType: event.type };

  const targets = await deps.ledger.findByMerchant(PROVIDER, event.merchant_id, MAX_FAN_OUT);
  if (targets.length === 0) return { ok: true, handled: false, eventType: event.type };
  const updatedAt = event.data?.object?.catalog_version?.updated_at ?? null;

  work(
    Promise.allSettled(
      targets.map(async ({ workspaceId, stored }) => {
        stored.meta = { ...stored.meta, lastWebhookAt: deps.now().toISOString(), ...(updatedAt ? { lastCatalogChangeAt: updatedAt } : {}) };
        await deps.ledger.putConnection(workspaceId, PROVIDER, stored);
        await recordEvent(deps, workspaceId, { direction: "in", kind: "webhook.received", summary: "Square sent catalog.version.updated; signature verified." });
        try {
          await importFromSquare(deps, workspaceId, { reason: "webhook", catalogUpdatedAt: updatedAt });
        } catch (e) {
          // A sync already running (409) already reads the newest catalog; anything else is in the log as sync.failed.
          log.warn("webhook import failed", { workspaceId, code: e instanceof HttpError ? e.code : (e as Error).name });
        }
      }),
    ),
  );
  return { ok: true, handled: true, eventType: event.type };
}

export { squareDeps };
