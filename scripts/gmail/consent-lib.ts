import { createHash, randomBytes } from "node:crypto";

/** The pure parts of the Gmail consent flow (scripts/gmail-consent.ts), kept apart so they can be tested without a browser. */

export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.send";
export const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const TOKEN_URL = "https://oauth2.googleapis.com/token";

export interface Pkce {
  verifier: string;
  challenge: string;
}

export function newPkce(): Pkce {
  const verifier = randomBytes(48).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

/** The URL Gabriel opens: send-only scope, offline access (a refresh token) and a forced consent screen (Google omits the refresh token otherwise). */
export function consentUrl(p: { clientId: string; redirectUri: string; state: string; challenge: string; loginHint?: string }): string {
  const q = new URLSearchParams({
    client_id: p.clientId,
    redirect_uri: p.redirectUri,
    response_type: "code",
    scope: GMAIL_SCOPE,
    access_type: "offline",
    prompt: "consent",
    state: p.state,
    code_challenge: p.challenge,
    code_challenge_method: "S256",
    ...(p.loginHint ? { login_hint: p.loginHint } : {}),
  });
  return `${AUTH_URL}?${q}`;
}

export type Exchange = { ok: true; refreshToken: string } | { ok: false; reason: string };

/** Trades the one-use code for tokens and returns only the refresh token. Error text never includes a token. */
export async function exchangeCode(p: { clientId: string; clientSecret: string; code: string; redirectUri: string; verifier: string }, fetchImpl: typeof fetch = fetch): Promise<Exchange> {
  const res = await fetchImpl(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: p.clientId, client_secret: p.clientSecret, code: p.code, redirect_uri: p.redirectUri, grant_type: "authorization_code", code_verifier: p.verifier }),
  });
  const body = (await res.json().catch(() => ({}))) as { refresh_token?: string; error?: string; scope?: string };
  if (!res.ok) return { ok: false, reason: `Google refused the code (${body.error ?? res.status}).` };
  if (!body.refresh_token) return { ok: false, reason: "Google returned no refresh token. Revoke the app at myaccount.google.com/permissions and run this again." };
  if (body.scope && !body.scope.split(" ").includes(GMAIL_SCOPE)) return { ok: false, reason: "The gmail.send permission was not granted." };
  return { ok: true, refreshToken: body.refresh_token };
}
