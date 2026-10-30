import type { Evidence, QlooEntityRef, Store } from "@/contract";
import { resolveDeps, type QlooDeps } from "./deps";
import { buildEvidence } from "./evidence";
import { clamp, haversineM, pointWkt, round } from "./geo";
import { addressOf, affinityOf, entitiesOf, entityRef, latLonOf, ratingOf, topContributor } from "./parse";
import { isEntityId } from "./types";

export interface PlaceOptions {
  /** `filter.tags` values, e.g. `urn:tag:genre:place:art_gallery` (union). */
  tags?: string[];
  /** Search radius in metres (default 1200, clamped to 50-5000). */
  radiusM?: number;
  /** Qloo entity ids of the chain's taste anchors; placeholders that are not UUIDs are ignored. */
  anchorIds?: string[];
  /** entity id -> brand name, for the "matched because" line: Qloo's explainability carries ids and scores only (observed 30 Oct). */
  anchorNames?: Record<string, string>;
  excludeIds?: string[];
  /** Default 15, max 50 (Qloo's cap). */
  take?: number;
  /** `filter.properties.business_rating.min` (0-5). Not sent unless set. */
  minRating?: number;
  /** `bias.trends` for the query (used by `rising`). */
  biasTrends?: "off" | "very_low" | "low" | "mid" | "medium" | "high" | "very_high";
}

export interface PlaceHit {
  place: QlooEntityRef & { address: string | null; lat: number; lon: number; distanceM: number };
  affinity: number | null;
  popularity: number | null;
  rating: number | null;
  tags: { id: string; name: string; type: string }[];
  /** Which anchor the match leans on, from `query.explainability`, when Qloo returns it. */
  because: string | null;
  evidenceId: string;
}

export interface PlacesResult {
  hits: PlaceHit[];
  evidence: Evidence[];
  /** Results without readable coordinates are dropped (a partner needs a verifiable distance). */
  droppedNoCoords: number;
}

export const MAX_TAKE = 50;
export const validIds = (ids: readonly string[] | undefined) => (ids ?? []).filter(isEntityId);

export function placeQuery(store: Store, o: PlaceOptions) {
  const anchors = validIds(o.anchorIds);
  const exclude = validIds(o.excludeIds);
  return {
    "filter.type": "urn:entity:place",
    "filter.location": pointWkt(store),
    "filter.location.radius": Math.round(clamp(o.radiusM ?? 1200, 50, 5000)),
    "signal.interests.entities": anchors,
    "filter.tags": o.tags ?? [],
    "filter.exclude.entities": exclude,
    "filter.properties.business_rating.min": o.minRating,
    "bias.trends": o.biasTrends,
    take: Math.round(clamp(o.take ?? 15, 1, MAX_TAKE)),
    "feature.explainability": anchors.length ? true : undefined,
  } as const;
}

/** Places near a store ranked by affinity to the chain's anchors, each with its own evidence. */
export async function placesNear(store: Store, options: PlaceOptions = {}, partial?: Partial<QlooDeps>): Promise<PlacesResult> {
  const deps = resolveDeps(partial);
  const call = await deps.client.insights(placeQuery(store, options));
  const raw = entitiesOf(call.data);
  const anchorNames = new Map<string, string>(Object.entries(options.anchorNames ?? {}));
  const hits: PlaceHit[] = [];
  const evidence: Evidence[] = [];
  let droppedNoCoords = 0;

  for (const e of raw) {
    const ref = entityRef(e, "urn:entity:place");
    if (!ref) continue;
    const ll = latLonOf(e);
    if (!ll) {
      droppedNoCoords++;
      continue;
    }
    const distanceM = Math.round(haversineM(store, ll));
    const affinity = affinityOf(e) ?? null;
    const because = topContributor(e.query?.explainability, anchorNames);
    const ev = buildEvidence({
      scope: store.id,
      call,
      discriminator: ref.entityId,
      summary:
        `${ref.name} is ${distanceM} m from ${store.name}` +
        (because ? `, matched because it shares ${because}'s taste profile` : "") +
        (affinity !== null ? ` (Qloo affinity ${affinity.toFixed(2)})` : "") +
        ".",
      metrics: { affinity: affinity ?? undefined, popularity: e.popularity, distanceM },
      entityIds: [ref.entityId],
      now: deps.now(),
    });
    evidence.push(ev);
    hits.push({
      place: { ...ref, address: addressOf(e), lat: round(ll.lat, 6), lon: round(ll.lon, 6), distanceM },
      affinity,
      popularity: e.popularity ?? null,
      rating: ratingOf(e),
      tags: (e.tags ?? []).flatMap((t) => (t.id ?? t.tag_id) && t.name ? [{ id: (t.id ?? t.tag_id)!, name: t.name, type: t.type ?? "" }] : []),
      because,
      evidenceId: ev.id,
    });
  }
  return { hits, evidence, droppedNoCoords };
}
