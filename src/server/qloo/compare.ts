import type { BlockTag, Chain, CompareResult, Evidence, Store } from "@/contract";
import { createLogger } from "../log";
import { anchorIds, resolveAnchors } from "./anchors";
import { computeBlock } from "./block";
import { qlooLiveOnly } from "./mode";
import { resolveDeps, TTL, type QlooDeps } from "./deps";
import { buildEvidence } from "./evidence";
import { compareTagsOf, type SharedTag } from "./parse";
import { placesNear } from "./places";
import { BLOCK_TAG_TYPES, qlooCity, toPct } from "./util";

const log = createLogger("qloo:compare");

const SIGNIFICANT = 0.05; // a tag must lift at least this much on its side to be shown
const DIFFERENT = 0.1; // lift gap that makes a tag "lean" one way
const MAX_PER_BUCKET = 8;
const PLACES_PER_SIDE = 5;

export interface TagDiff {
  shared: BlockTag[];
  onlyA: BlockTag[];
  onlyB: BlockTag[];
}

/** Our own tag-lift diff: always works, independent of Qloo's compare endpoint. */
export function diffTags(a: BlockTag[], b: BlockTag[], threshold = DIFFERENT): TagDiff {
  const mapB = new Map(b.map((t) => [t.tagId, t]));
  const mapA = new Map(a.map((t) => [t.tagId, t]));
  const shared: BlockTag[] = [];
  const onlyA: { tag: BlockTag; gap: number }[] = [];
  const onlyB: { tag: BlockTag; gap: number }[] = [];
  for (const ta of a) {
    const tb = mapB.get(ta.tagId);
    const lb = tb?.lift ?? 0;
    if (tb && ta.lift >= SIGNIFICANT && tb.lift >= SIGNIFICANT && Math.abs(ta.lift - tb.lift) <= threshold) {
      shared.push({ ...ta, affinity: avg(ta.affinity, tb.affinity), lift: avg(ta.lift, tb.lift) });
    } else if (ta.lift >= SIGNIFICANT && ta.lift - lb > threshold) {
      onlyA.push({ tag: ta, gap: ta.lift - lb });
    }
  }
  for (const tb of b) {
    const la = mapA.get(tb.tagId)?.lift ?? 0;
    if (tb.lift >= SIGNIFICANT && tb.lift - la > threshold) onlyB.push({ tag: tb, gap: tb.lift - la });
  }
  const top = (xs: { tag: BlockTag; gap: number }[]) =>
    xs.sort((x, y) => y.gap - x.gap || x.tag.tagId.localeCompare(y.tag.tagId)).slice(0, MAX_PER_BUCKET).map((x) => x.tag);
  shared.sort((x, y) => y.lift - x.lift || x.tagId.localeCompare(y.tagId));
  return { shared: shared.slice(0, MAX_PER_BUCKET), onlyA: top(onlyA), onlyB: top(onlyB) };
}

const avg = (x: number, y: number) => Math.round(((x + y) / 2) * 1000) / 1000;

/** Keep the profile evidence for the tag namespaces that actually appear in the diff. */
function evidenceFor(evidence: Evidence[], tags: BlockTag[]): Evidence[] {
  const types = new Set(
    tags.flatMap((t) => BLOCK_TAG_TYPES.filter((x) => t.tagId.startsWith(`${x.type}:`)).map((x) => x.type)),
  );
  return evidence.filter((e) => {
    const t = e.params["filter.tag.types"];
    return t === undefined || types.has(t);
  });
}

interface CachedCompare {
  shared: SharedTag[];
  path: string;
  params: Record<string, string>;
  mode: "live" | "replay" | "fixture" | "cache";
  /** When Qloo answered (the evidence's fetchedAt). */
  at?: string;
  entityIds: string[];
}

async function qlooCompare(a: Store, b: Store, chain: Chain, deps: QlooDeps): Promise<{ data: CachedCompare; cached: boolean } | null> {
  const key = `qloo:compare:v1:${[a.id, b.id].sort().join(":")}`;
  const hit = await deps.cache.get<CachedCompare>(key);
  if (hit && (!qlooLiveOnly() || hit.mode === "live" || hit.mode === "cache")) return { data: hit, cached: true };
  try {
    const anchors = anchorIds(await resolveAnchors(chain, deps));
    const [pa, pb] = await Promise.all(
      [a, b].map((s) => placesNear(s, { anchorIds: anchors, take: PLACES_PER_SIDE }, deps)),
    );
    const idsA = pa.hits.map((h) => h.place.entityId);
    const idsB = pb.hits.map((h) => h.place.entityId);
    if (!idsA.length || !idsB.length) return null;
    const call = await deps.client.compare({
      "a.signal.interests.entities": idsA,
      "b.signal.interests.entities": idsB,
      "filter.type": "urn:entity:place",
      "filter.location.query": qlooCity(chain.city.name),
      model: "descriptive",
      take: 20,
    });
    const data: CachedCompare = {
      shared: compareTagsOf(call.data).slice(0, 10),
      path: call.path,
      params: call.params,
      mode: call.mode,
      at: call.at,
      entityIds: [...idsA, ...idsB],
    };
    await deps.cache.put(key, data, TTL.compare);
    return { data, cached: false };
  } catch (e) {
    // Qloo's compare is the evidence layer; our own diff still answers the question.
    log.warn("qloo compare unavailable", { code: (e as { code?: string }).code });
    return null;
  }
}

/** Tags two stores share and tags that set each apart, plus Qloo's own compare as evidence. */
export async function compareStores(
  a: Store,
  b: Store,
  chain: Chain,
  partial?: Partial<QlooDeps>,
): Promise<{ result: CompareResult; evidence: Evidence[] }> {
  const deps = resolveDeps(partial);
  const [blockA, blockB, remote] = await Promise.all([
    computeBlock(a, chain, deps),
    computeBlock(b, chain, deps),
    qlooCompare(a, b, chain, deps),
  ]);
  const diff = diffTags(blockA.allTags, blockB.allTags);
  const evidence: Evidence[] = [
    ...evidenceFor(blockA.evidence, [...diff.shared, ...diff.onlyA]),
    ...evidenceFor(blockB.evidence, [...diff.shared, ...diff.onlyB]),
  ];
  if (remote && remote.data.shared.length) {
    const top = remote.data.shared.slice(0, 4).map((t) => (t.score === null ? t.name : `${t.name} (${toPct(t.score)})`));
    evidence.push(
      buildEvidence({
        scope: [a.id, b.id].sort().join("+"),
        call: { path: remote.data.path, params: remote.data.params, mode: remote.data.mode, at: remote.data.at },
        mode: remote.cached ? "cache" : remote.data.mode,
        summary: `Qloo compares the top ${PLACES_PER_SIDE} nearby places of ${a.name} and ${b.name}: shared taste includes ${top.join(", ")}.`,
        metrics: { relevance: remote.data.shared[0].score ?? undefined },
        entityIds: remote.data.entityIds,
        now: deps.now(),
      }),
    );
  }
  const unique = [...new Map(evidence.map((e) => [e.id, e])).values()];
  return {
    result: { a: a.id, b: b.id, ...diff, evidenceIds: unique.map((e) => e.id) },
    evidence: unique,
  };
}
