import type { KvLike } from "./keyed-repo";
import type { D1Like } from "../platform/types";

/**
 * The provider cache (Qloo profiles, anchor searches, Tavily results) behind the repo's cacheGet/cachePut.
 * docs/CLOUDFLARE.md puts it in KV (TTL for free, reads are cheap); with no KV bound it falls back to a
 * D1 table so local runs and tests need nothing else.
 */
export interface CacheBackend {
  get(key: string): Promise<unknown | null>;
  put(key: string, value: unknown, ttlSeconds: number): Promise<void>;
  delete(key: string): Promise<void>;
  /** Live keys starting with `prefix` (small sets only: purge on store delete). */
  list(prefix: string): Promise<string[]>;
}

const KV_PREFIX = "cache:";

/** Cache rows kept in a KV namespace under `cache:<key>` (the same layout as the KV repo driver). */
export class KvCache implements CacheBackend {
  constructor(private readonly kv: KvLike) {}
  get(key: string) { return this.kv.get(`${KV_PREFIX}${key}`); }
  put(key: string, value: unknown, ttlSeconds: number) { return this.kv.put(`${KV_PREFIX}${key}`, value, { ttlSeconds }); }
  delete(key: string) { return this.kv.delete(`${KV_PREFIX}${key}`); }
  async list(prefix: string) { return (await this.kv.list(`${KV_PREFIX}${prefix}`)).map((k) => k.slice(KV_PREFIX.length)); }
}

/** Cache rows kept in the D1 `cache` table. */
export class D1Cache implements CacheBackend {
  constructor(private readonly db: () => Promise<D1Like>, private readonly now: () => number) {}

  async get(key: string) {
    const row = await (await this.db()).prepare("SELECT json FROM cache WHERE key = ? AND expires_at > ?").bind(key, this.now()).first<{ json: string }>();
    return row ? (JSON.parse(row.json) as unknown) : null;
  }
  async put(key: string, value: unknown, ttlSeconds: number) {
    await (await this.db())
      .prepare("INSERT INTO cache (key, json, expires_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json, expires_at = excluded.expires_at")
      .bind(key, JSON.stringify(value), this.now() + ttlSeconds * 1000)
      .run();
  }
  async delete(key: string) {
    await (await this.db()).prepare("DELETE FROM cache WHERE key = ?").bind(key).run();
  }
  async list(prefix: string) {
    // substr() instead of LIKE: store ids contain `_`, which LIKE treats as a wildcard.
    const res = await (await this.db())
      .prepare("SELECT key FROM cache WHERE substr(key, 1, ?) = ? AND expires_at > ?")
      .bind(prefix.length, prefix, this.now())
      .all<{ key: string }>();
    return (res.results ?? []).map((r) => r.key);
  }
}

const PROFILE_PREFIX = "qloo:profile:v1:";
const COMPARE_PREFIX = "qloo:compare:v1:";

/**
 * Removes what a deleted store left behind: its profile caches, the compare caches that name it (an exact
 * segment match, so `store_a` never matches `store_ab`) and the evidence rows those profiles referenced.
 */
export async function purgeStoreCaches(cache: CacheBackend, deleteEvidence: (ids: string[]) => Promise<void>, storeId: string): Promise<void> {
  for (const key of await cache.list(`${PROFILE_PREFIX}${storeId}:`)) {
    const cached = (await cache.get(key)) as { profile?: { evidenceIds?: string[] }; evidence?: { id: string }[] } | null;
    const ids = new Set([...(cached?.profile?.evidenceIds ?? []), ...(cached?.evidence ?? []).map((e) => e.id)]);
    await deleteEvidence([...ids]);
    await cache.delete(key);
  }
  for (const key of await cache.list(COMPARE_PREFIX)) {
    if (key.slice(COMPARE_PREFIX.length).split(":").includes(storeId)) await cache.delete(key);
  }
}
