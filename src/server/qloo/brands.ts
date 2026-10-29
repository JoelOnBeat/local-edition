import type { Evidence, QlooEntityRef, Store } from "@/contract";
import { resolveDeps, type QlooDeps } from "./deps";
import { buildEvidence } from "./evidence";
import { clamp, pointWkt } from "./geo";
import { affinityOf, entitiesOf, entityRef } from "./parse";
import { MAX_TAKE } from "./places";

export interface BrandOptions {
  /** `filter.tags` brand genres. Default food and beverage. */
  tags?: string[];
  /** Default 0.8. */
  popularityMax?: number;
  take?: number;
}

export interface BrandHit {
  brand: QlooEntityRef;
  affinity: number | null;
  popularity: number | null;
  evidenceId: string;
}

export interface BrandsResult {
  hits: BrandHit[];
  evidence: Evidence[];
}

/** Brands with no coordinates; out of scope for this product per tech brief 1d. */
const OUT_OF_SCOPE = "urn:tag:genre:brand:health_and_beauty";

/** Brands that over-index at the block, for co-brand and "pairs with" ideas. */
export async function brandsLocal(store: Store, options: BrandOptions = {}, partial?: Partial<QlooDeps>): Promise<BrandsResult> {
  const deps = resolveDeps(partial);
  const call = await deps.client.insights({
    "filter.type": "urn:entity:brand",
    "signal.location": pointWkt(store),
    "filter.tags": options.tags ?? ["urn:tag:genre:brand:food_and_beverage"],
    "filter.exclude.tags": OUT_OF_SCOPE,
    "filter.popularity.max": clamp(options.popularityMax ?? 0.8, 0.05, 1),
    take: Math.round(clamp(options.take ?? 15, 1, MAX_TAKE)),
  });
  const hits: BrandHit[] = [];
  for (const e of entitiesOf(call.data)) {
    const ref = entityRef(e, "urn:entity:brand");
    if (!ref) continue;
    if ((e.tags ?? []).some((t) => (t.id ?? t.tag_id ?? "").startsWith(OUT_OF_SCOPE))) continue;
    hits.push({ brand: ref, affinity: affinityOf(e) ?? null, popularity: e.popularity ?? null, evidenceId: "" });
  }
  if (!hits.length) return { hits, evidence: [] };
  const ev = buildEvidence({
    scope: store.id,
    call,
    summary: `Brands that over-index around ${store.name}: ${hits.slice(0, 5).map((h) => h.brand.name).join(", ")}.`,
    metrics: { affinity: hits[0].affinity ?? undefined, popularity: hits[0].popularity ?? undefined },
    entityIds: hits.map((h) => h.brand.entityId),
    now: deps.now(),
  });
  for (const h of hits) h.evidenceId = ev.id;
  return { hits, evidence: [ev] };
}
