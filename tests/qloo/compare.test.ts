import { describe, expect, it } from "vitest";
import { CompareResult, Evidence, type BlockTag } from "@/contract";
import { UpstreamError } from "@/server/http/errors";
import { compareStores, diffTags } from "@/server/qloo/compare";
import { chain, entityEnv, fixtureClient, fixtureDeps, stubClient, store } from "./helpers";

const t = (id: string, lift: number, affinity = 0.6): BlockTag => ({ tagId: `urn:tag:ambience:qloo:${id}`, name: id, kind: "ambience", lift, affinity });

describe("T2 diffTags (our own tag-lift diff)", () => {
  it("splits tags into shared, only A and only B", () => {
    const a = [t("cozy", 0.3), t("artsy", 0.5), t("quiet", 0.0), t("lively", 0.4)];
    const b = [t("cozy", 0.32), t("quiet", 0.4), t("lively", 0.05), t("upscale", 0.3)];
    const d = diffTags(a, b);
    expect(d.shared.map((x) => x.name)).toEqual(["cozy"]);
    expect(d.onlyA.map((x) => x.name)).toEqual(["artsy", "lively"]); // by gap: 0.5 then 0.35
    expect(d.onlyB.map((x) => x.name)).toEqual(["quiet", "upscale"]);
  });

  it("shared tags carry the average of both sides", () => {
    const d = diffTags([t("cozy", 0.3, 0.8)], [t("cozy", 0.34, 0.6)]);
    expect(d.shared[0]).toMatchObject({ lift: 0.32, affinity: 0.7 });
  });

  it("a tag one store lacks counts as lift 0 there; weak tags are ignored; buckets are capped", () => {
    const d = diffTags([t("a", 0.5), t("weak", 0.03)], []);
    expect(d.onlyA.map((x) => x.name)).toEqual(["a"]);
    expect(d.onlyB).toEqual([]);
    const many = Array.from({ length: 20 }, (_, i) => t(`x${i}`, 0.5 - i * 0.01));
    expect(diffTags(many, []).onlyA).toHaveLength(8);
    expect(diffTags([], [])).toEqual({ shared: [], onlyA: [], onlyB: [] });
  });

  it("the same store compared with itself shares everything", () => {
    const a = [t("cozy", 0.3), t("artsy", 0.5)];
    const d = diffTags(a, a);
    expect(d.onlyA).toEqual([]);
    expect(d.shared).toHaveLength(2);
  });
});

describe("T3 compareStores in fixture mode", () => {
  it("shows what sets two neighbourhoods apart, with evidence behind it", async () => {
    const { result, evidence } = await compareStores(store("harlem"), store("upper-east-side"), chain, fixtureDeps());
    CompareResult.parse(result);
    evidence.forEach((e) => Evidence.parse(e));
    expect(result).toMatchObject({ a: "store_harlem", b: "store_upper-east-side" });
    const a = result.onlyA.map((x) => x.name).join();
    const b = result.onlyB.map((x) => x.name).join();
    expect(a).toMatch(/Soul food|Cornbread|Historic/);
    expect(b).toMatch(/Upscale|Classical|Quiet/);
    expect(result.onlyA.length).toBeGreaterThan(3);
    expect(result.onlyB.length).toBeGreaterThan(3);
    const ids = new Set(evidence.map((e) => e.id));
    expect(result.evidenceIds).toEqual(evidence.map((e) => e.id));
    expect(ids.size).toBe(evidence.length);
    expect(evidence.some((e) => e.endpoint === "/v2/analysis/compare")).toBe(true);
    expect(evidence.filter((e) => e.endpoint === "/v2/insights").length).toBeGreaterThanOrEqual(4);
  });

  it("is deterministic and symmetric in what it finds", async () => {
    const ab = await compareStores(store("astoria"), store("west-village"), chain, fixtureDeps());
    const again = await compareStores(store("astoria"), store("west-village"), chain, fixtureDeps());
    expect(again).toEqual(ab);
    const ba = await compareStores(store("west-village"), store("astoria"), chain, fixtureDeps());
    expect(ba.result.onlyA.map((x) => x.tagId)).toEqual(ab.result.onlyB.map((x) => x.tagId));
  });

  it("calls Qloo's compare with each store's top local place ids and the city", async () => {
    const client = fixtureClient();
    const seen: Record<string, unknown>[] = [];
    const orig = client.compare.bind(client);
    client.compare = (q) => { seen.push(q); return orig(q); };
    await compareStores(store("harlem"), store("astoria"), chain, fixtureDeps({ client }));
    expect(seen).toHaveLength(1);
    expect(String(seen[0]["a.signal.interests.entities"]).split(",")).toHaveLength(5);
    expect(String(seen[0]["b.signal.interests.entities"]).split(",")).toHaveLength(5);
    expect(seen[0]).toMatchObject({ "filter.type": "urn:entity:place", "filter.location.query": "New York", model: "descriptive" });
  });

  it("still answers when Qloo's compare is rate limited (evidence layer only)", async () => {
    const client = fixtureClient();
    client.compare = async () => { throw new UpstreamError("rate_limited", "qloo", "slow", { status: 429 }); };
    const { result, evidence } = await compareStores(store("harlem"), store("astoria"), chain, fixtureDeps({ client }));
    expect(result.onlyA.length).toBeGreaterThan(0);
    expect(evidence.some((e) => e.endpoint === "/v2/analysis/compare")).toBe(false);
  });

  it("still answers when Qloo's compare 403s or finds no places, and when profiles are empty", async () => {
    const forbid = fixtureClient();
    forbid.compare = async () => { throw new UpstreamError("unauthorized", "qloo", "no", { status: 403 }); };
    expect((await compareStores(store("harlem"), store("astoria"), chain, fixtureDeps({ client: forbid }))).result.onlyA.length).toBeGreaterThan(0);
    const { client } = stubClient({ insights: () => entityEnv([]) });
    const empty = await compareStores(store("harlem"), store("astoria"), chain, fixtureDeps({ client }));
    expect(empty.result).toMatchObject({ shared: [], onlyA: [], onlyB: [], evidenceIds: [] });
  });

  it("caches Qloo's compare per store pair, and marks cached evidence as cache", async () => {
    const client = fixtureClient();
    let n = 0;
    const orig = client.compare.bind(client);
    client.compare = (q) => { n++; return orig(q); };
    const deps = fixtureDeps({ client });
    await compareStores(store("harlem"), store("astoria"), chain, deps);
    const second = await compareStores(store("astoria"), store("harlem"), chain, deps);
    expect(n).toBe(1);
    expect(second.evidence.find((e) => e.endpoint === "/v2/analysis/compare")?.mode).toBe("cache");
  });
});
