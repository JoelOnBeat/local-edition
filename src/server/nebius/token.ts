import { z } from "zod";
import { createLogger } from "../log";
import type { NebiusCredentials } from "./credentials";
import { mapHttpError, NebiusError, networkError, readUpstreamBody, safeMessage } from "./errors";
import { signJwt } from "./jwt";

const log = createLogger("nebius:token");

/** Documented token-exchange endpoint (https://docs.nebius.com/rest-api/authentication.md). */
export const TOKEN_EXCHANGE_URL = "https://auth.eu.nebius.com:443/oauth2/token/exchange";
/** Nebius access tokens live 12 h; cache for 11.5 h so a token is never used in its last 30 minutes. */
export const TOKEN_CACHE_TTL_SECONDS = 11.5 * 3600;
const REFRESH_MARGIN_SECONDS = 30 * 60;
/** A cache hit does not tell us its age: trust it in memory for at most 5 minutes. */
const MEMO_MS = 5 * 60 * 1000;
const EXCHANGE_TIMEOUT_MS = 10_000;

/** KV-compatible: `get` returns null when absent; `put` expires after `ttlSeconds` (KV minimum is 60). */
export interface TokenCache {
  get(key: string): Promise<string | null | undefined>;
  put(key: string, value: string, ttlSeconds: number): Promise<void>;
}

export interface TokenProvider {
  /** A valid IAM access token. `forceRefresh` skips the cache (use after a 401). */
  getToken(opts?: { forceRefresh?: boolean }): Promise<string>;
}

const exchangeSchema = z.object({
  access_token: z.string().min(20),
  expires_in: z.number().positive().optional(),
  token_type: z.string().optional(),
});

export interface TokenProviderOptions {
  credentials: NebiusCredentials;
  cache: TokenCache;
  fetchImpl?: typeof fetch;
  tokenUrl?: string;
  /** Epoch milliseconds; injectable for tests. */
  now?: () => number;
}

export function cacheKey(credentials: NebiusCredentials): string {
  return `nebius:iam-token:${credentials.subject}`;
}

/** In-memory `TokenCache` for tests and local dev. Workers use a KV namespace adapter instead. */
export function createMemoryTokenCache(now: () => number = Date.now): TokenCache & { size(): number } {
  const map = new Map<string, { value: string; expiresAt: number }>();
  return {
    async get(key) {
      const hit = map.get(key);
      if (!hit || hit.expiresAt <= now()) return null;
      return hit.value;
    },
    async put(key, value, ttlSeconds) {
      map.set(key, { value, expiresAt: now() + ttlSeconds * 1000 });
    },
    size: () => map.size,
  };
}

/** Wraps a Workers KV namespace (`get(key)` / `put(key, value, { expirationTtl })`) as a `TokenCache`. */
export function kvTokenCache(kv: {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, opts: { expirationTtl: number }): Promise<void>;
}): TokenCache {
  return {
    get: (key) => kv.get(key),
    put: (key, value, ttlSeconds) => kv.put(key, value, { expirationTtl: Math.max(60, Math.floor(ttlSeconds)) }),
  };
}

export function createTokenProvider(opts: TokenProviderOptions): TokenProvider {
  const doFetch = opts.fetchImpl ?? fetch;
  const now = opts.now ?? Date.now;
  const url = opts.tokenUrl ?? TOKEN_EXCHANGE_URL;
  const key = cacheKey(opts.credentials);
  let memo: { token: string; until: number } | undefined;
  let inflight: Promise<string> | undefined;

  async function exchange(): Promise<string> {
    const jwt = await signJwt(opts.credentials, { nowSeconds: now() / 1000 });
    const body = new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
      requested_token_type: "urn:ietf:params:oauth:token-type:access_token",
      subject_token: jwt,
      subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
    });
    let res: Response;
    try {
      res = await doFetch(url, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
        body: body.toString(),
        signal: AbortSignal.timeout(EXCHANGE_TIMEOUT_MS),
      });
    } catch (err) {
      throw networkError("the token exchange", err instanceof Error && err.name === "TimeoutError");
    }
    const text = await res.text();
    if (!res.ok) {
      const err = mapHttpError(res.status, text, "the token exchange");
      // A 4xx here means the key, the JWT or its claims were refused: an auth problem, not a bad request of ours.
      if (err.code === "nebius_bad_request" || err.code === "nebius_not_found") {
        throw new NebiusError("nebius_auth", `Nebius refused the service-account JWT (HTTP ${res.status}): ${safeMessage(readUpstreamBody(text).message)}`, { status: res.status });
      }
      throw err;
    }
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new NebiusError("nebius_unavailable", "The token exchange returned a non-JSON body.", { status: res.status });
    }
    const parsed = exchangeSchema.safeParse(json);
    if (!parsed.success) throw new NebiusError("nebius_unavailable", "The token exchange response had no access_token.", { status: res.status });
    const ttl = Math.min(TOKEN_CACHE_TTL_SECONDS, (parsed.data.expires_in ?? 12 * 3600) - REFRESH_MARGIN_SECONDS);
    const token = parsed.data.access_token;
    if (ttl >= 60) {
      try {
        await opts.cache.put(key, token, ttl);
      } catch {
        log.warn("token cache write failed; the token is used uncached");
      }
    }
    memo = { token, until: now() + Math.min(Math.max(ttl, 0) * 1000, MEMO_MS) };
    log.info("minted an IAM access token", { ttlSeconds: Math.round(ttl) });
    return token;
  }

  async function resolve(forceRefresh: boolean): Promise<string> {
    if (!forceRefresh) {
      if (memo && memo.until > now()) return memo.token;
      try {
        const cached = await opts.cache.get(key);
        if (cached) {
          memo = { token: cached, until: now() + MEMO_MS };
          return cached;
        }
      } catch {
        log.warn("token cache read failed; minting a new token");
      }
    }
    return exchange();
  }

  return {
    getToken({ forceRefresh = false } = {}) {
      // One exchange at a time per isolate: concurrent steps share the result.
      if (!inflight) {
        inflight = resolve(forceRefresh).finally(() => {
          inflight = undefined;
        });
      } else if (forceRefresh) {
        return inflight.then(() => resolve(true));
      }
      return inflight;
    },
  };
}
