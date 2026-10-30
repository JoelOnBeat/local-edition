import type { Chain, QlooEntityRef } from "@/contract";
import { resolveDeps, TTL, type QlooDeps } from "./deps";
import { entitiesOf, entityRef } from "./parse";
import { isEntityId } from "./types";

const BRAND = "urn:entity:brand";

/** The cache key of one brand search, so a caller can look before it spends. */
export const brandSearchKey = (q: string, take = 8): string => `qloo:search:brand:v2:${take}:${q.trim().slice(0, 80).toLowerCase()}`;

/** Brand lookup for the "which brands do you resemble" picker. `/search` takes names, not ids. */
export async function searchBrands(q: string, partial?: Partial<QlooDeps>, take = 8): Promise<QlooEntityRef[]> {
  const deps = resolveDeps(partial);
  const query = q.trim().slice(0, 80);
  if (!query) return [];
  const key = brandSearchKey(query, take);
  const hit = await deps.cache.get<QlooEntityRef[]>(key);
  if (hit) return hit;
  const call = await deps.client.search({ query, types: BRAND, take });
  const seen = new Set<string>();
  const refs = entitiesOf(call.data).flatMap((e) => {
    const ref = entityRef(e, BRAND);
    if (!ref || seen.has(ref.entityId)) return [];
    seen.add(ref.entityId);
    return [ref];
  });
  if (refs.length) await deps.cache.put(key, refs, TTL.search);
  return refs;
}

/**
 * A chain's anchors as real Qloo entity ids. Sample anchors carry placeholder ids
 * (`sample-blue-bottle-coffee`), so anything that is not a UUID is resolved by name.
 * Unresolvable anchors are dropped; the rest of the pipeline works with fewer signals.
 */
export async function resolveAnchors(chain: Pick<Chain, "anchors">, partial?: Partial<QlooDeps>): Promise<QlooEntityRef[]> {
  const out: QlooEntityRef[] = [];
  for (const a of chain.anchors) {
    if (isEntityId(a.entityId)) {
      out.push(a);
      continue;
    }
    try {
      const found = await searchBrands(a.name, partial, 3);
      const exact = found.find((f) => f.name.toLowerCase() === a.name.toLowerCase());
      const pick = exact ?? found[0];
      if (pick) out.push(pick);
    } catch {
      // An unresolvable anchor is skipped; callers still get the others.
    }
  }
  return out;
}

export const anchorIds = (refs: QlooEntityRef[]): string[] => refs.map((r) => r.entityId);
