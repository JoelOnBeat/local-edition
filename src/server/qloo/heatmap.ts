import ngeohash from "ngeohash";
import type { Chain, Evidence, Store } from "@/contract";
import { anchorIds, resolveAnchors } from "./anchors";
import { resolveDeps, type QlooDeps } from "./deps";
import { buildEvidence } from "./evidence";
import { boundsOf, clamp, haversineM, polygonWkt, round } from "./geo";
import { heatCellsOf } from "./parse";
import { MAX_TAKE } from "./places";

export interface HeatCellOut {
  lat: number;
  lon: number;
  geohash: string;
  affinity: number | null;
  affinityRank: number | null;
  popularity: number | null;
}

export type Zone = "strong" | "moderate" | "weak" | "unknown";

export interface StoreZone {
  storeId: string;
  zone: Zone;
  /** Distance-weighted mean of affinity_rank (affinity when rank is absent) over nearby cells. */
  score: number | null;
  popularity: number | null;
  cellsUsed: number;
}

export interface HeatmapResult {
  cells: HeatCellOut[];
  stores: StoreZone[];
  evidence: Evidence[];
}

export interface HeatmapOptions {
  take?: number;
  /** Cells within this many metres of a store count towards its zone (default 1500). */
  radiusM?: number;
}

export function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const i = clamp(p, 0, 1) * (sorted.length - 1);
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

/** Strong >= P75 of all cells, weak <= P25, otherwise moderate. */
export function zoneFor(score: number | null, cellScores: number[]): Zone {
  if (score === null || !cellScores.length) return "unknown";
  const sorted = [...cellScores].sort((a, b) => a - b);
  if (score >= percentile(sorted, 0.75)) return "strong";
  if (score <= percentile(sorted, 0.25)) return "weak";
  return "moderate";
}

/** Optional portfolio map layer: urn:heatmap over a box around all stores, scored per store. */
export async function heatmap(stores: Store[], chain: Chain, options: HeatmapOptions = {}, partial?: Partial<QlooDeps>): Promise<HeatmapResult> {
  const deps = resolveDeps(partial);
  if (!stores.length) return { cells: [], stores: [], evidence: [] };
  const radiusM = options.radiusM ?? 1500;
  const ids = anchorIds(await resolveAnchors(chain, deps));
  const call = await deps.client.insights({
    "filter.type": "urn:heatmap",
    "filter.location": polygonWkt(boundsOf(stores, radiusM)),
    "signal.interests.entities": ids,
    // A heatmap needs at least one signal; the place genre is the documented fallback.
    "signal.interests.tags": ids.length ? undefined : "urn:tag:genre:place:restaurant",
    take: Math.round(clamp(options.take ?? MAX_TAKE, 1, MAX_TAKE)),
  });
  const cells: HeatCellOut[] = heatCellsOf(call.data).flatMap((c) => {
    const lat = c.location?.latitude;
    const lon = c.location?.longitude;
    if (typeof lat !== "number" || typeof lon !== "number") return [];
    return [{
      lat,
      lon,
      geohash: c.location?.geohash ?? ngeohash.encode(lat, lon, 7),
      affinity: c.query?.affinity ?? null,
      affinityRank: c.query?.affinity_rank ?? null,
      popularity: c.query?.popularity ?? null,
    }];
  });
  const scoreOf = (c: HeatCellOut) => c.affinityRank ?? c.affinity;
  const all = cells.flatMap((c) => scoreOf(c) ?? []);

  const zones: StoreZone[] = stores.map((s) => {
    let wSum = 0;
    let sSum = 0;
    let pSum = 0;
    let pN = 0;
    let used = 0;
    for (const c of cells) {
      const sc = scoreOf(c);
      const d = haversineM(s, c);
      if (sc === null || d > radiusM) continue;
      const w = 1 / (1 + d / 500);
      wSum += w;
      sSum += w * sc;
      used++;
      if (c.popularity !== null) {
        pSum += c.popularity;
        pN++;
      }
    }
    const score = used ? round(sSum / wSum) : null;
    return { storeId: s.id, zone: zoneFor(score, all), score, popularity: pN ? round(pSum / pN) : null, cellsUsed: used };
  });

  const evidence = cells.length
    ? [
        buildEvidence({
          scope: stores.map((s) => s.id).sort().join("+"),
          call,
          summary: `Taste heatmap for ${chain.name} across ${chain.city.name}: ${cells.length} cells; ${zones.filter((z) => z.zone === "strong").length} of ${stores.length} stores sit in strong zones.`,
          metrics: { affinity: all.length ? round(Math.max(...all)) : undefined },
          now: deps.now(),
        }),
      ]
    : [];
  return { cells, stores: zones, evidence };
}
