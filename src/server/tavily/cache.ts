import { createLogger } from "../log";
import { getRepo } from "../store";

const log = createLogger("tavily-cache");

/** Tavily results live 7 days (docs/CLOUDFLARE.md): a week's events never need a second paid call. */
export const TAVILY_CACHE_TTL_SECONDS = 7 * 24 * 3600;

/** The slice of the repo's TTL cache (KV on Workers) that Tavily needs. Tests pass `memoryCache()`. */
export interface TavilyCache {
  get<T>(key: string): Promise<T | null>;
  put<T>(key: string, value: T, ttlSeconds: number): Promise<void>;
}

export type CacheKind = "search" | "chain" | "extract" | "crawl" | "voice";

/** Lowercase, collapse whitespace: "Williamsburg  Events" and "williamsburg events" are one query. */
export function normaliseQuery(query: string): string {
  return query.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * `tv:<kind>:<hash>` where hash = sha256(normalised query + "|" + time_range). The key never holds a
 * credential: only the query text and the time range go in.
 */
export async function cacheKey(kind: CacheKind, query: string, timeRange: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${normaliseQuery(query)}|${timeRange}`));
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `tv:${kind}:${hex.slice(0, 40)}`;
}

/** The app's shared cache (the repo's `cacheGet`/`cachePut`). */
export async function repoCache(): Promise<TavilyCache> {
  const repo = await getRepo();
  return {
    get: (key) => repo.cacheGet(key),
    put: (key, value, ttl) => repo.cachePut(key, value, ttl),
  };
}

/** In-process cache with TTLs, for tests and for runs with no repo. */
export function memoryCache(now: () => number = Date.now): TavilyCache & { size(): number } {
  const rows = new Map<string, { value: unknown; expires: number }>();
  return {
    async get<T>(key: string) {
      const row = rows.get(key);
      if (!row || row.expires <= now()) return null;
      return row.value as T;
    },
    async put<T>(key: string, value: T, ttl: number) {
      rows.set(key, { value, expires: now() + ttl * 1000 });
    },
    size: () => rows.size,
  };
}

/** Best effort: a cache outage is a miss, never a failed build. */
export async function softGet<T>(cache: TavilyCache | null, key: string, parse: (raw: unknown) => T | null): Promise<T | null> {
  if (!cache) return null;
  try {
    const raw = await cache.get<unknown>(key);
    return raw === null ? null : parse(raw);
  } catch (e) {
    log.warn("cache read failed", { err: (e as Error).name });
    return null;
  }
}

export async function softPut<T>(cache: TavilyCache | null, key: string, value: T, ttl = TAVILY_CACHE_TTL_SECONDS): Promise<void> {
  if (!cache) return;
  try {
    await cache.put(key, value, ttl);
  } catch (e) {
    log.warn("cache write failed", { err: (e as Error).name });
  }
}
