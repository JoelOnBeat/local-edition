import { describe, expect, it } from "vitest";
import { addressOf, compareTagsOf, entitiesOf, entityRef, imageOf, latLonOf, ratingOf, spotifyIdOf, tagNamespace, topContributor, trendSeriesOf } from "@/server/qloo/parse";
import { InsightsEnvelope, SearchEnvelope, TrendingEnvelope, isEntityId } from "@/server/qloo/types";
import { boundsOf, haversineM, offsetPoint, parseWktCoords, parseWktPoint, polygonWkt } from "@/server/qloo/geo";

describe("T2 tolerant parsing", () => {
  it("accepts /search as a bare array or { entities }, and insights with extra fields", () => {
    expect(SearchEnvelope.safeParse({ results: [{ name: "A", entity_id: "x", extra: 1 }] }).success).toBe(true);
    expect(SearchEnvelope.safeParse({ results: { entities: [{ name: "A" }] }, unknown_top: true }).success).toBe(true);
    expect(InsightsEnvelope.safeParse({ success: true, results: { entities: [], heatmap: [], weird: 1 }, duration: 3 }).success).toBe(true);
    expect(InsightsEnvelope.safeParse({}).success).toBe(true);
    expect(InsightsEnvelope.safeParse("nope").success).toBe(false);
    expect(entitiesOf(undefined)).toEqual([]);
    expect(entitiesOf({ results: [{ name: "A" }] })).toHaveLength(1);
    expect(entitiesOf({ results: { entities: [{ name: "B" }] } })).toHaveLength(1);
  });

  it("entityRef prefers subtype, falls back to the requested type, and needs id and name", () => {
    expect(entityRef({ entity_id: "1", name: "X", type: "urn:entity", subtype: "urn:entity:artist" }, "urn:entity:brand")).toEqual({ entityId: "1", name: "X", type: "urn:entity:artist" });
    expect(entityRef({ entity_id: "1", name: "X", type: "urn:entity" }, "urn:entity:brand")?.type).toBe("urn:entity:brand");
    expect(entityRef({ name: "X" }, "urn:entity:brand")).toBeUndefined();
    expect(isEntityId("1ce71098-a0fd-4319-888e-45e785880a34")).toBe(true);
    expect(isEntityId("sample-aesop")).toBe(false);
  });

  it("latLonOf reads the documented spots and common variants, rejects junk", () => {
    expect(latLonOf({ location: { lat: 40.1, lon: -73.9 } })).toEqual({ lat: 40.1, lon: -73.9 });
    expect(latLonOf({ properties: { geocode: { latitude: 40.1, longitude: -73.9 } } })).toEqual({ lat: 40.1, lon: -73.9 });
    expect(latLonOf({ properties: { location: { lat: 1, lng: 2 } } })).toEqual({ lat: 1, lon: 2 });
    expect(latLonOf({ location: { lat: 200, lon: 0 } })).toBeUndefined();
    expect(latLonOf({ location: "40,-73" })).toBeUndefined();
    expect(latLonOf({})).toBeUndefined();
  });

  it("reads address, rating, image, spotify id defensively", () => {
    expect(addressOf({ properties: { address: " 1 Main St " } })).toBe("1 Main St");
    expect(addressOf({ properties: { geocode: { name: "Elsewhere" } } })).toBe("Elsewhere");
    expect(addressOf({})).toBeNull();
    expect(ratingOf({ properties: { business_rating: 4.5 } })).toBe(4.5);
    expect(ratingOf({ properties: { business_rating: "4" } })).toBeNull();
    expect(imageOf({ properties: { image: { url: "https://images.qloo.com/a.jpg" } } })).toBe("https://images.qloo.com/a.jpg");
    expect(spotifyIdOf({ external: { spotify: { id: ["abc"] } } })).toBe("abc");
    expect(spotifyIdOf({})).toBeNull();
    expect(tagNamespace("urn:tag:cuisine:qloo:greek")).toBe("cuisine");
  });

  it("topContributor handles array, { entities } and map forms", () => {
    const names = new Map([["a", "Aesop"], ["m", "Muji"]]);
    expect(topContributor([{ entity_id: "a", weight: 0.2 }, { entity_id: "m", weight: 0.7 }], names)).toBe("Muji");
    expect(topContributor({ entities: [{ entity_id: "a", name: "Named", impact: 0.9 }] }, names)).toBe("Named");
    expect(topContributor({ a: 0.4, m: 0.1 }, names)).toBe("Aesop");
    expect(topContributor(undefined, names)).toBeNull();
    expect(topContributor("junk", names)).toBeNull();
  });

  it("trendSeriesOf accepts nested and flat shapes, newest first", () => {
    const pt = (date: string, f: number) => ({ date, velocity_fold_change: f, population_rank_velocity: 3 });
    const nested = trendSeriesOf({ results: { trending: [{ entity_id: "e1", trends: [pt("2026-10-01", 1), pt("2026-10-22", 2)] }] } });
    expect(nested.get("e1")![0]).toMatchObject({ date: "2026-10-22", velocityFoldChange: 2, rankVelocity: 3 });
    const flat = trendSeriesOf({ results: [{ entity_id: "e2", ...pt("2026-10-01", 1) }, { entity_id: "e2", ...pt("2026-10-08", 3) }] });
    expect(flat.get("e2")!.map((p) => p.velocityFoldChange)).toEqual([3, 1]);
    const bare = trendSeriesOf({ results: { trending: [pt("2026-10-08", 5)] } }, "solo");
    expect(bare.get("solo")![0].velocityFoldChange).toBe(5);
    expect(trendSeriesOf({ results: { trending: [pt("2026-10-08", 5)] } }).size).toBe(0);
    expect(trendSeriesOf(undefined).size).toBe(0);
    expect(TrendingEnvelope.safeParse({ results: [] }).success).toBe(true);
  });

  it("compareTagsOf reads tags with score, sorted, from arrays or { tags }", () => {
    const rows = [{ name: "B", tag_id: "t2", query: { score: 0.4 } }, { name: "A", id: "t1", query: { score: 0.9 } }, { nameless: true }];
    expect(compareTagsOf({ results: rows }).map((x) => x.name)).toEqual(["A", "B"]);
    expect(compareTagsOf({ results: { tags: rows } })[0]).toEqual({ tagId: "t1", name: "A", score: 0.9 });
    expect(compareTagsOf({ results: { entities: [{ name: "E", query: { affinity: 0.3 } }] } })[0].score).toBe(0.3);
    expect(compareTagsOf(undefined)).toEqual([]);
  });
});

describe("T2 geometry", () => {
  it("haversine and offsets agree", () => {
    const a = { lat: 40.7175, lon: -73.9573 };
    const b = offsetPoint(a, 300, 400);
    expect(haversineM(a, b)).toBeCloseTo(500, -1);
    expect(haversineM(a, a)).toBe(0);
  });

  it("WKT round trips longitude first", () => {
    expect(parseWktPoint("POINT(-73.9573 40.7175)")).toEqual({ lat: 40.7175, lon: -73.9573 });
    expect(parseWktPoint("POINT(40.7175 -120.5)")).toBeUndefined(); // an impossible latitude is rejected
    expect(parseWktPoint(undefined)).toBeUndefined();
    const poly = polygonWkt(boundsOf([{ lat: 40.7, lon: -74 }, { lat: 40.8, lon: -73.9 }], 500));
    expect(poly).toMatch(/^POLYGON\(\(-74\.\d+ 40\.6\d+,/);
    const ring = parseWktCoords(poly);
    expect(ring).toHaveLength(5);
    expect(ring[0]).toEqual(ring[4]);
  });
});
