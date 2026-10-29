import { ARTISTS, BRANDS, STORE_FIXTURES, TAG_TYPES, fakeUuid, resolveRowTag, type StoreFixture } from "../../../../fixtures/qloo";
import { SAMPLE_STORES } from "@/server/sample/chain";
import { hash53 } from "../evidence";
import { haversineM, offsetPoint, round, type LatLon } from "../geo";

/** Shared pieces of the synthetic Qloo fixture engine. Data lives in /fixtures/qloo (all invented). */

export type Json = Record<string, unknown>;

export const refOf = (fx: StoreFixture): LatLon => {
  const s = SAMPLE_STORES.find((x) => x.id === `store_${fx.slug}`);
  if (!s) throw new Error(`fixture store ${fx.slug} is not in the sample chain`);
  return { lat: s.lat, lon: s.lon };
};

/** Nearest sample store: a store a visitor adds gets its neighbour's character. */
export function nearestFixture(point: LatLon): StoreFixture {
  let best = STORE_FIXTURES[0];
  let bestD = Infinity;
  for (const fx of STORE_FIXTURES) {
    const d = haversineM(point, refOf(fx));
    if (d < bestD) [best, bestD] = [fx, d];
  }
  return best;
}

/** Deterministic noise in [-1, 1] for a seed and key. */
export function noise(seed: string, key: string): number {
  return (parseInt(hash53(`${seed}|${key}`).slice(-6), 16) / 0xffffff) * 2 - 1;
}

export const num = (v: string | undefined): number | undefined => {
  if (v === undefined || v.trim() === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};
export const list = (v: string | undefined): string[] => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : []);

export interface Placed {
  id: string;
  name: string;
  affinity: number;
  popularity: number;
  trend: number;
  tagIds: string[];
  lat: number;
  lon: number;
  entity: Json;
}

export function placesFor(fx: StoreFixture, origin: LatLon): Placed[] {
  const far = haversineM(origin, refOf(fx)) > 20_000;
  return fx.places.map(([name, address, tags, dx, dy, affinity, popularity, rating, trend]) => {
    const at = offsetPoint(origin, dx, dy);
    const resolved = tags.split(",").flatMap((c) => resolveRowTag(c) ?? []);
    const id = fakeUuid(`place:${fx.slug}:${name}`);
    return {
      id, name, affinity, popularity, trend, tagIds: resolved.map((t) => t.id), lat: at.lat, lon: at.lon,
      entity: {
        name, entity_id: id, type: "urn:entity", subtype: "urn:entity:place", popularity,
        properties: { business_rating: rating, ...(far ? {} : { address, geocode: { name: address } }) },
        location: { lat: round(at.lat, 6), lon: round(at.lon, 6) },
        tags: resolved,
        query: { affinity },
      },
    };
  });
}

export interface Named {
  id: string;
  name: string;
  popularity: number;
  affinity: number;
  trend: number;
  tagIds: string[];
  entity: Json;
}

export function artistsFor(fx: StoreFixture): Named[] {
  return fx.artists.flatMap(([slug, affinity, trend]) => {
    const def = ARTISTS.find((a) => a[0] === slug);
    if (!def) return [];
    const [, name, popularity, genres] = def;
    const id = fakeUuid(`artist:${slug}`);
    const tags = genres.map((g) => ({ id: `urn:tag:genre:music:${g}`, name: g.replace(/_/g, " "), type: "urn:tag:genre:music" }));
    return [{
      id, name, popularity, affinity, trend, tagIds: tags.map((t) => t.id),
      entity: { name, entity_id: id, type: "urn:entity", subtype: "urn:entity:artist", popularity, tags, query: { affinity } },
    }];
  });
}

const brandTag = (genre: string) => ({ id: `urn:tag:genre:brand:${genre}`, name: genre.replace(/_/g, " "), type: "urn:tag:genre:brand" });

export function brandsFor(fx: StoreFixture): Named[] {
  return fx.brands.flatMap(([slug, affinity]) => {
    const def = BRANDS.find((b) => b[0] === slug);
    if (!def) return [];
    const [, name, popularity, genre] = def;
    const id = fakeUuid(`brand:${slug}`);
    return [{
      id, name, popularity, affinity, trend: 0.3, tagIds: [brandTag(genre).id],
      entity: { name, entity_id: id, type: "urn:entity", subtype: "urn:entity:brand", popularity, tags: [brandTag(genre)], query: { affinity } },
    }];
  });
}

/** Every entity the fixtures know, keyed by id, for /entities, compare and trending. */
let indexCache: Map<string, Named & { kind: "place" | "artist" | "brand" }> | undefined;
export function entityIndex() {
  if (indexCache) return indexCache;
  const m = new Map<string, Named & { kind: "place" | "artist" | "brand" }>();
  for (const fx of STORE_FIXTURES) {
    for (const p of placesFor(fx, refOf(fx))) m.set(p.id, { ...p, kind: "place" });
    for (const a of artistsFor(fx)) m.set(a.id, { ...(m.get(a.id) ?? a), kind: "artist" });
  }
  for (const [slug, name, popularity, genre] of BRANDS) {
    const id = fakeUuid(`brand:${slug}`);
    m.set(id, {
      id, name, popularity, affinity: 0.5, trend: 0.3, tagIds: [brandTag(genre).id], kind: "brand",
      entity: { name, entity_id: id, type: "urn:entity", subtype: "urn:entity:brand", popularity, tags: [brandTag(genre)] },
    });
  }
  indexCache = m;
  return m;
}

export const allTagTypes = TAG_TYPES;
