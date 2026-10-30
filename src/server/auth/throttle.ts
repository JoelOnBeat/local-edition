import { RetryAfterError } from "../http/errors";
import { clientIp } from "../limits";
import type { AuthStore } from "./store";

/**
 * Sign-in and sign-up limits, in two layers, both on the account store's atomic counters (one SQL upsert on D1):
 *  - request windows per network (IPv4 address or IPv6 /64) and per email: too many tries in a window is 429 `rate_limited`;
 *  - failure back-off: after 5 wrong passwords for one email (20 from one network) every try is refused, even with the right
 *    password, for 30 s doubling per further failure up to 15 min (429 `too_many_attempts`). Failures are forgotten after an hour.
 * The cost to a victim of the email lock is a wait of at most 15 minutes; the cost of no lock is unlimited password guessing.
 */

export interface Window {
  limit: number;
  windowMs: number;
}

export const WINDOWS = {
  signupIp: { limit: 10, windowMs: 3_600_000 },
  signupEmail: { limit: 3, windowMs: 3_600_000 },
  signinIp: { limit: 30, windowMs: 600_000 },
  signinEmail: { limit: 10, windowMs: 600_000 },
  accountIp: { limit: 10, windowMs: 3_600_000 },
} as const satisfies Record<string, Window>;

export const FAILURES = {
  emailThreshold: 5,
  ipThreshold: 20,
  baseMs: 30_000,
  capMs: 15 * 60_000,
  forgetMs: 3_600_000,
} as const;

async function keyOf(kind: string, value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${kind}\u0000${value}`));
  return `${kind}:${[...new Uint8Array(digest)].slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * The network key, or null when there is none to key on. Outside production a request without a client address would put every local
 * test run in one shared bucket, so network limits are skipped there; production always keys on `cf-connecting-ip`.
 */
export function networkOf(request: Request): string | null {
  const ip = clientIp(request);
  return ip === "unknown" && process.env.NODE_ENV !== "production" ? null : ip;
}

function tooMany(retryAfterMs: number, code: "rate_limited" | "too_many_attempts", lead: string): RetryAfterError {
  const seconds = Math.ceil(retryAfterMs / 1000);
  const wait = seconds >= 90 ? `${Math.ceil(seconds / 60)} minutes` : `${seconds} seconds`;
  return new RetryAfterError(429, code, `${lead} Wait ${wait} and try again.`, seconds);
}

/** Counts one request in the window; throws 429 `rate_limited` past the limit. */
export async function takeWindow(store: AuthStore, name: keyof typeof WINDOWS, subject: string | null, now = Date.now()): Promise<void> {
  if (subject === null) return;
  const w: Window = WINDOWS[name];
  const state = await store.hit(await keyOf(`win:${name}`, subject), w.windowMs, now);
  if (state.count > w.limit) throw tooMany(state.at + w.windowMs - now, "rate_limited", "Too many tries.");
}

const backoffMs = (count: number, threshold: number): number => Math.min(FAILURES.capMs, FAILURES.baseMs * 2 ** (count - threshold));

export interface FailureKeys {
  email: string;
  ip: string | null;
}

export async function failureKeys(email: string, ip: string | null): Promise<FailureKeys> {
  return { email: await keyOf("fail:email", email), ip: ip === null ? null : await keyOf("fail:ip", ip) };
}

/** Throws 429 `too_many_attempts` while a back-off from earlier failures is still running. */
export async function assertNotLocked(store: AuthStore, keys: FailureKeys, now = Date.now()): Promise<void> {
  const checks: [string | null, number][] = [[keys.email, FAILURES.emailThreshold], [keys.ip, FAILURES.ipThreshold]];
  let wait = 0;
  for (const [key, threshold] of checks) {
    if (key === null) continue;
    const state = await store.peek(key);
    if (!state || state.count < threshold || state.at <= now - FAILURES.forgetMs) continue;
    wait = Math.max(wait, state.at + backoffMs(state.count, threshold) - now);
  }
  if (wait > 0) throw tooMany(wait, "too_many_attempts", "Too many wrong passwords.");
}

export async function recordFailure(store: AuthStore, keys: FailureKeys, now = Date.now()): Promise<void> {
  await store.fail(keys.email, FAILURES.forgetMs, now);
  if (keys.ip !== null) await store.fail(keys.ip, FAILURES.forgetMs, now);
}

/** A correct password clears the email's failures (the network's stay: they are about the network). */
export async function clearFailures(store: AuthStore, keys: FailureKeys): Promise<void> {
  await store.clear(keys.email);
}
