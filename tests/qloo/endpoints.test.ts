import { describe, expect, it, vi } from "vitest";
import { Evidence, QlooEntityRef } from "@/contract";
import { SAMPLE_STORES } from "@/server/sample/chain";
import { UpstreamError } from "@/server/http/errors";
import { anchorIds, resolveAnchors, searchBrands } from "@/server/qloo/anchors";
import { artistsLocal } from "@/server/qloo/artists";
import { brandsLocal } from "@/server/qloo/brands";
import { memoryCache } from "@/server/qloo/deps";
import { haversineM } from "@/server/qloo/geo";
import { heatmap, percentile, zoneFor } from "@/server/qloo/heatmap";
import { placesNear } from "@/server/qloo/places";
import { pickRising, rising } from "@/server/qloo/rising";
import { chain, entityEnv, fixtureClient, fixtureDeps, stubClient, store } from "./helpers";

const REAL = "1ce71098-a0fd-4319-888e-45e785880a34";
const place = (name: string, extra: Record<string, unknown> = {}) => ({
  entity_id: crypto.randomUUID(), name, subtype: "urn:entity:place", popularity: 0.4, query: { affinity: 0.8 }, ...extra,
});

describe("T3 placesNear", () => {
  it("returns hits with computed distance, anchor explanation and one valid Evidence each", async () => {
    const s = store("williamsburg");
    const deps = fixtureDeps();
    const refs = await resolveAnchors(chain, deps);
    const anchors = anchorIds(refs);
    const r = await placesNear(s, { anchorIds: anchors, anchorNames: Object.fromEntries(refs.map((x) => [x.entityId, x.name])), tags: ["urn:tag:genre:place:art_gallery", "urn:tag:genre:place:restaurant:bakery"], take: 10 }, deps);
    expect(r.hits.length).toBeGreaterThanOrEqual(2);
    expect(r.droppedNoCoords).toBe(0);
    for (const h of r.hits) {
      QlooEntityRef.parse({ entityId: h.place.entityId, name: h.place.name, type: h.place.type });
      expect(h.place.type).toBe("urn:entity:place");
      expect(Math.abs(h.place.distanceM - haversineM(s, h.place))).toBeLessThan(1);
      expect(h.place.distanceM).toBeLessThanOrEqual(1200);
      expect(h.because).toMatch(/Blue Bottle|Aesop|Muji/);
    }
    const ids = new Set(r.evidence.map((e) => e.id));
    expect(ids.size).toBe(r.hits.length);
    r.evidence.forEach((e) => Evidence.parse(e));
    expect(r.hits.every((h) => ids.has(h.evidenceId))).toBe(true);
    expect(r.evidence[0].metrics.distanceM).toBe(r.hits[0].place.distanceM);
    expect(r.evidence[0].entityIds).toEqual([r.hits[0].place.entityId]);
  });

  it("honours the radius: a tight radius returns fewer, nearer places", async () => {
    const s = store("harlem");
    const wide = await placesNear(s, { radiusM: 1500, take: 50 }, fixtureDeps());
    const tight = await placesNear(s, { radiusM: 200, take: 50 }, fixtureDeps());
    expect(tight.hits.length).toBeLessThan(wide.hits.length);
    expect(tight.hits.every((h) => h.place.distanceM <= 200)).toBe(true);
  });

  it("drops results whose coordinates cannot be read and counts them", async () => {
    const withLoc = place("Has Coords", { location: { lat: 40.7176, lon: -73.9574 } });
    const withGeocode = place("Geocode Only", { properties: { address: "1 Main St", geocode: { latitude: 40.72, longitude: -73.96 } } });
    const none = place("No Coords");
    const { client } = stubClient({ insights: () => entityEnv([withLoc, withGeocode, none]) });
    const r = await placesNear(store("williamsburg"), {}, fixtureDeps({ client }));
    expect(r.hits.map((h) => h.place.name)).toEqual(["Has Coords", "Geocode Only"]);
    expect(r.hits[1].place.address).toBe("1 Main St");
    expect(r.droppedNoCoords).toBe(1);
  });

  it("empty results give empty hits, not an error", async () => {
    const { client } = stubClient({ insights: () => entityEnv([]) });
    expect(await placesNear(store("astoria"), {}, fixtureDeps({ client }))).toEqual({ hits: [], evidence: [], droppedNoCoords: 0 });
  });

  it("passes the query Qloo documents", async () => {
    const { client, calls } = stubClient({ insights: () => entityEnv([]) });
    await placesNear(store("astoria"), { anchorIds: [REAL], tags: ["urn:tag:genre:place:park"], excludeIds: [REAL], minRating: 4, take: 99 }, fixtureDeps({ client }));
    expect(calls[0].query).toMatchObject({
      "filter.type": "urn:entity:place", "filter.location": "POINT(-73.9217 40.7677)", "filter.location.radius": 1200,
      "signal.interests.entities": [REAL], "filter.tags": ["urn:tag:genre:place:park"], "filter.properties.business_rating.min": 4, take: 50,
    });
  });
});

