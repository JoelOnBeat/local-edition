import { z } from "zod";
import { UpstreamError } from "../../http/errors";
import { fetchJson } from "../../http/fetch-json";

/** Slack Web API over the shared fetch layer. Responses are never recorded (they can carry tokens). Slack answers 200 with ok:false on errors. */

const SLACK = "https://slack.com/api";

const Base = z.object({ ok: z.boolean(), error: z.string().optional() }).loose();

export class SlackApiError extends Error {
  constructor(readonly slackError: string) {
    super(`Slack: ${slackError}`);
    this.name = "SlackApiError";
  }
  /** The bot cannot act any more (token revoked, app removed, channel gone or not joined). */
  get kind(): "revoked" | "channel" | "other" {
    if (["invalid_auth", "token_revoked", "account_inactive", "not_authed", "token_expired", "app_uninstalled", "no_service", "invalid_token"].includes(this.slackError)) return "revoked";
    if (["channel_not_found", "not_in_channel", "is_archived", "restricted_action", "channel_is_archived", "no_active_hooks"].includes(this.slackError)) return "channel";
    return "other";
  }
}

export type SlackFetch = typeof fetch;

async function call<T extends z.ZodType>(method: string, token: string | null, body: object | URLSearchParams, schema: T, fetchImpl?: SlackFetch): Promise<z.output<T>> {
  const form = body instanceof URLSearchParams;
  const res = await fetchJson({
    provider: "slack", method: "POST", url: `${SLACK}/${method}`,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), "content-type": form ? "application/x-www-form-urlencoded" : "application/json; charset=utf-8" },
    body: form ? body.toString() : body, record: false, retries: 1, timeoutMs: 8000, fetchImpl, schema: Base,
  }).catch((e: unknown) => {
    if (e instanceof UpstreamError && e.code === "unauthorized") throw new SlackApiError("invalid_auth");
    throw e;
  });
  if (!res.data.ok) throw new SlackApiError(res.data.error ?? "unknown_error");
  const parsed = schema.safeParse(res.data);
  if (!parsed.success) throw new UpstreamError("invalid_response", "slack", "Slack returned an unexpected response shape.");
  return parsed.data;
}

const Posted = z.object({ ts: z.string(), channel: z.string() }).loose();

export interface SlackMessage {
  channel: string;
  text: string;
  blocks?: unknown[];
}

/** chat.postMessage. `channel` may be a name without `#` (needs chat:write.public for public channels the bot is not in) or an id. */
export async function postMessage(token: string, msg: SlackMessage, fetchImpl?: SlackFetch): Promise<{ ts: string; channel: string }> {
  const out = await call("chat.postMessage", token, { ...msg, unfurl_links: false, unfurl_media: false }, Posted, fetchImpl);
  return { ts: out.ts, channel: out.channel };
}

export async function updateMessage(token: string, msg: SlackMessage & { ts: string }, fetchImpl?: SlackFetch): Promise<void> {
  await call("chat.update", token, msg, z.object({}).loose(), fetchImpl);
}

/** Incoming webhook (the fallback): posts to the channel the webhook was created for. Slack answers with the text `ok`, not JSON. */
export async function postWebhook(url: string, msg: Omit<SlackMessage, "channel">, fetchImpl?: SlackFetch): Promise<void> {
  if (new URL(url).hostname !== "hooks.slack.com") throw new SlackApiError("bad_webhook_url");
  const res = await (fetchImpl ?? fetch)(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(msg), signal: AbortSignal.timeout(8000) }).catch(() => null);
  if (!res) throw new UpstreamError("network", "slack", "Could not reach Slack.", { retryable: true });
  const body = (await res.text().catch(() => "")).trim();
  if (!res.ok || body !== "ok") throw new SlackApiError(body || `http_${res.status}`);
}

/** Replies through the interaction's `response_url` (no token; valid 30 minutes, five uses). Used when chat.update is not possible. */
export async function respondUrl(url: string, body: Record<string, unknown>, fetchImpl?: SlackFetch): Promise<void> {
  const host = new URL(url).hostname;
  if (host !== "hooks.slack.com") throw new SlackApiError("bad_response_url");
  await (fetchImpl ?? fetch)(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => undefined);
}

const Channels = z.object({
  channels: z.array(z.object({ id: z.string(), name: z.string(), is_member: z.boolean().optional() }).loose()),
  response_metadata: z.object({ next_cursor: z.string().optional() }).optional(),
}).loose();

/** conversations.list (scope channels:read): resolves `head-office` to an id so the digest is addressed exactly. Null when absent. */
export async function findChannelId(token: string, name: string, fetchImpl?: SlackFetch): Promise<string | null> {
  let cursor: string | undefined;
  for (let page = 0; page < 5; page++) {
    const params = new URLSearchParams({ types: "public_channel", exclude_archived: "true", limit: "200", ...(cursor ? { cursor } : {}) });
    const out = await call("conversations.list", token, params, Channels, fetchImpl);
    const hit = out.channels.find((c) => c.name === name);
    if (hit) return hit.id;
    cursor = out.response_metadata?.next_cursor || undefined;
    if (!cursor) return null;
  }
  return null;
}

const OAuthAccess = z.object({
  access_token: z.string(),
  bot_user_id: z.string().optional(),
  team: z.object({ id: z.string(), name: z.string().optional() }),
  scope: z.string().optional(),
}).loose();

/** oauth.v2.access: exchanges the install code for the workspace's bot token. */
export async function exchangeCode(input: { clientId: string; clientSecret: string; code: string; redirectUri: string }, fetchImpl?: SlackFetch) {
  const params = new URLSearchParams({ client_id: input.clientId, client_secret: input.clientSecret, code: input.code, redirect_uri: input.redirectUri });
  return call("oauth.v2.access", null, params, OAuthAccess, fetchImpl);
}

const Auth = z.object({ team_id: z.string(), team: z.string().optional(), user_id: z.string().optional() }).loose();
/** auth.test: the team behind a bot token (used for the sample chain's SLACK_BOT_TOKEN). */
export async function authTest(token: string, fetchImpl?: SlackFetch): Promise<{ teamId: string; teamName: string | null }> {
  const out = await call("auth.test", token, {}, Auth, fetchImpl);
  return { teamId: out.team_id, teamName: out.team ?? null };
}
