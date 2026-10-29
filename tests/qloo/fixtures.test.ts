import { describe, expect, it } from "vitest";
import { ARTISTS, BRANDS, STORE_FIXTURES, TAG_TYPES, resolveRowTag } from "../../fixtures/qloo";
import { SAMPLE_STORES } from "@/server/sample/chain";
import { respond } from "@/server/qloo/fixtures/router";
import { InsightsEnvelope, SearchEnvelope, TrendingEnvelope, CompareEnvelope, QlooEntity } from "@/server/qloo/types";
import { haversineM, pointWkt } from "@/server/qloo/geo";

const p = (o: Record<string, string>) => o;

describe("T1 fixtures: synthetic data is consistent and in the documented shapes", () => {
  it("one fixture per sample store, in order", () => {
    expect(STORE_FIXTURES.map((f) => `store_${f.slug}`)).toEqual(SAMPLE_STORES.map((s) => s.id));
  });

  it("every place tag code, artist slug and brand slug resolves", () => {
    const artists = new Set(ARTISTS.map((a) => a[0]));
    const brands = new Set(BRANDS.map((b) => b[0]));
    for (const fx of STORE_FIXTURES) {
      expect(fx.places.length).toBeGreaterThanOrEqual(12);
      for (const row of fx.places) {
        for (const code of row[2].split(",")) expect(resolveRowTag(code), `${fx.slug}: ${row[0]} ${code}`).toBeDefined();
        expect(row[5]).toBeGreaterThan(0);
        expect(row[5]).toBeLessThanOrEqual(1);
        expect(haversineM({ lat: 0, lon: 0 }, { lat: row[4] / 111_000, lon: row[3] / 111_000 })).toBeLessThan(1200);
      }
      for (const [slug] of fx.artists) expect(artists.has(slug), `${fx.slug}: ${slug}`).toBe(true);
      for (const [slug] of fx.brands) expect(brands.has(slug), `${fx.slug}: ${slug}`).toBe(true);
      const tagKeys = new Set(TAG_TYPES.flatMap((t) => t.tags.map((x) => `${t.key}:${x[0]}`)));
      for (const k of Object.keys(fx.boosts)) expect(tagKeys.has(k), `${fx.slug}: ${k}`).toBe(true);
    }
  });

  it("place names are unique across the whole fixture set (all invented)", () => {
    const names = STORE_FIXTURES.flatMap((f) => f.places.map((r) => r[0]));
    expect(new Set(names).size).toBe(names.length);
  });

  it("every sample store's responses parse against the tolerant envelopes", () => {
    for (const s of SAMPLE_STORES) {
      const at = pointWkt(s);
      const bodies = [
        respond("/v2/insights", p({ "filter.type": "urn:tag", "signal.location": at, "filter.tag.types": "urn:tag:ambience:qloo" })),
        respond("/v2/insights", p({ "filter.type": "urn:tag", "signal.location.query": "New York", "filter.tag.types": "urn:tag:cuisine:qloo" })),
        respond("/v2/insights", p({ "filter.type": "urn:entity:place", "filter.location": at, "filter.location.radius": "1200", take: "50" })),
        respond("/v2/insights", p({ "filter.type": "urn:entity:artist", "signal.location": at })),
        respond("/v2/insights", p({ "filter.type": "urn:entity:brand", "signal.location": at })),
      ];
      for (const b of bodies) {
        const parsed = InsightsEnvelope.parse(b);
        expect(parsed.success).toBe(true);
      }
      const places = (InsightsEnvelope.parse(bodies[2]).results as { entities: unknown[] }).entities;
      expect(places.length).toBeGreaterThanOrEqual(10);
      places.forEach((e) => QlooEntity.parse(e));
    }
    SearchEnvelope.parse(respond("/search", p({ query: "muji" })));
    SearchEnvelope.parse(respond("/entities", p({ entity_ids: "x" })));
    InsightsEnvelope.parse(respond("/v2/tags", p({ "filter.query": "cozy" })));
    InsightsEnvelope.parse(respond("/v2/audiences", p({})));
    CompareEnvelope.parse(respond("/v2/analysis/compare", p({})));
    TrendingEnvelope.parse(respond("/v2/trending", p({})));
  });

  it("is deterministic and equal requests give equal bodies", () => {
    const q = p({ "filter.type": "urn:entity:artist", "signal.location": "POINT(-73.9573 40.7175)", "bias.trends": "high" });
    expect(JSON.stringify(respond("/v2/insights", q))).toBe(JSON.stringify(respond("/v2/insights", q)));
  });

  it("applies filters the way Qloo documents them", () => {
    const at = pointWkt(SAMPLE_STORES[0]);
    const names = (b: unknown) => ((b as { results: { entities: { name: string; popularity: number }[] } }).results.entities);
    const art = names(respond("/v2/insights", p({ "filter.type": "urn:entity:artist", "signal.location": at, "filter.popularity.max": "0.5", "filter.popularity.min": "0.3" })));
    expect(art.length).toBeGreaterThan(3);
    expect(art.every((a) => a.popularity >= 0.3 && a.popularity <= 0.5)).toBe(true);
    const take = names(respond("/v2/insights", p({ "filter.type": "urn:entity:place", "filter.location": at, "filter.location.radius": "2000", take: "3" })));
    expect(take).toHaveLength(3);
    const parks = names(respond("/v2/insights", p({ "filter.type": "urn:entity:place", "filter.location": at, "filter.location.radius": "2000", "filter.tags": "urn:tag:genre:place:park" })));
    expect(parks.map((x) => x.name)).toEqual(["Kent Street Pocket Park"]);
    const parent = names(respond("/v2/insights", p({ "filter.type": "urn:entity:place", "filter.location": at, "filter.location.radius": "2000", "filter.tags": "urn:tag:genre:place:restaurant" })));
    expect(parent.length).toBeGreaterThanOrEqual(5); // hierarchical: bakery, cafe and bar sit under restaurant
  });

  it("a point far from every sample store re-projects the neighbour's places around it", () => {
    const sf = { lat: 37.7749, lon: -122.4194 };
    const body = respond("/v2/insights", p({ "filter.type": "urn:entity:place", "filter.location": pointWkt(sf), "filter.location.radius": "1200", take: "50" })) as {
      results: { entities: { location: { lat: number; lon: number }; properties: Record<string, unknown> }[] };
    };
    const es = body.results.entities;
    expect(es.length).toBeGreaterThan(5);
    expect(es.every((e) => haversineM(sf, e.location) <= 1200)).toBe(true);
    expect(es.every((e) => e.properties.address === undefined)).toBe(true); // no New York street names in San Francisco
  });

  it("unknown paths and types return an empty, valid envelope", () => {
    expect(InsightsEnvelope.parse(respond("/nope", {}))).toBeTruthy();
    expect(respond("/v2/insights", p({ "filter.type": "urn:entity:movie" }))).toMatchObject({ results: { entities: [] } });
  });
});
