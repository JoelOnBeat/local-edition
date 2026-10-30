import { createLogger } from "../log";
import { buildMime, mailbox, toRaw } from "../connectors/mail/mime";
import { getRepo } from "../store";
import { CODE_FROM_NAME, codeEmail, EmailUnavailableError, type CodeMessage, type CodeSender } from "./code-sender";

const log = createLogger("auth:gmail");

/**
 * Sends sign-in codes with the Gmail API directly, from the persona's own mailbox: no Composio, no mail provider account.
 *   POST https://oauth2.googleapis.com/token  grant_type=refresh_token  ->  access token (kept about 50 minutes, in the provider cache = KV)
 *   POST https://gmail.googleapis.com/gmail/v1/users/me/messages/send  { raw: base64url RFC 2822 message }
 * A revoked or expired refresh token (invalid_grant) and a Gmail refusal both become EmailUnavailableError, which the route answers as
 * `email_unavailable` and the screen answers by offering the password.
 */

export const GMAIL_SENDER_ADDRESS = "defiusmaximus@gmail.com";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";
const TOKEN_CACHE_KEY = "auth:gmail:access-token";
/** Google issues one hour; keep ours for 50 minutes so a token never expires mid-request. */
export const TOKEN_CACHE_SECONDS = 50 * 60;

export interface GmailConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  from: string;
}

export interface TokenCache {
  get(): Promise<string | null>;
  put(token: string, ttlSeconds: number): Promise<void>;
  drop(): Promise<void>;
}

/** The provider cache the repo already has (Workers KV in production). */
async function repoTokenCache(): Promise<TokenCache> {
  const repo = await getRepo();
  return {
    get: async () => (await repo.cacheGet<{ token: string }>(TOKEN_CACHE_KEY))?.token ?? null,
    put: (token, ttl) => repo.cachePut(TOKEN_CACHE_KEY, { token }, ttl),
    drop: () => repo.cachePut(TOKEN_CACHE_KEY, { token: "" }, 60),
  };
}

export class GmailCodeSender implements CodeSender {
  readonly name = "gmail";

  constructor(
    private readonly config: GmailConfig,
    private readonly deps: { fetchImpl?: typeof fetch; cache?: () => Promise<TokenCache> } = {},
  ) {}

  private get fetcher(): typeof fetch {
    return this.deps.fetchImpl ?? ((...a) => fetch(...a));
  }

  private async mintToken(): Promise<string> {
    let res: Response;
    try {
      res = await this.fetcher(TOKEN_URL, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: this.config.clientId, client_secret: this.config.clientSecret, refresh_token: this.config.refreshToken, grant_type: "refresh_token" }),
      });
    } catch {
      throw new EmailUnavailableError("unreachable");
    }
    const body = (await res.json().catch(() => ({}))) as { access_token?: string; error?: string };
    if (!res.ok || !body.access_token) {
      // invalid_grant: the refresh token was revoked, or expired (a consent screen in "testing" expires them after 7 days).
      const revoked = body.error === "invalid_grant" || body.error === "invalid_client" || body.error === "unauthorized_client";
      log.error("gmail token refresh refused", { status: res.status, error: body.error });
      throw new EmailUnavailableError(revoked ? "revoked" : "refused");
    }
    return body.access_token;
  }

  private async accessToken(fresh: boolean): Promise<string> {
    const cache = await (this.deps.cache ?? repoTokenCache)();
    if (!fresh) {
      const cached = await cache.get().catch(() => null);
      if (cached) return cached;
    }
    const token = await this.mintToken();
    await cache.put(token, TOKEN_CACHE_SECONDS).catch(() => undefined);
    return token;
  }

  private async post(raw: string, token: string): Promise<Response> {
    try {
      return await this.fetcher(SEND_URL, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ raw }),
      });
    } catch {
      throw new EmailUnavailableError("unreachable");
    }
  }

  async send(message: CodeMessage): Promise<void> {
    const mail = codeEmail(message);
    const mime = buildMime({ to: mailbox(null, message.to), subject: mail.subject, text: mail.text, html: mail.html });
    const raw = toRaw(`From: ${mailbox(CODE_FROM_NAME, this.config.from)}\r\n${mime}`);

    let res = await this.post(raw, await this.accessToken(false));
    if (res.status === 401) {
      // The cached token was revoked or aged out early: mint one and try once more.
      res = await this.post(raw, await this.accessToken(true));
    }
    if (!res.ok) {
      log.error("gmail send refused", { status: res.status });
      throw new EmailUnavailableError(res.status === 401 || res.status === 403 ? "revoked" : "refused");
    }
  }
}

/** A sender from the Worker secrets, or null when any of the three is missing. */
export function gmailSenderFromEnv(source: Record<string, string | undefined> = process.env): GmailCodeSender | null {
  const clientId = source.GMAIL_CLIENT_ID?.trim();
  const clientSecret = source.GMAIL_CLIENT_SECRET?.trim();
  const refreshToken = source.GMAIL_REFRESH_TOKEN?.trim();
  if (!clientId || !clientSecret || !refreshToken) return null;
  return new GmailCodeSender({ clientId, clientSecret, refreshToken, from: GMAIL_SENDER_ADDRESS });
}
