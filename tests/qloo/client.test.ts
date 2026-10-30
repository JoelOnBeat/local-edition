import { beforeEach, describe, expect, it, vi } from "vitest";
import { Evidence } from "@/contract";
import { UpstreamError } from "@/server/http/errors";
import { MemoryRecorder } from "@/server/http/recorder";
import { resetEnvCache } from "@/lib/env";
import { QlooClient, buildUrl, createQlooClient, isForbidden, normalizeParams, qlooProviderStatus, resolveQlooMode } from "@/server/qloo/client";
import { buildEvidence } from "@/server/qloo/evidence";
import { artistQuery } from "@/server/qloo/artists";
import { placeQuery } from "@/server/qloo/places";
import { pointWkt } from "@/server/qloo/geo";
import { NOW, noSleep, ok, store, testGate } from "./helpers";

const KEY = "qk_test_SECRET_0123456789";
const live = (fetchImpl: typeof fetch, recorder = new MemoryRecorder()) =>
  new QlooClient({ mode: "live", status: "live", apiKey: KEY, fetchImpl, sleep: noSleep, random: () => 0.5, recorder, retries: 1, gate: async () => testGate() });

describe("T2 request building", () => {
  it("sends GET to the hackathon host with X-Api-Key in a header and the key nowhere in the URL", async () => {
    const fetchImpl = vi.fn(async () => ok({ success: true, results: { entities: [] } }));
    const call = await live(fetchImpl as never).insights({ "filter.type": "urn:entity:place", take: 5 });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url.startsWith("https://hackathon.api.qloo.com/v2/insights?")).toBe(true);
    expect(url).toContain("filter.type=urn:entity:place");
    expect(url).not.toContain(KEY);
    expect((init.headers as Record<string, string>)["X-Api-Key"]).toBe(KEY);
    expect(init.method).toBe("GET");
    expect(call.params).toEqual({ "filter.type": "urn:entity:place", take: "5" });
  });

  it("writes WKT points longitude first and trims coordinate noise", () => {
    const s = store("williamsburg");
    expect(pointWkt(s)).toBe("POINT(-73.9573 40.7175)");
    expect(pointWkt({ lat: 40.717512345678, lon: -73.957312345678 })).toBe("POINT(-73.95731 40.71751)");
    const q = normalizeParams(placeQuery(s, {}));
    expect(q["filter.location"]).toBe("POINT(-73.9573 40.7175)");
    expect(q["signal.location"]).toBeUndefined();
  });

  it("passes the radius in whole metres and clamps it to 50-5000", () => {
    const s = store("harlem");
    expect(placeQuery(s, { radiusM: 1234.6 })["filter.location.radius"]).toBe(1235);
    expect(placeQuery(s, { radiusM: 1 })["filter.location.radius"]).toBe(50);
    expect(placeQuery(s, { radiusM: 99_999 })["filter.location.radius"]).toBe(5000);
    expect(placeQuery(s, {})["filter.location.radius"]).toBe(1200);
  });

  it("clamps take to Qloo's 50 and popularity percentiles to 0-1, with min never above max", () => {
    const s = store("astoria");
    expect(placeQuery(s, { take: 500 }).take).toBe(50);
    expect(placeQuery(s, { take: 0 }).take).toBe(1);
    const q = artistQuery(s, [], { popularityMax: 4, popularityMin: 9 });
    expect(q["filter.popularity.max"]).toBe(1);
    expect(q["filter.popularity.min"]).toBe(1);
    const d = artistQuery(s, [], {});
    expect([d["filter.popularity.min"], d["filter.popularity.max"], d["bias.trends"]]).toEqual([0.2, 0.7, "low"]);
    expect(artistQuery(s, [], { popularityMax: 0.5, popularityMin: 0.9 })["filter.popularity.min"]).toBe(0.5);
  });

  it("only sends real entity ids as signals (sample placeholders are dropped) and joins lists with commas", () => {
    const real = "1ce71098-a0fd-4319-888e-45e785880a34";
    const q = normalizeParams(placeQuery(store("harlem"), { anchorIds: ["sample-aesop", real], tags: ["urn:tag:genre:place:park", "urn:tag:genre:place:museum"], excludeIds: ["nope"] }));
    expect(q["signal.interests.entities"]).toBe(real);
    expect(q["filter.tags"]).toBe("urn:tag:genre:place:park,urn:tag:genre:place:museum");
    expect(q["filter.exclude.entities"]).toBeUndefined();
    expect(q["feature.explainability"]).toBe("true");
  });

  it("normalizeParams drops undefined and empty values; buildUrl keeps urns and commas readable", () => {
    const p = normalizeParams({ a: "1", b: undefined, c: [], d: ["x", "y"], e: false, f: 0 });
    expect(p).toEqual({ a: "1", d: "x,y", e: "false", f: "0" });
    expect(buildUrl("https://h.test", "/s", { q: "Blue Bottle & Co", t: "urn:a:b,urn:c" })).toBe("https://h.test/s?q=Blue%20Bottle%20%26%20Co&t=urn:a:b,urn:c");
  });
});

