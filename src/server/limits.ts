import { errorResponse } from "./http/api";
import { HttpError } from "./http/errors";
import { serial } from "./serial";
import { ROUTE_ADMISSION_USD, chargeSpendBudget } from "./spend-budget";
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

/** Hextets of an IPv6 text (any `::` compression, an IPv4 tail allowed); null when it is not a well-formed address. */
function hextets(ip: string): number[] | null {
  const v4 = ip.match(/^(.*:)(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  let text = ip;
  if (v4) {
    const [a, b, c, d] = v4.slice(2).map(Number);
    if ([a, b, c, d].some((n) => n > 255)) return null;
    text = `${v4[1]}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const parse = (part: string) => (part === "" ? [] : part.split(":"));
  const head = parse(halves[0]);
  const tail = halves.length === 2 ? parse(halves[1]) : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-fA-F]{1,4}$/.test(g))) return null;
  return groups.map((g) => parseInt(g, 16));
}

/**
 * The key a client's rate limits are charged to. IPv4 is the address itself. IPv6 is the /64 prefix: a client owns
 * the low 64 bits of its address and can rotate them at will, so one bucket per full address would be unlimited
 * buckets. An IPv4-mapped IPv6 address (`::ffff:203.0.113.9`) is the IPv4 address. Returns "unknown" for text that is
 * not an address.
 */
export function ipBucket(ip: string): string {
  if (!ip.includes(":")) return ip;
  const h = hextets(ip);
  if (!h) return "unknown";
  if (h.slice(0, 5).every((n) => n === 0) && h[5] === 0xffff) return `${h[6] >> 8}.${h[6] & 255}.${h[7] >> 8}.${h[7] & 255}`;
  return `${h.slice(0, 4).map((n) => n.toString(16)).join(":")}::/64`;
}

/**
 * The caller's rate-limit key (see `ipBucket`). In production only `cf-connecting-ip` counts (Cloudflare sets it and
 * strips a client-sent copy); `x-forwarded-for` and `x-real-ip` are client-controlled there and are never read.
 * Outside production they are accepted so local proxies and tests can set an address.
 *
 * DEPLOYMENT: the product Worker has no public address. Requests reach it through the Pages project's `_worker.js`
 * and a service binding (edge/pages/public/_worker.js), and `cf-connecting-ip` MUST survive that hop. If it were
 * dropped, every visitor would share the "unknown" bucket and the new-workspace limit (ten, one more every five
 * minutes) would answer 429 to everyone. The Pages worker therefore re-sets the header on the request it forwards, and
 * tests/fix-a/pages-worker.test.ts pins that. Check it again against the deployed hop before judging.
 */
export function clientIp(request: Request): string {
  const h = request.headers;
  const cf = h.get("cf-connecting-ip")?.trim();
  if (cf && IPV_CHARS.test(cf)) return ipBucket(cf);
  if (process.env.NODE_ENV === "production") return "unknown";
  const fwd = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (fwd && IPV_CHARS.test(fwd)) return ipBucket(fwd);
  const real = h.get("x-real-ip")?.trim();
  if (real && IPV_CHARS.test(real)) return ipBucket(real);
  return "unknown";
}

type RouteHandler<A extends unknown[]> = (request: Request, ...args: A) => Promise<Response>;

/** A short hash, so a raw address is never part of a stored key. */
export async function ipHash(ip: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ip));
  return [...new Uint8Array(digest)].slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Wraps a route so the caller's IP is rate limited BEFORE the handler reads the body or touches the store.
 * The handler adds its own per-workspace limit once it knows the workspace. A route that calls a model
 * (`ROUTE_ADMISSION_USD`) is also charged against the network's daily dollar cap and the visitors' share of the spend cap.
 */
export function ipLimited<A extends unknown[]>(
  opts: { name: string; capacity: number; refillPerMinute: number },
  handler: RouteHandler<A>,
): RouteHandler<A> {
  return async (request, ...args) => {
    try {
      const ip = clientIp(request);
      await rateLimit({ key: `${opts.name}:ip:${ip}`, capacity: opts.capacity, refillPerMinute: opts.refillPerMinute });
      const usd = ROUTE_ADMISSION_USD[opts.name];
      if (usd) await chargeSpendBudget({ ipKey: await ipHash(ip), usd });
    } catch (e) {
      return errorResponse(e);
    }
    return handler(request, ...args);
  };
}
