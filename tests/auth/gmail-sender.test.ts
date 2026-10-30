import { describe, expect, it } from "vitest";
import { CODE_SUBJECT, EmailUnavailableError, getCodeSender, setCodeSender, takeOutbox } from "@/server/auth/code-sender";
import { GMAIL_SENDER_ADDRESS, GmailCodeSender, TOKEN_CACHE_SECONDS, gmailSenderFromEnv, type TokenCache } from "@/server/auth/gmail-sender";
import { exchangeCode, consentUrl, GMAIL_SCOPE, newPkce } from "../../scripts/gmail/consent-lib";
import { GET as devOutbox } from "@/app/api/auth/dev-outbox/route";

const CONFIG = { clientId: "client-id-test", clientSecret: "client-secret-test", refreshToken: "refresh-token-test", from: GMAIL_SENDER_ADDRESS };
const MSG = { to: "maya@kettleandkiln.example", code: "493027", expiresInMinutes: 10 };

function memoryCache(): TokenCache & { puts: { token: string; ttl: number }[]; value: string | null } {
  const c = { value: null as string | null, puts: [] as { token: string; ttl: number }[], get: async () => c.value, put: async (token: string, ttl: number) => { c.value = token; c.puts.push({ token, ttl }); }, drop: async () => { c.value = null; } };
  return c;
}

interface Call { url: string; init: RequestInit }
function fakeGoogle(plan: { token?: (n: number) => Response; send?: (n: number) => Response } = {}) {
  const calls: Call[] = [];
  let tokens = 0;
  let sends = 0;
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    if (url === "https://oauth2.googleapis.com/token") {
      tokens++;
      return plan.token?.(tokens) ?? Response.json({ access_token: `access-${tokens}`, expires_in: 3599, token_type: "Bearer" });
    }
    sends++;
    return plan.send?.(sends) ?? Response.json({ id: "m1", threadId: "t1" });
  }) as typeof fetch;
  return { fetchImpl, calls, tokenCalls: () => calls.filter((c) => c.url.includes("oauth2")), sendCalls: () => calls.filter((c) => c.url.includes("gmail.googleapis.com")) };
}

