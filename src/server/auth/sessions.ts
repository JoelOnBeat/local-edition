import { SESSION_COOKIE, type AuthUser } from "@/contract";
import { buildCookie, readCookie } from "../http/cookies";
import { b64u } from "./password";
import { getAuthStore, type AuthStore, type SessionRow, type UserRow } from "./index";

/**
 * Sessions. The cookie `le_sid` carries a random 32-byte token; the database keeps only its SHA-256, so a leaked table (or a log
 * line) cannot be replayed as a login. A session lasts 30 days from the last time it was used (refreshed at most once a day) and
 * a user keeps at most 10 at a time; the oldest are dropped.
 */

export const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;
export const SESSION_REFRESH_AFTER_MS = 24 * 3600 * 1000;
export const MAX_SESSIONS_PER_USER = 10;

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface Principal {
  user: UserRow;
  session: SessionRow;
  workspaceId: string;
}

export const toAuthUser = (u: UserRow): AuthUser => ({ id: u.id, name: u.name, email: u.email, createdAt: u.createdAt });

/** Creates a session for the user and returns the raw token (the only time it exists outside the cookie). */
export async function issueSession(store: AuthStore, userId: string, now = Date.now()): Promise<{ token: string; maxAgeSeconds: number }> {
  const token = b64u(crypto.getRandomValues(new Uint8Array(32)));
  const id = await sha256Hex(token);
  await store.createSession({ id, userId, createdAt: now, lastSeenAt: now, expiresAt: now + SESSION_TTL_MS });
  await store.trimSessions(userId, MAX_SESSIONS_PER_USER, id);
  return { token, maxAgeSeconds: SESSION_TTL_MS / 1000 };
}

export const sessionCookie = (token: string, maxAgeSeconds: number, secure: boolean): string => buildCookie(SESSION_COOKIE, token, maxAgeSeconds, secure);
export const clearCookie = (name: string, secure: boolean): string => buildCookie(name, "", 0, secure);

/** The raw cookie token of the request, if it is well formed (43 base64url characters). */
export function sessionToken(request: Request): string | null {
  const raw = readCookie(request, SESSION_COOKIE);
  return raw && /^[A-Za-z0-9_-]{43}$/.test(raw) ? raw : null;
}

/**
 * Who is signed in on this request, or null: no cookie, an unknown token and an expired session are the same answer. A session that
 * is in use is pushed forward (at most once a day, one write).
 */
export async function getPrincipal(request: Request, store?: AuthStore, now = Date.now()): Promise<Principal | null> {
  const token = sessionToken(request);
  if (!token) return null;
  const auth = store ?? (await getAuthStore());
  const id = await sha256Hex(token);
  const found = await auth.findSession(id);
  if (!found) return null;
  if (found.session.expiresAt <= now) {
    await auth.deleteSession(id);
    return null;
  }
  let session = found.session;
  if (now - session.lastSeenAt > SESSION_REFRESH_AFTER_MS) {
    session = { ...session, lastSeenAt: now, expiresAt: now + SESSION_TTL_MS };
    await auth.touchSession(id, session.lastSeenAt, session.expiresAt);
  }
  return { user: found.user, session, workspaceId: found.user.workspaceId };
}