describe("T3 artistsLocal and brandsLocal", () => {
  it("applies the popularity window, returns >= 8 artists per store and one evidence listing them all", async () => {
    for (const s of SAMPLE_STORES) {
      const r = await artistsLocal(s, [], {}, fixtureDeps());
      expect(r.hits.length).toBeGreaterThanOrEqual(8);
      expect(r.hits.every((h) => h.popularity! >= 0.2 && h.popularity! <= 0.7)).toBe(true);
      expect(r.hits.every((h) => h.artist.type === "urn:entity:artist")).toBe(true);
      expect(r.evidence).toHaveLength(1);
      Evidence.parse(r.evidence[0]);
      expect(r.evidence[0].entityIds).toEqual(r.hits.map((h) => h.artist.entityId));
      expect(r.hits.every((h) => h.evidenceId === r.evidence[0].id)).toBe(true);
    }
  });

  it("a lower popularity cap returns fewer, less mainstream artists", async () => {
    const s = store("williamsburg");
    const a = await artistsLocal(s, [], { popularityMax: 0.7 }, fixtureDeps());
    const b = await artistsLocal(s, [], { popularityMax: 0.45 }, fixtureDeps());
    expect(b.hits.length).toBeLessThan(a.hits.length);
    expect(b.hits.every((h) => h.popularity! <= 0.45)).toBe(true);
    expect(b.evidence[0].summary).toContain("45th");
  });

  it("stores differ: Harlem leans soul and jazz, the Upper East Side classical", async () => {
    const harlem = (await artistsLocal(store("harlem"), [], {}, fixtureDeps())).hits.slice(0, 5).map((h) => h.artist.name);
    const ues = (await artistsLocal(store("upper-east-side"), [], {}, fixtureDeps())).hits.slice(0, 5).map((h) => h.artist.name);
    expect(harlem).toContain("Lalah Hathaway");
    expect(ues).toContain("Max Richter");
    expect(harlem.filter((n) => ues.includes(n))).toEqual([]);
  });

  it("brands exclude health and beauty and respect the popularity cap", async () => {
    const r = await brandsLocal(store("west-village"), {}, fixtureDeps());
    expect(r.hits.length).toBeGreaterThan(3);
    const names = r.hits.map((h) => h.brand.name);
    expect(names).not.toContain("Aesop");
    expect(r.hits.every((h) => h.popularity! <= 0.8)).toBe(true);
    Evidence.parse(r.evidence[0]);
  });

  it("brands also drop health_and_beauty results the API itself returns", async () => {
    const brand = (name: string, genre: string) => ({ entity_id: crypto.randomUUID(), name, subtype: "urn:entity:brand", query: { affinity: 0.7 }, tags: [{ id: `urn:tag:genre:brand:${genre}`, name: genre }] });
    const { client } = stubClient({ insights: () => entityEnv([brand("Keep", "food_and_beverage"), brand("Skip", "health_and_beauty")]) });
    expect((await brandsLocal(store("harlem"), {}, fixtureDeps({ client }))).hits.map((h) => h.brand.name)).toEqual(["Keep"]);
  });
});

