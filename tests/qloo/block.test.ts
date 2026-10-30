import { describe, expect, it, vi } from "vitest";
import { BlockProfile, Evidence, type BlockTag } from "@/contract";
import { SAMPLE_STORES } from "@/server/sample/chain";
import { UpstreamError } from "@/server/http/errors";
import { blockProfile, computeBlock, computeLifts, pickProfileTags, tagShares } from "@/server/qloo/block";
import { memoryCache } from "@/server/qloo/deps";
import { chain, entityEnv, fixtureClient, fixtureDeps, NOW, stubClient, store, tagEnv } from "./helpers";

const tag = (id: string, kind: BlockTag["kind"], lift: number, affinity = 0.5): BlockTag => ({ tagId: id, name: id, kind, lift, affinity });

describe("T2 lift maths", () => {
  const local = [
    { tagId: "urn:tag:ambience:qloo:cozy", name: "Cozy", affinity: 0.82 },
    { tagId: "urn:tag:ambience:qloo:quiet", name: "Quiet", affinity: 0.4 },
    { tagId: "urn:tag:ambience:qloo:lively", name: "Lively", affinity: 0.7 },
  ];

  it("lift = store affinity minus the city baseline affinity for the same tag", () => {
    const base = [
      { tagId: "urn:tag:ambience:qloo:cozy", name: "Cozy", affinity: 0.5 },
      { tagId: "urn:tag:ambience:qloo:quiet", name: "Quiet", affinity: 0.55 },
      { tagId: "urn:tag:ambience:qloo:lively", name: "Lively", affinity: 0.3 },
    ];
    const t = computeLifts(local, base);
    expect(t.map((x) => x.lift)).toEqual([0.32, -0.15, 0.4]);
    expect(t[0]).toMatchObject({ kind: "ambience", affinity: 0.82 });
  });

  it("a tag missing from the baseline list gets the baseline's lowest affinity", () => {
    const t = computeLifts(local, [{ tagId: "urn:tag:ambience:qloo:cozy", name: "Cozy", affinity: 0.5 }]);
    expect(t[1].lift).toBeCloseTo(0.4 - 0.5, 5); // floor = min baseline = 0.5
    const t2 = computeLifts(local, [{ tagId: "other", name: "Other", affinity: 0.2 }, { tagId: "x", name: "X", affinity: 0.6 }]);
    expect(t2[0].lift).toBeCloseTo(0.82 - 0.2, 5);
  });

  it("with no baseline at all it ranks within the block (median)", () => {
    const t = computeLifts(local, null);
    expect(t.map((x) => x.lift)).toEqual([0.12, -0.3, 0]);
    expect(computeLifts([], null)).toEqual([]);
  });

  it("kind comes from the tag namespace", () => {
    const t = computeLifts(
      [
        { tagId: "urn:tag:cuisine:qloo:greek", name: "Greek", affinity: 0.9 },
        { tagId: "urn:tag:specialty_dish:place:baklava", name: "Baklava", affinity: 0.9 },
        { tagId: "urn:tag:genre:music:jazz", name: "Jazz", affinity: 0.9 },
        { tagId: "urn:tag:good_for:qloo:groups", name: "Groups", affinity: 0.9 },
        { tagId: "urn:tag:neighborhood_characteristic:qloo:historic", name: "Historic", affinity: 0.9 },
      ],
      null,
    );
    expect(t.map((x) => x.kind)).toEqual(["cuisine", "flavour", "music", "activity", "other"]);
  });
});

