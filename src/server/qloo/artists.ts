import type { Evidence, QlooEntityRef, Store } from "@/contract";
import { resolveDeps, type QlooDeps } from "./deps";
import { buildEvidence } from "./evidence";
import { clamp, pointWkt, round } from "./geo";
import { affinityOf, entitiesOf, entityRef, imageOf, spotifyIdOf, topContributor } from "./parse";
import { MAX_TAKE, validIds } from "./places";

export interface ArtistOptions {
  /** `filter.popularity.max` percentile (0-1): the "local-feeling, not top-40" dial. Default 0.7. */
  popularityMax?: number;
  /** `filter.popularity.min` percentile; removes unknowns. Default 0.2. */
  popularityMin?: number;
  /** Music genre tags, e.g. `urn:tag:genre:music:soul`. */
  tags?: string[];
  excludeIds?: string[];
  /** Default 30, max 50. */
  take?: number;
  /** Default `low`; `rising` runs `off` and `high`. */
  biasTrends?: "off" | "very_low" | "low" | "mid" | "medium" | "high" | "very_high";
}

export interface ArtistHit {
  artist: QlooEntityRef;
  affinity: number | null;
  popularity: number | null;
  image: string | null;
  spotifyId: string | null;
  because: string | null;
  evidenceId: string;
}

export interface ArtistsResult {
  hits: ArtistHit[];
  /** One evidence for the whole query; its `entityIds` are all returned artists. */
  evidence: Evidence[];
}

export function artistQuery(store: Store, anchorIds: readonly string[] | undefined, o: ArtistOptions) {
  const anchors = validIds(anchorIds);
  const max = clamp(o.popularityMax ?? 0.7, 0.05, 1);
  const min = clamp(o.popularityMin ?? 0.2, 0, max);
  return {
    "filter.type": "urn:entity:artist",
    "signal.location": pointWkt(store),
    "signal.interests.entities": anchors,
    "filter.popularity.min": min,
    "filter.popularity.max": max,
    "bias.trends": o.biasTrends ?? "low",
    "filter.tags": o.tags ?? [],
    "filter.exclude.entities": validIds(o.excludeIds),
    take: Math.round(clamp(o.take ?? 30, 1, MAX_TAKE)),
    "feature.explainability": anchors.length ? true : undefined,
  } as const;
}

/** Artists with a local skew around a store, for the in-store sound brief. Artists, never tracks. */
export async function artistsLocal(
  store: Store,
  anchorIds: readonly string[] | undefined,
  options: ArtistOptions = {},
  partial?: Partial<QlooDeps>,
): Promise<ArtistsResult> {
  const deps = resolveDeps(partial);
  const query = artistQuery(store, anchorIds, options);
  const call = await deps.client.insights(query);
  const raw = entitiesOf(call.data);
  const hits: ArtistHit[] = [];
  for (const e of raw) {
    const ref = entityRef(e, "urn:entity:artist");
    if (!ref) continue;
    hits.push({
      artist: ref,
      affinity: affinityOf(e) ?? null,
      popularity: e.popularity ?? null,
      image: imageOf(e),
      spotifyId: spotifyIdOf(e),
      because: topContributor(e.query?.explainability, new Map()),
      evidenceId: "",
    });
  }
  if (!hits.length) return { hits, evidence: [] };

  const top = hits.slice(0, 5).map((h) => h.artist.name).join(", ");
  const pops = hits.flatMap((h) => (h.popularity === null ? [] : [h.popularity]));
  const ev = buildEvidence({
    scope: store.id,
    call,
    summary:
      `${hits.length} artists with a local skew around ${store.name}, kept between the ` +
      `${Math.round(query["filter.popularity.min"] * 100)}th and ${Math.round(query["filter.popularity.max"] * 100)}th popularity percentile: ${top}.`,
    metrics: {
      affinity: hits[0].affinity ?? undefined,
      popularity: pops.length ? round(pops.reduce((a, b) => a + b, 0) / pops.length) : undefined,
    },
    entityIds: hits.map((h) => h.artist.entityId),
    now: deps.now(),
  });
  for (const h of hits) h.evidenceId = ev.id;
  return { hits, evidence: [ev] };
}