describe("T3 rising", () => {
  it("pickRising: climbs of >= 5 places, or present only with trend bias", () => {
    const off = ["a", "b", "c", "d", "e", "f", "g", "h"];
    const high = ["g", "a", "b", "z", "c", "d", "e", "f"];
    expect(pickRising(off, high, 5)).toEqual([{ id: "g", rankOff: 7, rankHigh: 1 }, { id: "z", rankOff: null, rankHigh: 4 }]);
    expect(pickRising(off, off, 5)).toEqual([]);
  });

  it("finds rising places and artists with rank-change and momentum evidence", async () => {
    const r = await rising(store("lower-east-side"), {}, fixtureDeps());
    expect(r.biasMovesOrder).toBe(true);
    expect(r.hits.length).toBeGreaterThanOrEqual(2);
    for (const h of r.hits) {
      expect(h.rankHigh).toBeLessThan(h.rankOff ?? 99);
      expect(h.evidenceIds.length).toBeGreaterThanOrEqual(1);
    }
    r.evidence.forEach((e) => Evidence.parse(e));
    const withMomentum = r.hits.filter((h) => h.momentum);
    expect(withMomentum.length).toBeGreaterThan(0);
    expect(withMomentum[0].momentum!.velocityFoldChange).toBeGreaterThan(1);
    const trendEv = r.evidence.find((e) => e.endpoint === "/v2/trending")!;
    expect(trendEv.summary).toContain("global, not local");
    expect(r.evidence.find((e) => e.summary.includes("bias.trends high"))).toBeDefined();
  });

  it("runs the same query with bias.trends off and high", async () => {
    const { client, calls } = stubClient({ insights: () => entityEnv([]) });
    await rising(store("astoria"), { kinds: ["artist"] }, fixtureDeps({ client }));
    expect(calls.map((c) => c.query["bias.trends"]).sort()).toEqual(["high", "off"]);
    const [a, b] = calls.map((c) => { const { ["bias.trends"]: _ignored, ...rest } = c.query; void _ignored; return rest; });
    expect(a).toEqual(b);
  });

  it("reports that bias.trends does not move the order, and survives a trending failure", async () => {
    const same = entityEnv([place("A"), place("B")]);
    const { client } = stubClient({ insights: () => same, trending: () => { throw new UpstreamError("rate_limited", "qloo", "x"); } });
    const r = await rising(store("astoria"), { kinds: ["place"] }, fixtureDeps({ client }));
    expect(r).toMatchObject({ hits: [], biasMovesOrder: false });
    const [pa, pn] = [place("A"), place("New")];
    const move = stubClient({
      insights: (q) => entityEnv(q["bias.trends"] === "high" ? [pn, pa] : [pa]),
      trending: () => { throw new UpstreamError("rate_limited", "qloo", "x"); },
    });
    const r2 = await rising(store("astoria"), { kinds: ["place"] }, fixtureDeps({ client: move.client }));
    expect(r2.hits).toHaveLength(1);
    expect(r2.hits[0]).toMatchObject({ rankOff: null, rankHigh: 1, momentum: null });
    // /v2/trending refuses places with a 400 (observed 30 Oct), so a rising place never spends a call on it.
    expect(move.calls.map((c) => c.method)).not.toContain("trending");
  });
});

describe("T3 anchors", () => {
  it("searchBrands returns brand refs and caches", async () => {
    const client = fixtureClient();
    const spy = vi.spyOn(client, "search");
    const deps = fixtureDeps({ client, cache: memoryCache() });
    const a = await searchBrands("blue bottle", deps);
    expect(a[0]).toMatchObject({ name: "Blue Bottle Coffee", type: "urn:entity:brand" });
    expect(a[0].entityId).toMatch(/^[0-9a-f-]{36}$/);
    await searchBrands("Blue Bottle", deps);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toMatchObject({ query: "blue bottle", types: "urn:entity:brand" });
  });

  it("blank queries and no matches return []", async () => {
    expect(await searchBrands("   ", fixtureDeps())).toEqual([]);
    expect(await searchBrands("zzzz-no-such-brand", fixtureDeps())).toEqual([]);
    const { client } = stubClient({ search: () => ({ success: true, results: [] }) });
    expect(await searchBrands("x", fixtureDeps({ client }))).toEqual([]);
  });

  it("resolveAnchors swaps sample placeholders for real entity ids and keeps real ones", async () => {
    const resolved = await resolveAnchors(chain, fixtureDeps());
    expect(resolved.map((r) => r.name)).toEqual(["Blue Bottle Coffee", "Aesop", "Muji"]);
    expect(resolved.every((r) => /^[0-9a-f-]{36}$/.test(r.entityId))).toBe(true);
    const keep = { anchors: [{ entityId: REAL, name: "Kept", type: "urn:entity:brand" }, { entityId: "sample-x", name: "Nope Not A Brand", type: "urn:entity:brand" }] };
    expect(await resolveAnchors(keep, fixtureDeps())).toEqual([keep.anchors[0]]);
  });
});

describe("T3 heatmap", () => {
  it("percentiles and zones", () => {
    const xs = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];
    expect(percentile(xs, 0.5)).toBeCloseTo(0.5);
    expect(percentile([], 0.5)).toBe(0);
    expect(zoneFor(0.9, xs)).toBe("strong");
    expect(zoneFor(0.1, xs)).toBe("weak");
    expect(zoneFor(0.5, xs)).toBe("moderate");
    expect(zoneFor(null, xs)).toBe("unknown");
  });

  it("scores every sample store from a polygon heatmap in fixture mode", async () => {
    const r = await heatmap(SAMPLE_STORES, chain, {}, fixtureDeps());
    expect(r.cells.length).toBeGreaterThan(20);
    expect(r.cells.every((c) => c.geohash.length >= 6)).toBe(true);
    expect(r.stores).toHaveLength(8);
    expect(new Set(r.stores.map((z) => z.zone)).size).toBeGreaterThanOrEqual(2);
    Evidence.parse(r.evidence[0]);
    expect(r.evidence[0].params["filter.location"]).toMatch(/^POLYGON\(\(-7/);
    expect(await heatmap([], chain, {}, fixtureDeps())).toEqual({ cells: [], stores: [], evidence: [] });
  });
});
