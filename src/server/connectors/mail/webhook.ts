import { z } from "zod";
import { createLogger } from "../../log";
import { hmacBase64, safeEqual } from "../comms/crypto";
import type { CommsDeps } from "../comms/deps";
import { recordEvent } from "../comms/events";
import { ComposioClient, COMPOSIO_TOOLS, COMPOSIO_TRIGGERS } from "./composio";
import { processInboundMail, type InboundMail, type InboundResult } from "./inbound";

const log = createLogger("mail:webhook");

/** Composio signs `{webhook-id}.{webhook-timestamp}.{raw body}` with HMAC-SHA256 (base64); `webhook-signature` is `v1,<sig>` (several, space separated, during a secret rotation). */
export const COMPOSIO_TOLERANCE_SECONDS = 300;

export type WebhookVerdict = { ok: true } | { ok: false; reason: "no_secret" | "missing_headers" | "stale" | "bad_signature" };

export async function verifyComposioWebhook(input: { rawBody: string; id: string | null; timestamp: string | null; signature: string | null; secret: string | undefined; nowSeconds?: number }): Promise<WebhookVerdict> {
  if (!input.secret) return { ok: false, reason: "no_secret" };
  if (!input.id || !input.timestamp || !input.signature) return { ok: false, reason: "missing_headers" };
  const ts = Number(input.timestamp);
  if (!Number.isFinite(ts)) return { ok: false, reason: "missing_headers" };
  if (Math.abs((input.nowSeconds ?? Math.floor(Date.now() / 1000)) - ts) > COMPOSIO_TOLERANCE_SECONDS) return { ok: false, reason: "stale" };
  const expected = await hmacBase64(input.secret, `${input.id}.${input.timestamp}.${input.rawBody}`);
  const candidates = input.signature.split(" ").map((s) => (s.includes(",") ? s.slice(s.indexOf(",") + 1) : s));
  // Compare against every candidate without short-circuiting on the first hit's position.
  let ok = false;
  for (const c of candidates) ok = safeEqual(expected, c) || ok;
  return ok ? { ok: true } : { ok: false, reason: "bad_signature" };
}

const Envelope = z.object({
  id: z.string().optional(),
  type: z.string(),
  metadata: z.object({ trigger_slug: z.string().optional(), connected_account_id: z.string().optional(), user_id: z.string().optional() }).loose().optional(),
  data: z.unknown().optional(),
}).loose();

const GmailData = z.object({
  id: z.string().optional(), message_id: z.string().optional(), thread_id: z.string().optional(),
  sender: z.string().optional(), subject: z.string().optional(), message_text: z.string().optional(),
}).loose();

const OutlookAddress = z.object({ email_address: z.object({ address: z.string().optional(), name: z.string().optional() }).loose().optional() }).loose();
const OutlookData = z.object({
  id: z.string().optional(),
  outlook_message: z.object({ id: z.string().optional(), subject: z.string().optional(), body_preview: z.string().optional(), conversation_id: z.string().optional(), from_address: OutlookAddress.optional(), sender: OutlookAddress.optional() }).loose().optional(),
}).loose();

const stripTags = (html: string): string => html.replace(/<(style|script)[\s\S]*?<\/\1>/gi, " ").replace(/<br\s*\/?>|<\/p>|<\/div>/gi, "\n").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/[ \t]+/g, " ").trim();

/** Maps a verified trigger event to a mail message. Null for events this lane does not handle. */
export async function toInboundMail(slug: string, data: unknown, fetchBody: (messageId: string) => Promise<string | null>): Promise<InboundMail | null> {
  if (slug === COMPOSIO_TRIGGERS.gmail) {
    const g = GmailData.safeParse(data);
    const id = g.success ? g.data.message_id ?? g.data.id : undefined;
    if (!g.success || !id) return null;
    return { provider: "gmail", messageId: id, threadId: g.data.thread_id ?? null, from: g.data.sender ?? "", subject: g.data.subject ?? "", text: g.data.message_text ?? "" };
  }
  if (slug === COMPOSIO_TRIGGERS.outlook) {
    const o = OutlookData.safeParse(data);
    const m = o.success ? o.data.outlook_message : undefined;
    const id = o.success ? m?.id ?? o.data.id : undefined;
    if (!o.success || !id) return null;
    const sender = m?.from_address?.email_address ?? m?.sender?.email_address;
    const from = sender?.address ? (sender.name ? `${sender.name} <${sender.address}>` : sender.address) : "";
    // The event carries only the first ~255 characters; fetch the whole body, fall back to the preview.
    const full = await fetchBody(id).catch(() => null);
    return { provider: "outlook", messageId: id, threadId: m?.conversation_id ?? null, from, subject: m?.subject ?? "", text: full ?? m?.body_preview ?? "" };
  }
  return null;
}

/**
 * Handles a verified Composio event (call after `verifyComposioWebhook`). Trigger messages become notes; an expired-connection event marks the
 * mailbox as needing reconnection. Anything else is acknowledged and ignored.
 */
export async function handleComposioEvent(deps: CommsDeps, rawBody: string): Promise<InboundResult | "ignored" | "connection_expired"> {
  let envelope: z.infer<typeof Envelope>;
  try {
    envelope = Envelope.parse(JSON.parse(rawBody));
  } catch {
    return "ignored";
  }
  const accountId = envelope.metadata?.connected_account_id;
  if (envelope.type === "composio.connected_account.expired" && accountId) {
    const conn = await deps.store.findMailConnByAccount(accountId);
    if (!conn) return "ignored";
    await deps.store.putMailConn({ ...conn, error: "The mailbox connection expired. Reconnect it to keep sending and reading." });
    await recordEvent(deps.store, conn.workspaceId, { provider: conn.provider, direction: "in", kind: "connection.error", summary: "The mailbox connection expired. Reconnect it from the connections page.", storeId: null, editionId: null, ok: false });
    return "connection_expired";
  }
  const slug = envelope.metadata?.trigger_slug;
  if (envelope.type !== "composio.trigger.message" || !slug) return "ignored";

  const conn = accountId ? await deps.store.findMailConnByAccount(accountId) : null;
  const client = new ComposioClient(deps.env.composioApiKey, deps.fetchImpl);
  const mail = await toInboundMail(slug, envelope.data, async (messageId) => {
    if (!conn) return null;
    const r = await client.execute(COMPOSIO_TOOLS.outlookGet, { userId: conn.composioUserId ?? conn.workspaceId, connectedAccountId: conn.connectedAccountId, arguments: { message_id: messageId } });
    const body = (r.data as { response_data?: { body?: { content?: string; contentType?: string } } } | null)?.response_data?.body;
    return body?.content ? (body.contentType === "html" ? stripTags(body.content) : body.content) : null;
  });
  if (!mail) return "ignored";
  const result = await processInboundMail(deps, mail);
  if (conn && result === "noted") await deps.store.putMailConn({ ...conn, lastSyncAt: deps.now().toISOString(), error: null });
  log.info("composio event handled", { slug, result });
  return result;
}