describe("T2 profile selection", () => {
  it("sorts by lift, caps at 12 and at 4 per kind", () => {
    const many = [
      ...Array.from({ length: 8 }, (_, i) => tag(`a${i}`, "ambience", 0.9 - i * 0.01)),
      ...Array.from({ length: 6 }, (_, i) => tag(`f${i}`, "flavour", 0.5 - i * 0.01)),
      ...Array.from({ length: 6 }, (_, i) => tag(`m${i}`, "music", 0.3 - i * 0.01)),
      tag("c0", "cuisine", 0.1),
    ];
    const out = pickProfileTags(many);
    expect(out).toHaveLength(12);
    expect(out.filter((t) => t.kind === "ambience")).toHaveLength(4);
    expect(out.filter((t) => t.kind === "flavour")).toHaveLength(4);
    expect(out.map((t) => t.lift)).toEqual([...out.map((t) => t.lift)].sort((a, b) => b - a));
  });

  it("drops non-positive lifts unless fewer than three tags over-index", () => {
    expect(pickProfileTags([tag("a", "ambience", 0.3), tag("b", "music", 0.2), tag("c", "other", 0.1), tag("d", "other", -0.4)]).map((t) => t.tagId)).toEqual(["a", "b", "c"]);
    expect(pickProfileTags([tag("a", "ambience", -0.1), tag("b", "music", -0.2)]).map((t) => t.tagId)).toEqual(["a", "b"]);
    expect(pickProfileTags([])).toEqual([]);
  });

  it("tagShares weights by place affinity, ignores place genres and single-place tags when asked", () => {
    const place = (aff: number, ...ids: string[]) => ({ query: { affinity: aff }, tags: ids.map((id) => ({ id, name: id })) });
    const shares = tagShares(
      [
        place(0.8, "urn:tag:cuisine:qloo:greek", "urn:tag:genre:place:restaurant"),
        place(0.2, "urn:tag:cuisine:qloo:greek", "urn:tag:cuisine:qloo:italian"),
      ],
      true,
    );
    expect(shares).toEqual({ "urn:tag:cuisine:qloo:greek": 1 });
    expect(Object.keys(tagShares([place(0.5, "urn:tag:cuisine:qloo:italian")]))).toEqual(["urn:tag:cuisine:qloo:italian"]);
  });
});

describe("T3 blockProfile in fixture mode (all eight sample stores)", () => {
  it("returns a valid, distinct, evidence-backed profile per neighbourhood", async () => {
    const deps = fixtureDeps();
    const tops = new Map<string, string>();
    for (const s of SAMPLE_STORES) {
      const { profile, evidence } = await blockProfile(s, chain, deps);
      BlockProfile.parse(profile);
      evidence.forEach((e) => Evidence.parse(e));
      expect(profile.storeId).toBe(s.id);
      expect(profile.tags.length).toBeGreaterThanOrEqual(8);
      expect(profile.tags.length).toBeLessThanOrEqual(12);
      expect(profile.evidenceIds).toEqual(evidence.map((e) => e.id));
      expect(new Set(evidence.map((e) => e.id)).size).toBe(evidence.length);
      expect(evidence.every((e) => e.mode === "fixture" && e.source === "qloo" && e.endpoint === "/v2/insights")).toBe(true);
      expect(evidence.every((e) => e.params["signal.location"]?.startsWith("POINT(-7"))).toBe(true);
      expect(profile.tags[0].lift).toBeGreaterThan(0.2);
      tops.set(s.name, profile.tags.slice(0, 3).map((t) => t.name).join("|"));
    }
    expect(new Set(tops.values()).size).toBe(8);
    expect(tops.get("Astoria")).toMatch(/Baklava|Greek/);
    expect(tops.get("Harlem")).toMatch(/Soul|Cornbread/);
    expect(tops.get("Upper East Side")).toMatch(/Classical|Upscale/);
  });

  it("is deterministic for equal inputs, including evidence ids", async () => {
    const a = await blockProfile(store("park-slope"), chain, fixtureDeps());
    const b = await blockProfile(store("park-slope"), chain, fixtureDeps());
    expect(b).toEqual(a);
  });

  it("an added store gets its nearest neighbour's character", async () => {
    const near = { ...store("harlem"), id: "store_new", lat: store("harlem").lat + 0.001, lon: store("harlem").lon - 0.001 };
    const { profile } = await blockProfile(near, chain, fixtureDeps());
    const harlem = await blockProfile(store("harlem"), chain, fixtureDeps());
    const names = (p: { tags: BlockTag[] }) => new Set(p.tags.slice(0, 6).map((t) => t.name));
    const overlap = [...names(profile)].filter((n) => names(harlem.profile).has(n));
    expect(overlap.length).toBeGreaterThanOrEqual(4);
  });

  it("caches the city baseline: one baseline call per tag type across stores", async () => {
    const client = fixtureClient();
    const spy = vi.spyOn(client, "insights");
    const deps = fixtureDeps({ client, cache: memoryCache() });
    await computeBlock(store("williamsburg"), chain, deps);
    const first = spy.mock.calls.length;
    expect(first).toBe(14); // 7 tag types: local + baseline
    const params = spy.mock.calls.map(([q]) => q as Record<string, unknown>);
    expect(params.filter((q) => q["signal.location.query"] === "New York City")).toHaveLength(7);
    expect(params.filter((q) => String(q["signal.location"]).startsWith("POINT(-73.9573 40.7175)"))).toHaveLength(7);
    await computeBlock(store("astoria"), chain, deps);
    expect(spy.mock.calls.length - first).toBe(7);
  });
});

