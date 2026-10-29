import type { KvLike } from "./keyed-repo";

/** Cache key prefixes (without the `cache:` row prefix) the Qloo service writes per store. */
const PROFILE_PREFIX = "qloo:profile:v1:";
const COMPARE_PREFIX = "qloo:compare:v1:";

/**
 * Removes what a deleted store left behind: its profile caches (exact prefix `<profile>:<storeId>:`),
 * the compare caches that name it as one of the two stores (an exact segment match, so `store_a`
 * never matches `store_ab`) and the evidence rows those profiles referenced. Store ids contain no `:`.
 */
export async function purgeStoreCaches(kv: KvLike, storeId: string): Promise<void> {
  for (const key of await kv.list(`cache:${PROFILE_PREFIX}${storeId}:`)) {
    const cached = (await kv.get(key)) as { profile?: { evidenceIds?: string[] }; evidence?: { id: string }[] } | null;
    const ids = new Set([...(cached?.profile?.evidenceIds ?? []), ...(cached?.evidence ?? []).map((e) => e.id)]);
    for (const id of ids) await kv.delete(`ev:${id}`);
    await kv.delete(key);
  }
  for (const key of await kv.list(`cache:${COMPARE_PREFIX}`)) {
    if (key.slice(`cache:${COMPARE_PREFIX}`.length).split(":").includes(storeId)) await kv.delete(key);
  }
}
