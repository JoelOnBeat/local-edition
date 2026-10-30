import { z } from "zod";
import { HttpError, UpstreamError } from "../../http/errors";
import { fetchJson } from "../../http/fetch-json";

/**
 * Composio REST API v3.1 (https://backend.composio.dev/api/v3.1), verified against docs.composio.dev and the live tool/trigger
 * catalogue on 30 Oct 2026. Only the endpoints this lane uses:
 *   POST /connected_accounts/link             -> { redirect_url, connected_account_id }
 *   GET  /connected_accounts/{id}             -> { id, status, toolkit.slug }  (the full body also carries OAuth state: we read three fields and drop the rest)
 *   POST /tools/execute/{TOOL_SLUG}           -> { successful, data, error }
 *   POST /tools/execute/proxy                 -> provider response (used for Gmail MIME send, which the tool cannot do with a text part)
 *   POST /trigger_instances/{SLUG}/upsert     -> { trigger_id }   (`egress_url` sends this trigger's events to our webhook only)
 * Responses are never recorded: tool results carry mail content.
 */

const BASE = "https://backend.composio.dev/api/v3.1";

export const COMPOSIO_TOOLS = {
  gmailSend: "GMAIL_SEND_EMAIL",
  gmailThread: "GMAIL_FETCH_MESSAGE_BY_THREAD_ID",
  gmailProfile: "GMAIL_GET_PROFILE",
  outlookSend: "OUTLOOK_OUTLOOK_SEND_EMAIL",
  outlookList: "OUTLOOK_OUTLOOK_LIST_MESSAGES",
  outlookGet: "OUTLOOK_OUTLOOK_GET_MESSAGE",
  outlookProfile: "OUTLOOK_OUTLOOK_GET_PROFILE",
} as const;

export const COMPOSIO_TRIGGERS = { gmail: "GMAIL_NEW_GMAIL_MESSAGE", outlook: "OUTLOOK_MESSAGE_TRIGGER" } as const;

const Link = z.object({ redirect_url: z.string().url(), connected_account_id: z.string().min(1) }).loose();
const Account = z.object({ id: z.string(), status: z.string(), toolkit: z.object({ slug: z.string() }).loose().optional() }).loose();
const Executed = z.object({ successful: z.boolean(), data: z.unknown().optional(), error: z.string().nullish() }).loose();
const Upserted = z.object({ trigger_id: z.string().min(1) }).loose();

const Deleted = z.object({}).loose();

export type ExecuteResult = { successful: boolean; data: unknown; error: string | null };

export class ComposioClient {
  constructor(private readonly apiKey: string | undefined, private readonly fetchImpl?: typeof fetch) {}

  private async call<T extends z.ZodType>(method: "GET" | "POST" | "DELETE", path: string, body: unknown, schema: T): Promise<z.output<T>> {
    if (!this.apiKey) throw new HttpError(503, "mail_not_configured", "Email is not set up on this server yet.");
    try {
      const res = await fetchJson<z.output<T>>({
        provider: "composio", method, url: `${BASE}${path}`, headers: { "x-api-key": this.apiKey },
        body, record: false, retries: 1, timeoutMs: 25_000, fetchImpl: this.fetchImpl, schema: schema as unknown as z.ZodType<z.output<T>>,
      });
      return res.data;
    } catch (e) {
      if (e instanceof UpstreamError && e.code === "unauthorized") throw new HttpError(502, "composio_auth", "The email service rejected our credentials.");
      throw e;
    }
  }

  /** A Composio-hosted consent page for Gmail or Outlook. The browser returns to `callbackUrl` afterwards. */
  async createLink(input: { authConfigId: string; userId: string; callbackUrl: string }): Promise<{ redirectUrl: string; connectedAccountId: string }> {
    const out = await this.call("POST", "/connected_accounts/link", { auth_config_id: input.authConfigId, user_id: input.userId, callback_url: input.callbackUrl }, Link);
    return { redirectUrl: out.redirect_url, connectedAccountId: out.connected_account_id };
  }

  /** Status of a connected account (`ACTIVE` once consent finished). Nothing else from the response is kept. */
  async getAccount(id: string): Promise<{ id: string; status: string; toolkit: string | null }> {
    const out = await this.call("GET", `/connected_accounts/${encodeURIComponent(id)}`, undefined, Account);
    return { id: out.id, status: out.status, toolkit: out.toolkit?.slug ?? null };
  }

  async execute(slug: string, input: { userId: string; connectedAccountId: string; arguments: Record<string, unknown> }): Promise<ExecuteResult> {
    const out = await this.call("POST", `/tools/execute/${encodeURIComponent(slug)}`, { user_id: input.userId, connected_account_id: input.connectedAccountId, arguments: input.arguments }, Executed);
    return { successful: out.successful, data: out.data ?? null, error: out.error ?? null };
  }

  /** Calls a provider endpoint with the account's credentials (Composio holds the token; we never see it). Returns the provider's JSON body. */
  async proxy(input: { connectedAccountId: string; userId: string; endpoint: string; method: "GET" | "POST"; body?: unknown }): Promise<unknown> {
    const out = await this.call("POST", "/tools/execute/proxy", {
      connected_account_id: input.connectedAccountId, user_id: input.userId, endpoint: input.endpoint, method: input.method, ...(input.body !== undefined ? { body: input.body } : {}),
    }, z.object({}).loose());
    const r = out as { successful?: boolean; status?: number; error?: unknown; data?: unknown };
    if (r.successful === false || (typeof r.status === "number" && r.status >= 400) || (typeof r.error === "string" && r.error)) {
      throw new UpstreamError("upstream_4xx", "composio", "The mail provider refused the request.", { status: typeof r.status === "number" ? r.status : 400 });
    }
    return r.data ?? out;
  }

  /** Removes a connected account this app created (Disconnect). */
  async deleteAccount(id: string): Promise<void> {
    await this.call("DELETE", `/connected_accounts/${encodeURIComponent(id)}`, undefined, Deleted);
  }

  /** Creates (or updates) a new-mail trigger for the account. `egressUrl` makes Composio deliver this trigger's events to us alone. */
  async upsertTrigger(slug: string, input: { userId: string; connectedAccountId: string; config: Record<string, unknown>; egressUrl: string }): Promise<string> {
    const out = await this.call("POST", `/trigger_instances/${encodeURIComponent(slug)}/upsert`, {
      user_id: input.userId, connected_account_id: input.connectedAccountId, trigger_config: input.config, egress_url: input.egressUrl,
    }, Upserted);
    return out.trigger_id;
  }
}