describe("T4 empty, forbidden and failing Qloo", () => {
  it("empty results everywhere give an empty profile, not an error", async () => {
    const { client } = stubClient({ insights: () => ({ success: true, results: { entities: [], tags: [] } }) });
    const { profile, evidence } = await blockProfile(store("harlem"), chain, fixtureDeps({ client }));
    expect(BlockProfile.parse(profile).tags).toEqual([]);
    expect(evidence).toEqual([]);
    expect(profile.evidenceIds).toEqual([]);
  });

  it("403 on urn:tag falls back to tags carried by nearby places, with lift against a city place baseline", async () => {
    const place = (aff: number, tags: [string, string][]) => ({ entity_id: crypto.randomUUID(), name: "p", query: { affinity: aff }, tags: tags.map(([id, name]) => ({ id, name, type: id.split(":").slice(0, 3).join(":") })) });
    const greek: [string, string] = ["urn:tag:cuisine:qloo:greek", "Greek"];
    const cafe: [string, string] = ["urn:tag:ambience:qloo:cozy", "Cozy"];
    const local = entityEnv([place(0.9, [greek, cafe]), place(0.8, [greek]), place(0.7, [cafe]), place(0.6, [greek])]);
    const city = entityEnv([place(0.5, [greek]), place(0.5, [cafe]), place(0.5, [cafe]), place(0.5, [cafe]), place(0.5, [])]);
    const { client, calls } = stubClient({
      insights: (q) => {
        if (q["filter.type"] === "urn:tag") throw new UpstreamError("unauthorized", "qloo", "no", { status: 403 });
        return q["filter.location.query"] ? city : local;
      },
    });
    const { profile, evidence, allTags } = await computeBlock(store("astoria"), chain, fixtureDeps({ client }));
    expect(calls.some((c) => c.query["filter.location"] === "POINT(-73.9217 40.7677)" && c.query["filter.location.radius"] === 800)).toBe(true);
    const greekTag = allTags.find((t) => t.tagId === greek[0])!;
    expect(greekTag.kind).toBe("cuisine");
    // local share (0.9+0.8+0.6)/(3.0) = 0.767 ; city share 0.5/2.5 = 0.2
    expect(greekTag.affinity).toBeCloseTo(0.767, 2);
    expect(greekTag.lift).toBeCloseTo(0.567, 2);
    expect(profile.tags[0].tagId).toBe(greek[0]);
    expect(evidence).toHaveLength(1);
    expect(evidence[0].summary).toContain("within 800 m");
  });

  it("surfaces rate limiting when every call fails", async () => {
    const { client } = stubClient({ insights: () => { throw new UpstreamError("rate_limited", "qloo", "slow down", { status: 429 }); } });
    await expect(blockProfile(store("harlem"), chain, fixtureDeps({ client }))).rejects.toMatchObject({ code: "rate_limited" });
  });

  it("keeps going when a few tag types fail", async () => {
    let n = 0;
    const inner = fixtureClient();
    const { client } = stubClient({
      insights: async (q) => {
        if (String(q["filter.tag.types"]).includes("cuisine") && !q["signal.location.query"] && n++ === 0) throw new UpstreamError("timeout", "qloo", "slow");
        return (await inner.insights(q as never)).data;
      },
    });
    const { profile, evidence } = await blockProfile(store("harlem"), chain, fixtureDeps({ client }));
    expect(profile.tags.length).toBeGreaterThan(5);
    expect(evidence).toHaveLength(6);
  });

  it("tag helper envelopes in tests parse like Qloo's", () => {
    expect(tagEnv([{ id: "urn:tag:x:y", name: "Y", affinity: 0.5 }]).results.tags[0].tag_id).toBe("urn:tag:x:y");
    expect(NOW.toISOString()).toBe("2026-10-29T10:00:00.000Z");
  });
});
