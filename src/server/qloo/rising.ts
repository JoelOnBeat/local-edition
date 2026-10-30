import type { Evidence, QlooEntityRef, Store } from "@/contract";
import { createLogger } from "../log";
import { artistQuery } from "./artists";
import { resolveDeps, type QlooDeps } from "./deps";
import { buildEvidence } from "./evidence";
import { haversineM } from "./geo";
import { affinityOf, entitiesOf, entityRef, latLonOf, trendSeriesOf, type TrendPoint } from "./parse";
import { placeQuery } from "./places";
import { signed } from "./util";

const log = createLogger("qloo:rising");

export type RisingKind = "place" | "artist";

export interface Momentum {
  asOf: string;
  velocityFoldChange: number | null;
  rankVelocity: number | null;
  populationPercentile: number | null;
}

export interface RisingHit {
  kind: RisingKind;
  entity: QlooEntityRef;
  /** Position (1-based) in the `bias.trends=off` run; null when absent from it. */
  rankOff: number | null;
  /** Position in the `bias.trends=high` run. */
  rankHigh: number;
  affinity: number | null;
  distanceM: number | null;
  /** Global momentum from /v2/trending (not local to the block); null when unavailable. */
  momentum: Momentum | null;
  evidenceIds: string[];
}

export interface RisingOptions {
  anchorIds?: string[];
  kinds?: RisingKind[];
  /** Candidates per run (default 20). */
  take?: number;
  /** Places climb at least this many ranks to count (default 5). */
  minImprovement?: number;
  /** Entities per kind to fetch momentum for (default 5; 0 skips /v2/trending). */
  momentumFor?: number;
  radiusM?: number;
}

export interface RisingResult {
  hits: RisingHit[];
  evidence: Evidence[];
  /** False when `off` and `high` returned the same order: bias.trends is not moving this category. */
  biasMovesOrder: boolean;
}

const DAY_MS = 86_400_000;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const ENTITY_URN: Record<RisingKind, string> = { place: "urn:entity:place", artist: "urn:entity:artist" };

export function pickRising(off: string[], high: string[], minImprovement: number): { id: string; rankOff: number | null; rankHigh: number }[] {
  const offRank = new Map(off.map((id, i) => [id, i + 1]));
  const out: { id: string; rankOff: number | null; rankHigh: number }[] = [];
  high.forEach((id, i) => {
    const rankHigh = i + 1;
    const rankOff = offRank.get(id) ?? null;
    if (rankOff === null || rankOff - rankHigh >= minImprovement) out.push({ id, rankOff, rankHigh });
  });
  return out;
}

async function momentum(store: Store, kind: RisingKind, ids: string[], deps: QlooDeps) {
  const today = deps.now();
  try {
    const call = await deps.client.trending({
      "filter.type": ENTITY_URN[kind],
      "signal.interests.entities": ids,
      "filter.start_date": isoDay(new Date(today.getTime() - 84 * DAY_MS)),
      "filter.end_date": isoDay(today),
      take: ids.length,
    });
    return { call, series: trendSeriesOf(call.data, ids.length === 1 ? ids[0] : undefined) };
  } catch (e) {
    log.warn("trending unavailable", { store: store.id, code: (e as { code?: string }).code });
    return null;
  }
}

function toMomentum(points: TrendPoint[] | undefined): Momentum | null {
  const p = points?.[0];
  if (!p) return null;
  return {
    asOf: p.date,
    velocityFoldChange: p.velocityFoldChange ?? null,
    rankVelocity: p.rankVelocity ?? null,
    populationPercentile: p.populationPercentile ?? null,
  };
}