const decodeRaw = (raw: string) => Buffer.from(raw.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");

describe("Gmail code sender (direct API)", () => {
  it("mints an access token from the refresh token, then posts a base64url RFC 2822 message to users/me/messages/send", async () => {
    const google = fakeGoogle();
    const cache = memoryCache();
    await new GmailCodeSender(CONFIG, { fetchImpl: google.fetchImpl, cache: async () => cache }).send(MSG);

    const [token] = google.tokenCalls();
    expect(token.init.method).toBe("POST");
    const form = new URLSearchParams(String(token.init.body));
    expect(Object.fromEntries(form)).toEqual({ client_id: "client-id-test", client_secret: "client-secret-test", refresh_token: "refresh-token-test", grant_type: "refresh_token" });

    const [send] = google.sendCalls();
    expect(send.url).toBe("https://gmail.googleapis.com/gmail/v1/users/me/messages/send");
    expect((send.init.headers as Record<string, string>).authorization).toBe("Bearer access-1");
    const raw = (JSON.parse(String(send.init.body)) as { raw: string }).raw;
    expect(raw).toMatch(/^[A-Za-z0-9_-]+$/); // base64url, no padding
    const mime = decodeRaw(raw);
    expect(mime).toContain("From: \"Local Edition\" <defiusmaximus@gmail.com>");
    expect(mime).toContain("To: maya@kettleandkiln.example");
    expect(mime).toContain(`Subject: ${CODE_SUBJECT}`);
    expect(mime).toContain("multipart/alternative");
    expect(mime).toContain('Content-Type: text/plain; charset="UTF-8"');
    expect(mime).toContain('Content-Type: text/html; charset="UTF-8"');
    // The bodies are base64 parts: decode them and look for the code.
    const parts = [...mime.matchAll(/Content-Transfer-Encoding: base64\r\n\r\n([\s\S]*?)\r\n--/g)].map((m) => Buffer.from(m[1].replace(/\r\n/g, ""), "base64").toString("utf8"));
    expect(parts).toHaveLength(2);
    expect(parts.every((p) => p.includes("493027"))).toBe(true);
    expect(mime).not.toMatch(/refresh-token-test|client-secret-test|access-1/);
  });

  it("keeps the access token for about 50 minutes and reuses it", async () => {
    const google = fakeGoogle();
    const cache = memoryCache();
    const sender = new GmailCodeSender(CONFIG, { fetchImpl: google.fetchImpl, cache: async () => cache });
    await sender.send(MSG);
    await sender.send(MSG);
    await sender.send(MSG);
    expect(google.tokenCalls()).toHaveLength(1);
    expect(google.sendCalls()).toHaveLength(3);
    expect(cache.puts).toEqual([{ token: "access-1", ttl: TOKEN_CACHE_SECONDS }]);
    expect(TOKEN_CACHE_SECONDS).toBe(3000);
  });

  it("when Gmail answers 401 for a cached token it mints a new one and retries once", async () => {
    const google = fakeGoogle({ send: (n) => (n === 1 ? new Response("{}", { status: 401 }) : Response.json({ id: "m2" })) });
    const cache = memoryCache();
    cache.value = "stale-token";
    await new GmailCodeSender(CONFIG, { fetchImpl: google.fetchImpl, cache: async () => cache }).send(MSG);
    expect(google.sendCalls().map((c) => (c.init.headers as Record<string, string>).authorization)).toEqual(["Bearer stale-token", "Bearer access-1"]);
  });

  it.each([
    ["a revoked or expired refresh token (invalid_grant)", { token: () => Response.json({ error: "invalid_grant" }, { status: 400 }) }, "revoked"],
    ["a wrong client secret (invalid_client)", { token: () => Response.json({ error: "invalid_client" }, { status: 401 }) }, "revoked"],
    ["Gmail refusing the send (403, e.g. scope removed)", { send: () => new Response("{}", { status: 403 }) }, "revoked"],
    ["Gmail failing (500)", { send: () => new Response("{}", { status: 500 }) }, "refused"],
    ["Google being unreachable", { token: () => { throw new Error("offline"); } }, "unreachable"],
  ])("%s becomes EmailUnavailableError(%s)", async (_name, plan, reason) => {
    const google = fakeGoogle(plan as never);
    const err = await new GmailCodeSender(CONFIG, { fetchImpl: google.fetchImpl, cache: async () => memoryCache() }).send(MSG).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EmailUnavailableError);
    expect((err as EmailUnavailableError).reason).toBe(reason);
    expect(String((err as Error).message)).not.toMatch(/token|secret/i);
  });

  it("is configured only when all three secrets exist", () => {
    expect(gmailSenderFromEnv({})).toBeNull();
    expect(gmailSenderFromEnv({ GMAIL_CLIENT_ID: "a", GMAIL_CLIENT_SECRET: "b" })).toBeNull();
    expect(gmailSenderFromEnv({ GMAIL_CLIENT_ID: "a", GMAIL_CLIENT_SECRET: "b", GMAIL_REFRESH_TOKEN: " " })).toBeNull();
    expect(gmailSenderFromEnv({ GMAIL_CLIENT_ID: "a", GMAIL_CLIENT_SECRET: "b", GMAIL_REFRESH_TOKEN: "c" })?.name).toBe("gmail");
  });
});

