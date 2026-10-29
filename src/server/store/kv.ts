import { KeyedRepo, type KvLike } from "./keyed-repo";
import type { Repo } from "./repo";

/**
 * Cloudflare KV driver (binding `LE_KV`). KV is eventually consistent and has no transactions, so
 * the optimistic version check is best-effort across isolates (exact within one isolate). Fine for
 * one visitor editing their own workspace; use D1 if two people ever edit the same one.
 */

export interface KvNamespaceLike {
  get(key: string, type: "json"): Promise<unknown | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
  list(opts: { prefix: string; cursor?: string }): Promise<{ keys: { name: string }[]; list_complete: boolean; cursor?: string }>;
}

/** Workers KV rejects a TTL under 60 s. */
const MIN_TTL_SECONDS = 60;
const LIST_PAGE_CAP = 20;

export class CloudflareKv implements KvLike {
  constructor(private readonly binding: () => Promise<KvNamespaceLike>) {}

  async get(key: string) {
    return (await (await this.binding()).get(key, "json")) ?? null;
  }
  async put(key: string, value: unknown, opts: { ttlSeconds?: number } = {}) {
    const ttl = opts.ttlSeconds === undefined ? undefined : { expirationTtl: Math.max(MIN_TTL_SECONDS, Math.ceil(opts.ttlSeconds)) };
    await (await this.binding()).put(key, JSON.stringify(value), ttl);
  }
  async delete(key: string) {
    await (await this.binding()).delete(key);
  }
  async list(prefix: string) {
    const kv = await this.binding();
    const names: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < LIST_PAGE_CAP; page++) {
      const res = await kv.list({ prefix, cursor });
      names.push(...res.keys.map((k) => k.name));
      if (res.list_complete) break;
      cursor = res.cursor;
    }
    return names;
  }
}

/** Resolves the `LE_KV` binding of the current request through OpenNext. */
async function openNextBinding(): Promise<KvNamespaceLike> {
  const { getCloudflareContext } = await import("@opennextjs/cloudflare");
  const { env } = await getCloudflareContext({ async: true });
  const kv = (env as unknown as { LE_KV?: KvNamespaceLike }).LE_KV;
  if (!kv) throw new Error("KV binding LE_KV is not configured.");
  return kv;
}

export function createKvRepo(binding: () => Promise<KvNamespaceLike> = openNextBinding): Repo {
  return new KeyedRepo(new CloudflareKv(binding));
}