async function risingForKind(store: Store, kind: RisingKind, o: RisingOptions, deps: QlooDeps) {
  const base = { anchorIds: o.anchorIds, take: o.take ?? 20 };
  const query = (bias: "off" | "high") =>
    kind === "place"
      ? placeQuery(store, { ...base, radiusM: o.radiusM, biasTrends: bias })
      : artistQuery(store, o.anchorIds, { take: base.take, biasTrends: bias });
  const [offCall, highCall] = await Promise.all([deps.client.insights(query("off")), deps.client.insights(query("high"))]);
  const offEntities = entitiesOf(offCall.data);
  const highEntities = entitiesOf(highCall.data);
  const idsOf = (es: typeof offEntities) => es.flatMap((e) => (e.entity_id ? [e.entity_id] : []));
  const picked = pickRising(idsOf(offEntities), idsOf(highEntities), o.minImprovement ?? 5);
  const byId = new Map(highEntities.map((e) => [e.entity_id, e]));
  const biasMovesOrder = idsOf(offEntities).join() !== idsOf(highEntities).join();

  // /v2/trending answers 400 for places (observed 30 Oct: only actor, artist, brand, movie, person, podcast, tv_show), so a place never
  // asks and never spends a call. A trending call also needs signal.interests.entities, filter.start_date and filter.end_date.
  const momentumIds = kind === "artist" ? picked.slice(0, o.momentumFor ?? 5).map((p) => p.id) : [];
  const trend = momentumIds.length ? await momentum(store, kind, momentumIds, deps) : null;

  const evidence: Evidence[] = [];
  const hits: RisingHit[] = [];
  for (const p of picked) {
    const e = byId.get(p.id);
    const ref = e && entityRef(e, ENTITY_URN[kind]);
    if (!e || !ref) continue;
    const ll = kind === "place" ? latLonOf(e) : undefined;
    const rankEv = buildEvidence({
      scope: store.id,
      call: highCall,
      discriminator: `${p.id}|rise`,
      summary:
        p.rankOff === null
          ? `${ref.name} appears near ${store.name} only when Qloo weights what is trending (bias.trends high, rank ${p.rankHigh}); it is absent from the neutral run.`
          : `${ref.name} climbs from #${p.rankOff} to #${p.rankHigh} near ${store.name} when Qloo weights what is trending (bias.trends high vs off).`,
      metrics: { affinity: affinityOf(e), popularity: e.popularity, distanceM: ll ? Math.round(haversineM(store, ll)) : undefined },
      entityIds: [p.id],
      now: deps.now(),
    });
    evidence.push(rankEv);
    const m = toMomentum(trend?.series.get(p.id));
    const ids = [rankEv.id];
    if (m && trend) {
      const fold = m.velocityFoldChange;
      const trendEv = buildEvidence({
        scope: store.id,
        call: trend.call,
        discriminator: p.id,
        summary:
          `Rising in Qloo's population data (global, not local to this block), week of ${m.asOf}` +
          (fold !== null ? `: velocity fold change ${fold.toFixed(2)}` : "") +
          (m.rankVelocity !== null ? `, rank velocity ${signed(m.rankVelocity, 0)}` : "") +
          ".",
        metrics: { relevance: fold ?? undefined, popularity: m.populationPercentile ?? undefined },
        entityIds: [p.id],
        now: deps.now(),
      });
      evidence.push(trendEv);
      ids.push(trendEv.id);
    }
    hits.push({
      kind,
      entity: ref,
      rankOff: p.rankOff,
      rankHigh: p.rankHigh,
      affinity: affinityOf(e) ?? null,
      distanceM: ll ? Math.round(haversineM(store, ll)) : null,
      momentum: m,
      evidenceIds: ids,
    });
  }
  return { hits, evidence, biasMovesOrder };
}

/** "Rising near this store": same query with `bias.trends` high vs off, plus global momentum. */
export async function rising(store: Store, options: RisingOptions = {}, partial?: Partial<QlooDeps>): Promise<RisingResult> {
  const deps = resolveDeps(partial);
  const kinds = options.kinds ?? ["place", "artist"];
  const parts = await Promise.all(kinds.map((k) => risingForKind(store, k, options, deps)));
  return {
    hits: parts.flatMap((p) => p.hits),
    evidence: parts.flatMap((p) => p.evidence),
    biasMovesOrder: parts.some((p) => p.biasMovesOrder),
  };
}
