/**
 * Which paths need a session. Shared by middleware.ts, the sign-in redirect and the tests, so there is one list.
 * Pure strings and regexes: it must run in the Edge middleware, which cannot import server code.
 */

export const SESSION_COOKIE = "le_sid";

/** Pages that need a session. The sample chain is a real (guest) session, so it passes the same check. */
export function isProtectedPage(pathname: string): boolean {
  return pathname === "/app" || pathname.startsWith("/app/") || pathname === "/onboarding";
}

/**
 * API paths open without a session. Everything else under /api answers 401 `unauthenticated` without a session cookie, and the
 * handlers check the session itself. Webhooks and job callbacks carry their own signature, so they must reach it:
 * an unsigned POST fails with the provider's error, not with a 401 from us.
 */
const PUBLIC_API: (string | RegExp)[] = [
  /^\/api\/auth\//, // sign-up, sign-in, sign-out, me, guest, one-time codes
  /^\/api\/jobs\//, // signed job callbacks (HMAC)
  /^\/api\/card\/[^/]+$/, // public staff card (the token is the capability)
  /^\/api\/calendar\/[^/]+$/, // .ics feed (the token is the capability)
  "/api/status",
  "/api/proof", // public reads
  "/api/limits",
  "/api/landing/sample", // the landing's read-only view of the canonical demo workspace
  "/api/connectors/square/webhook", // Square signature
  "/api/connectors/slack/interactions", // Slack signature
  "/api/connectors/mail/webhook", // Composio signature
  "/api/connectors/square/callback", // OAuth returns: the one-use state is the check
  "/api/connectors/slack/callback",
  "/api/connectors/mail/callback",
];

export function isPublicApi(pathname: string): boolean {
  return PUBLIC_API.some((p) => (typeof p === "string" ? p === pathname : p.test(pathname)));
}

/** A `next` value that may be followed after sign-in: a path under /app, never another site or a protocol-relative URL. */
export function safeNext(next: string | null | undefined): string | null {
  if (!next || !next.startsWith("/app") || next.startsWith("//") || /[\\\r\n]/.test(next)) return null;
  try {
    // Normalise first (dot segments, encodings), then check where it really points: "/app/../x" is not under /app.
    const url = new URL(next, "http://x.invalid");
    const underApp = url.pathname === "/app" || url.pathname.startsWith("/app/");
    return url.origin === "http://x.invalid" && underApp ? `${url.pathname}${url.search}` : null;
  } catch {
    return null;
  }
}

export const signinUrl = (next?: string): string => {
  const safe = safeNext(next);
  return safe ? `/signin?next=${encodeURIComponent(safe)}` : "/signin";
};