describe("T4 error mapping", () => {
  const status = (code: number, headers: Record<string, string> = {}) => vi.fn(async () => new Response("{}", { status: code, headers }));
  const run = (f: ReturnType<typeof status>) => live(f as never).insights({ "filter.type": "urn:tag" });

  it("401 -> unauthorized (bad key or wrong host), not forbidden", async () => {
    const err = await run(status(401)).catch((e) => e);
    expect(err).toBeInstanceOf(UpstreamError);
    expect(err).toMatchObject({ code: "unauthorized", status: 401 });
    expect(isForbidden(err)).toBe(false);
  });

  it("403 -> unauthorized with status 403, flagged as forbidden with a message that does not blame the key", async () => {
    const err = await run(status(403)).catch((e) => e);
    expect(err).toMatchObject({ code: "unauthorized", status: 403 });
    expect(isForbidden(err)).toBe(true);
    expect(err.message).toContain("not enabled");
  });

  it("429 retries once then maps to rate_limited; 5xx to upstream_5xx; 400 to upstream_4xx", async () => {
    const f429 = status(429, { "retry-after": "0" });
    await expect(run(f429)).rejects.toMatchObject({ code: "rate_limited", status: 429 });
    expect(f429).toHaveBeenCalledTimes(2);
    await expect(run(status(503))).rejects.toMatchObject({ code: "upstream_5xx" });
    await expect(run(status(400))).rejects.toMatchObject({ code: "upstream_4xx", status: 400 });
  });

  it("maps a non-JSON body to bad_json and an array body to invalid_response, and never leaks the body", async () => {
    const html = vi.fn(async () => new Response("<html>secret upstream page</html>", { status: 200 }));
    const err = await run(html as never).catch((e) => e);
    expect(err).toMatchObject({ code: "bad_json" });
    expect(err.message).not.toContain("secret upstream page");
    const arr = vi.fn(async () => ok([1, 2, 3]));
    await expect(run(arr as never)).rejects.toMatchObject({ code: "invalid_response" });
    const odd = vi.fn(async () => ok({ results: { entities: ["not-an-object"] } }));
    await expect(run(odd as never)).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("times out as `timeout`", async () => {
    const hang = vi.fn((_u: string, init: RequestInit) => new Promise<Response>((_r, rej) => init.signal?.addEventListener("abort", () => rej(new Error("aborted")))));
    const client = new QlooClient({ mode: "live", status: "live", apiKey: KEY, fetchImpl: hang as never, timeoutMs: 10, retries: 0, sleep: noSleep, recorder: new MemoryRecorder(), gate: async () => testGate() });
    await expect(client.insights({ "filter.type": "urn:tag" })).rejects.toMatchObject({ code: "timeout" });
  });
});

describe("T2 modes and key handling", () => {
  beforeEach(() => resetEnvCache());

  it("live without a key falls back to replay and reports missing-key", () => {
    expect(resolveQlooMode({ QLOO_MODE: "live", QLOO_API_KEY: undefined })).toEqual({ mode: "replay", status: "missing-key" });
    expect(resolveQlooMode({ QLOO_MODE: "live", QLOO_API_KEY: "k" })).toEqual({ mode: "live", status: "live" });
    expect(resolveQlooMode({ QLOO_MODE: "replay", QLOO_API_KEY: undefined })).toEqual({ mode: "replay", status: "replay" });
    expect(resolveQlooMode({ QLOO_MODE: "fixture", QLOO_API_KEY: undefined })).toEqual({ mode: "fixture", status: "fixture" });
  });

  it("createQlooClient and qlooProviderStatus read the parsed env", () => {
    const env = { QLOO_MODE: "live", QLOO_API_KEY: undefined } as never;
    expect(createQlooClient({ env }).status).toBe("missing-key");
    expect(qlooProviderStatus(env)).toBe("missing-key");
  });

  it("a replay miss falls back to the synthetic fixture and says so", async () => {
    const client = new QlooClient({ mode: "replay", status: "replay", recorder: new MemoryRecorder(), sleep: noSleep });
    const call = await client.search({ query: "Muji", types: "urn:entity:brand" });
    expect(call.mode).toBe("fixture");
    expect(JSON.stringify(call.data)).toContain("Muji");
  });

  it("the API key never reaches a recording, a recording key, or Evidence", async () => {
    const recorder = new MemoryRecorder();
    const body = { success: true, results: { tags: [{ tag_id: "urn:tag:ambience:qloo:cozy", name: "Cozy", query: { affinity: 0.7 } }] } };
    const fetchImpl = vi.fn(async () => ok(body));
    const client = live(fetchImpl as never, recorder);
    const call = await client.insights({ "filter.type": "urn:tag", "signal.location": "POINT(-73.9573 40.7175)", "filter.tag.types": "urn:tag:ambience:qloo" });
    const ev = buildEvidence({ scope: "store_x", call, summary: "Cozy at the block.", now: NOW });
    Evidence.parse(ev);
    expect(recorder.size()).toBe(1);
    const dump = JSON.stringify([...(recorder as unknown as { entries: Map<string, unknown> }).entries]);
    expect(dump).not.toContain(KEY);
    expect(JSON.stringify(ev)).not.toContain(KEY);
    expect(JSON.stringify(call)).not.toContain(KEY);
    // The same request with a different key hits the same recording.
    const other = new QlooClient({ mode: "replay", status: "replay", apiKey: "a-different-key", recorder, sleep: noSleep });
    const replay = await other.insights({ "filter.type": "urn:tag", "signal.location": "POINT(-73.9573 40.7175)", "filter.tag.types": "urn:tag:ambience:qloo" });
    expect(replay.mode).toBe("replay");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("Evidence builder strips secret-looking params and non-finite metrics", () => {
    const ev = buildEvidence({
      scope: "s", call: { path: "/v2/insights", params: { "filter.type": "urn:tag", api_key: "x", token: "y" }, mode: "fixture" },
      summary: " ", metrics: { affinity: Number.NaN, lift: 0.3 }, now: NOW,
    });
    expect(ev.params).toEqual({ "filter.type": "urn:tag" });
    expect(ev.metrics).toEqual({ lift: 0.3 });
    expect(ev.summary).toBe("Qloo result");
    expect(ev.endpoint).toBe("/v2/insights");
  });
});
