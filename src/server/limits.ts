import { errorResponse } from "./http/api";
import { HttpError } from "./http/errors";
import { getRepo } from "./store";

/**
 * Rate limiting and client identity for spending routes.
 *
 * The bucket lives in the repo cache (KV on Workers), so isolates share it. KV has no compare-and-swap:
 * the limit is best effort across isolates (a burst can slip a few extra requests) and exact inside one
 * isolate. Atomic limiting belongs to the Durable Object phase.
 */

export interface RateLimitOptions {
  /** Identifies the bucket, e.g. `menu:ws:<id>` or `menu:ip:<ip>`. Hashed before it is stored. */
  key: string;
  /** Burst size. */
  capacity: number;
  refillPerMinute: number;
}

interface Bucket {
  tokens: number;
  at: number;
}

async function shortHash(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join("");
}

const tails = new Map<string, Promise<unknown>>();

/** Run `fn` after every earlier call with the same key in this isolate has finished. */
function serial<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const run = (tails.get(key) ?? Promise.resolve()).then(fn, fn);
  const tail = run.catch(() => undefined);
  tails.set(key, tail);
  void tail.then(() => {
    if (tails.get(key) === tail) tails.delete(key);
  });
  return run;
}

/** Takes one token or throws HttpError(429, "rate_limited"). */
export async function rateLimit(opts: RateLimitOptions, now: number = Date.now()): Promise<void> {
  const refillPerSecond = opts.refillPerMinute / 60;
  const cacheKey = `rl:${await shortHash(opts.key)}`;
  const allowed = await serial(cacheKey, async () => {
    const repo = await getRepo();
    const prev = await repo.cacheGet<Bucket>(cacheKey);
    const earned = prev ? ((now - prev.at) / 1000) * refillPerSecond : 0;
    const tokens = Math.min(opts.capacity, (prev?.tokens ?? opts.capacity) + earned);
    if (tokens < 1) return false;
    const ttl = Math.ceil(opts.capacity / Math.max(refillPerSecond, 1e-6)) + 60;
    await repo.cachePut<Bucket>(cacheKey, { tokens: tokens - 1, at: now }, Math.min(ttl, 7 * 24 * 3600));
    return true;
  });
  if (!allowed) {
    throw new HttpError(429, "rate_limited", "Too many requests. Wait a moment and try again.");
  }
}

const IPV_CHARS = /^[0-9a-fA-F:.]{2,45}$/;

/**
 * The caller's IP. In production only `cf-connecting-ip` counts (Cloudflare sets it and strips a
 * client-sent copy); `x-forwarded-for` and `x-real-ip` are client-controlled there and are never read.
 * Outside production they are accepted so local proxies and tests can set an address.
 */
export function clientIp(request: Request): string {
  const h = request.headers;
  const cf = h.get("cf-connecting-ip")?.trim();
  if (cf && IPV_CHARS.test(cf)) return cf;
  if (process.env.NODE_ENV === "production") return "unknown";
  const fwd = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (fwd && IPV_CHARS.test(fwd)) return fwd;
  const real = h.get("x-real-ip")?.trim();
  if (real && IPV_CHARS.test(real)) return real;
  return "unknown";
}

type RouteHandler<A extends unknown[]> = (request: Request, ...args: A) => Promise<Response>;

/**
 * Wraps a route so the caller's IP is rate limited BEFORE the handler reads the body or touches the store.
 * The handler adds its own per-workspace limit once it knows the workspace.
 */
export function ipLimited<A extends unknown[]>(
  opts: { name: string; capacity: number; refillPerMinute: number },
  handler: RouteHandler<A>,
): RouteHandler<A> {
  return async (request, ...args) => {
    try {
      await rateLimit({ key: `${opts.name}:ip:${clientIp(request)}`, capacity: opts.capacity, refillPerMinute: opts.refillPerMinute });
    } catch (e) {
      return errorResponse(e);
    }
    return handler(request, ...args);
  };
}
