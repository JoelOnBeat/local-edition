import type { Chain, CompareResponse, Evidence, ProfileResponse, Store } from "@/contract";
import { HttpError } from "../http/errors";
import type { Repo } from "../store/repo";
import { anchorIds, resolveAnchors } from "./anchors";
import { blockProfile } from "./block";
import { compareStores } from "./compare";
import { repoCache, resolveDeps, TTL, type QlooDeps } from "./deps";
import { hash53 } from "./evidence";

/** Orchestration for the routes: caching through the repository and evidence persistence. */

type Cached<T> = T & { cachedAt: string };

/** Evidence served from the cache keeps `fixture` (so the UI still badges sample data), else becomes `cache`. */
const asCached = (ev: Evidence[]): Evidence[] => ev.map((e) => (e.mode === "fixture" ? e : { ...e, mode: "cache" as const }));

function depsFor(repo: Repo, partial?: Partial<QlooDeps>): QlooDeps {
  return resolveDeps({ cache: repoCache(repo), ...partial });
}

async function profileKey(store: Store, chain: Chain, deps: QlooDeps): Promise<string> {
  const anchors = chain.anchors.map((a) => a.entityId).join(",");
  const sig = hash53(`${store.lat},${store.lon}|${chain.city.name}|${anchors}|${deps.client.mode}`);
  return `qloo:profile:v1:${store.id}:${sig}`;
}

export async function profileForStore(repo: Repo, store: Store, chain: Chain, partial?: Partial<QlooDeps>): Promise<ProfileResponse> {
  const deps = depsFor(repo, partial);
  const key = await profileKey(store, chain, deps);
  const hit = await deps.cache.get<Cached<ProfileResponse>>(key);
  if (hit) return { profile: hit.profile, evidence: asCached(hit.evidence) };

  const result = await blockProfile(store, chain, deps);
  if (result.evidence.length) await repo.putEvidence(result.evidence);
  if (result.profile.tags.length) {
    await deps.cache.put<Cached<ProfileResponse>>(key, { ...result, cachedAt: deps.now().toISOString() }, TTL.profile);
  }
  return result;
}

export async function compareForStores(repo: Repo, a: Store, b: Store, chain: Chain, partial?: Partial<QlooDeps>): Promise<CompareResponse> {
  if (a.id === b.id) throw new HttpError(400, "same_store", "Pick two different stores to compare.");
  if (a.chainId !== b.chainId) throw new HttpError(400, "different_chain", "Both stores must belong to the same chain.");
  const result = await compareStores(a, b, chain, depsFor(repo, partial));
  if (result.evidence.length) await repo.putEvidence(result.evidence);
  return result;
}

/** Anchor ids for downstream callers (agent): resolves sample placeholders to real Qloo ids. */
export async function chainAnchorIds(repo: Repo, chain: Chain, partial?: Partial<QlooDeps>): Promise<string[]> {
  return anchorIds(await resolveAnchors(chain, depsFor(repo, partial)));
}