describe("CODE_SENDER", () => {
  const withEnv = async (vars: Record<string, string | undefined>, fn: () => Promise<void>) => {
    const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
    for (const [k, v] of Object.entries(vars)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    setCodeSender(undefined);
    try { await fn(); } finally { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
  };

  it("unset means no sender", async () => withEnv({ CODE_SENDER: undefined }, async () => expect(await getCodeSender()).toBeNull()));

  it("`log` keeps the code in memory in development and tests", async () =>
    withEnv({ CODE_SENDER: "log", NODE_ENV: "test" }, async () => {
      const sender = (await getCodeSender())!;
      expect(sender.name).toBe("log");
      await sender.send(MSG);
      expect(takeOutbox(MSG.to)).toBe("493027");
      expect(takeOutbox(MSG.to)).toBeUndefined(); // read once
    }));

  it("`log` is never a sender in production, and the dev outbox route is a 404 there", async () =>
    withEnv({ CODE_SENDER: "log", NODE_ENV: "production" }, async () => {
      expect(await getCodeSender()).toBeNull();
      expect(takeOutbox(MSG.to)).toBeUndefined();
      const res = devOutbox(new Request(`http://localhost/api/auth/dev-outbox?email=${MSG.to}`));
      expect(res.status).toBe(404);
    }));

  it("`gmail` without its secrets is no sender, with them it is the Gmail sender", async () => {
    await withEnv({ CODE_SENDER: "gmail", GMAIL_CLIENT_ID: undefined, GMAIL_CLIENT_SECRET: undefined, GMAIL_REFRESH_TOKEN: undefined }, async () => expect(await getCodeSender()).toBeNull());
    await withEnv({ CODE_SENDER: "gmail", GMAIL_CLIENT_ID: "a", GMAIL_CLIENT_SECRET: "b", GMAIL_REFRESH_TOKEN: "c" }, async () => expect((await getCodeSender())?.name).toBe("gmail"));
  });

  it("an unknown value (the dropped cf-email and composio senders) is no sender", async () => {
    await withEnv({ CODE_SENDER: "cf-email" }, async () => expect(await getCodeSender()).toBeNull());
    await withEnv({ CODE_SENDER: "composio" }, async () => expect(await getCodeSender()).toBeNull());
  });
});

describe("scripts/gmail-consent.ts helpers", () => {
  it("builds a send-only, offline, forced-consent URL with PKCE and the loopback redirect", () => {
    const pkce = newPkce();
    const url = new URL(consentUrl({ clientId: "cid", redirectUri: "http://127.0.0.1:53682/callback", state: "st", challenge: pkce.challenge, loginHint: GMAIL_SENDER_ADDRESS }));
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    const q = url.searchParams;
    expect(q.get("scope")).toBe("https://www.googleapis.com/auth/gmail.send");
    expect(GMAIL_SCOPE).toBe(q.get("scope"));
    expect(q.get("access_type")).toBe("offline");
    expect(q.get("prompt")).toBe("consent");
    expect(q.get("response_type")).toBe("code");
    expect(q.get("redirect_uri")).toBe("http://127.0.0.1:53682/callback");
    expect(q.get("code_challenge_method")).toBe("S256");
    expect(q.get("login_hint")).toBe("defiusmaximus@gmail.com");
    expect(q.get("client_secret")).toBeNull();
  });

  it("exchanges the code for a refresh token and never returns anything else", async () => {
    const seen: string[] = [];
    const ok = await exchangeCode({ clientId: "cid", clientSecret: "sec", code: "c0de", redirectUri: "http://127.0.0.1:53682/callback", verifier: "ver" }, (async (_u: string, init: RequestInit) => {
      seen.push(String(init.body));
      return Response.json({ access_token: "A", refresh_token: "R", scope: GMAIL_SCOPE });
    }) as typeof fetch);
    expect(ok).toEqual({ ok: true, refreshToken: "R" });
    expect(new URLSearchParams(seen[0]).get("grant_type")).toBe("authorization_code");
    expect(new URLSearchParams(seen[0]).get("code_verifier")).toBe("ver");
  });

  it("explains a missing refresh token or refused code without printing any token", async () => {
    const none = await exchangeCode({ clientId: "c", clientSecret: "s", code: "x", redirectUri: "r", verifier: "v" }, (async () => Response.json({ access_token: "SECRET-ACCESS" })) as typeof fetch);
    expect(none.ok).toBe(false);
    expect(JSON.stringify(none)).not.toContain("SECRET-ACCESS");
    const refused = await exchangeCode({ clientId: "c", clientSecret: "s", code: "x", redirectUri: "r", verifier: "v" }, (async () => Response.json({ error: "invalid_grant" }, { status: 400 })) as typeof fetch);
    expect(refused).toEqual({ ok: false, reason: "Google refused the code (invalid_grant)." });
  });
});
