import type { BlockProfile, BlockTag, Chain, Evidence, Store, TagKind } from "@/contract";
import { createLogger } from "../log";
import { isForbidden, type QlooCall } from "./client";
import { resolveDeps, TTL, type QlooDeps } from "./deps";
import { buildEvidence } from "./evidence";
import { clamp, pointWkt, round } from "./geo";
import { entitiesOf, tagIdOf, tagsOf } from "./parse";
import { BLOCK_TAG_TYPES, kindForTag, mapLimit, median, signed, type BlockTagType } from "./util";

const log = createLogger("qloo:block");

export const MAX_PROFILE_TAGS = 12;
const MAX_PER_KIND = 4;
const MIN_LIFT = 0.02;

export interface RawTag {
  tagId: string;
  name: string;
  affinity: number;
}

export interface BlockResult {
  profile: BlockProfile;
  evidence: Evidence[];
  /** Every scored tag (not cut to 12), for compare. */
  allTags: BlockTag[];
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export function rawTagsOf(env: Parameters<typeof tagsOf>[0]): RawTag[] {
  const out: RawTag[] = [];
  for (const t of tagsOf(env)) {
    const tagId = tagIdOf(t);
    const affinity = t.query?.affinity;
    if (tagId && t.name && typeof affinity === "number") out.push({ tagId, name: t.name, affinity });
  }
  return out;
}

/**
 * lift = store affinity minus the city baseline affinity for the same tag. A tag missing from the
 * baseline list sits below its cutoff, so it gets the baseline's lowest affinity; with no baseline
 * at all the block's own median is used (the profile then ranks within the block only).
 */
export function computeLifts(local: RawTag[], baseline: RawTag[] | null, kindOf: (tagId: string) => TagKind = kindForTag): BlockTag[] {
  const base = new Map((baseline ?? []).map((t) => [t.tagId, t.affinity]));
  const floor = baseline?.length ? Math.min(...baseline.map((t) => t.affinity)) : median(local.map((t) => t.affinity));
  return local.map((t) => ({
    tagId: t.tagId,
    name: t.name,
    kind: kindOf(t.tagId),
    affinity: round(t.affinity),
    lift: round(t.affinity - (base.get(t.tagId) ?? floor)),
  }));
}

/** Top tags by lift with at most four per kind, so one namespace cannot crowd out the rest. */
export function pickProfileTags(all: BlockTag[]): BlockTag[] {
  const sorted = [...all].sort((a, b) => b.lift - a.lift || b.affinity - a.affinity || a.tagId.localeCompare(b.tagId));
  const positive = sorted.filter((t) => t.lift >= MIN_LIFT);
  const pool = positive.length >= 3 ? positive : sorted.slice(0, 6);
  const perKind = new Map<TagKind, number>();
  const out: BlockTag[] = [];
  for (const t of pool) {
    const n = perKind.get(t.kind) ?? 0;
    if (n >= MAX_PER_KIND) continue;
    perKind.set(t.kind, n + 1);
    out.push(t);
    if (out.length === MAX_PROFILE_TAGS) break;
  }
  return out;
}

interface TypeOutcome {
  spec: BlockTagType;
  call?: QlooCall<unknown>;
  tags: BlockTag[];
  baselineMode: "live" | "replay" | "fixture" | "cache" | "none";
  forbidden: boolean;
  error?: unknown;
}

async function cityBaseline(chain: Chain, spec: BlockTagType, deps: QlooDeps): Promise<{ tags: RawTag[]; mode: TypeOutcome["baselineMode"] } | null> {
  const key = `qloo:baseline:v1:${slug(chain.city.name)}:${spec.type}`;
  const hit = await deps.cache.get<RawTag[]>(key);
  if (hit) return { tags: hit, mode: "cache" };
  try {
    const call = await deps.client.insights({
      "filter.type": "urn:tag",
      "signal.location.query": chain.city.name,
      "filter.tag.types": spec.type,
      take: 50,
    });
    const tags = rawTagsOf(call.data);
    if (tags.length) await deps.cache.put(key, tags, TTL.baseline);
    return { tags, mode: call.mode };
  } catch (e) {
    log.warn("city baseline unavailable", { type: spec.type, code: (e as { code?: string }).code });
    return null;
  }
}

async function oneType(store: Store, chain: Chain, spec: BlockTagType, deps: QlooDeps): Promise<TypeOutcome> {
  try {
    const call = await deps.client.insights({
      "filter.type": "urn:tag",
      "signal.location": pointWkt(store),
      "filter.tag.types": spec.type,
      take: 20,
    });
    const local = rawTagsOf(call.data);
    if (!local.length) return { spec, call, tags: [], baselineMode: "none", forbidden: false };
    const baseline = await cityBaseline(chain, spec, deps);
    return {
      spec,
      call,
      tags: computeLifts(local, baseline?.tags ?? null),
      baselineMode: baseline?.mode ?? "none",
      forbidden: false,
    };
  } catch (e) {
    return { spec, tags: [], baselineMode: "none", forbidden: isForbidden(e), error: e };
  }
}

function typeEvidence(store: Store, chain: Chain, o: TypeOutcome, deps: QlooDeps): Evidence | null {
  if (!o.call || !o.tags.length) return null;
  const top = [...o.tags].sort((a, b) => b.lift - a.lift).slice(0, 3);
  const baselineNote =
    o.baselineMode === "none"
      ? "ranked within this block (no city baseline available)"
      : `against the ${chain.city.name} baseline`;
  const list = top.map((t) => `${t.name} ${t.affinity.toFixed(2)} (${signed(t.lift)})`).join(", ");
  return buildEvidence({
    scope: store.id,
    call: o.call,
    summary: `Taste tags for ${o.spec.label} around ${store.name} (${store.addressLabel}), ${baselineNote}: ${list}.`,
    metrics: { affinity: top[0].affinity, lift: top[0].lift },
    now: deps.now(),
  });
}

/** Fallback when `urn:tag` + location is not available: aggregate the tags carried by nearby places. */
async function placeFallback(store: Store, chain: Chain, deps: QlooDeps): Promise<{ tags: BlockTag[]; evidence: Evidence[] }> {
  const query = { "filter.type": "urn:entity:place", "filter.tags": "urn:tag:genre:place:restaurant", take: 50 } as const;
  const local = await deps.client.insights({ ...query, "filter.location": pointWkt(store), "filter.location.radius": 800, sort_by: "affinity" });
  const cacheKey = `qloo:baseline:v1:${slug(chain.city.name)}:places`;
  let cityShares = await deps.cache.get<Record<string, number>>(cacheKey);
  if (!cityShares) {
    try {
      const city = await deps.client.insights({ ...query, "filter.location.query": chain.city.name, "filter.location.radius": 0 });
      cityShares = tagShares(entitiesOf(city.data));
      if (Object.keys(cityShares).length) await deps.cache.put(cacheKey, cityShares, TTL.baseline);
    } catch (e) {
      log.warn("city place baseline unavailable", { code: (e as { code?: string }).code });
    }
  }
  const shares = tagShares(entitiesOf(local.data), true);
  const names = tagNames(entitiesOf(local.data));
  const baseline: RawTag[] | null = cityShares
    ? Object.entries(cityShares).map(([tagId, affinity]) => ({ tagId, name: names.get(tagId) ?? tagId, affinity }))
    : null;
  const raw: RawTag[] = Object.entries(shares).map(([tagId, affinity]) => ({ tagId, name: names.get(tagId) ?? tagId, affinity }));
  const tags = computeLifts(raw, baseline);
  if (!tags.length) return { tags, evidence: [] };
  const top = [...tags].sort((a, b) => b.lift - a.lift).slice(0, 3);
  const evidence = buildEvidence({
    scope: store.id,
    call: local,
    summary: `Tags carried by restaurants within 800 m of ${store.name}, weighted by Qloo affinity: ${top.map((t) => `${t.name} ${signed(t.lift)}`).join(", ")}.`,
    metrics: { affinity: top[0].affinity, lift: top[0].lift },
    entityIds: entitiesOf(local.data).flatMap((e) => (e.entity_id ? [e.entity_id] : [])).slice(0, 10),
    now: deps.now(),
  });
  return { tags, evidence: [evidence] };
}

const isBlockTag = (id: string) => BLOCK_TAG_TYPES.some((t) => id.startsWith(`${t.type}:`));

/** Affinity-weighted share of places carrying each block tag; tags on a single place are ignored. */
export function tagShares(places: ReturnType<typeof entitiesOf>, requireTwo = false): Record<string, number> {
  const weight = new Map<string, number>();
  const count = new Map<string, number>();
  let total = 0;
  for (const p of places) {
    const w = clamp(p.query?.affinity ?? 0.5, 0.01, 1);
    total += w;
    for (const t of p.tags ?? []) {
      const id = tagIdOf(t);
      if (!id || !isBlockTag(id)) continue;
      weight.set(id, (weight.get(id) ?? 0) + w);
      count.set(id, (count.get(id) ?? 0) + 1);
    }
  }
  const out: Record<string, number> = {};
  if (total <= 0) return out;
  for (const [id, w] of weight) if (!requireTwo || (count.get(id) ?? 0) >= 2) out[id] = round(w / total);
  return out;
}

function tagNames(places: ReturnType<typeof entitiesOf>): Map<string, string> {
  const m = new Map<string, string>();
  for (const p of places) for (const t of p.tags ?? []) if (tagIdOf(t) && t.name) m.set(tagIdOf(t)!, t.name);
  return m;
}

export async function computeBlock(store: Store, chain: Chain, partial?: Partial<QlooDeps>): Promise<BlockResult> {
  const deps = resolveDeps(partial);
  const outcomes = await mapLimit(BLOCK_TAG_TYPES, 4, (spec) => oneType(store, chain, spec, deps));
  const forbidden = outcomes.some((o) => o.forbidden);
  const failures = outcomes.filter((o) => o.error && !o.forbidden);
  let allTags = outcomes.flatMap((o) => o.tags);
  const evidence = outcomes.flatMap((o) => typeEvidence(store, chain, o, deps) ?? []);

  if (forbidden || (!allTags.length && failures.length < outcomes.length)) {
    const fb = await placeFallback(store, chain, deps);
    allTags = fb.tags;
    evidence.length = 0;
    evidence.push(...fb.evidence);
  } else if (!allTags.length && failures.length) {
    throw failures[0].error;
  }

  const seen = new Set<string>();
  allTags = allTags.filter((t) => (seen.has(t.tagId) ? false : (seen.add(t.tagId), true)));
  const tags = pickProfileTags(allTags);
  const profile: BlockProfile = {
    storeId: store.id,
    tags,
    evidenceIds: evidence.map((e) => e.id),
    computedAt: deps.now().toISOString(),
  };
  return { profile, evidence, allTags };
}

/** Block character for one store: tags that over-index against the city baseline, with evidence. */
export async function blockProfile(store: Store, chain: Chain, partial?: Partial<QlooDeps>): Promise<{ profile: BlockProfile; evidence: Evidence[] }> {
  const { profile, evidence } = await computeBlock(store, chain, partial);
  return { profile, evidence };
}
