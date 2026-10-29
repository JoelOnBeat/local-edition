import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { UpstreamError } from "./errors";
import { fetchJson } from "./fetch-json";
import { MemoryRecorder, canonicalUrl, recordKey } from "./recorder";
import { PricedSpendMeter } from "./spend";

const noSleep = async () => {};
const ok = (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), { status: 200, ...init });
const base = { provider: "qloo", sleep: noSleep, random: () => 0.5 };

describe("T2 recorder keys", () => {
  it("ignores secret params, param order and hash, but not real params or body", async () => {
    const a = await recordKey({ method: "GET", url: "https://x.test/v2?take=2&query=1&api_key=SECRET" });
    const b = await recordKey({ method: "get", url: "https://x.test/v2?query=1&take=2&apiKey=OTHER#frag" });
    const c = await recordKey({ method: "GET", url: "https://x.test/v2?query=1&take=3" });
    const d = await recordKey({ method: "POST", url: "https://x.test/v2?query=1&take=2", body: { z: 1, a: 2 } });
    const e = await recordKey({ method: "POST", url: "https://x.test/v2?query=1&take=2", body: { a: 2, z: 1 } });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(d).toBe(e);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(canonicalUrl("https://x.test/p?token=abc&q=hi")).toBe("https://x.test/p?q=hi");
  });
});

describe("T3 fetchJson record and replay", () => {
  it("records a live response, then replays it without calling fetch", async () => {
    const recorder = new MemoryRecorder();
    const fetchImpl = vi.fn(async () => ok({ hello: "world" }));
    const url = "https://x.test/v2?q=cafe&api_key=SECRET";
    const live = await fetchJson({ ...base, url, mode: "live", recorder, fetchImpl: fetchImpl as never });
    expect(live).toMatchObject({ mode: "live", data: { hello: "world" } });
    expect(recorder.size()).toBe(1);
    const replay = await fetchJson({ ...base, url: "https://x.test/v2?q=cafe&api_key=OTHER", mode: "replay", recorder, fetchImpl: fetchImpl as never });
    expect(replay).toMatchObject({ mode: "replay", data: { hello: "world" } });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const entry = await recorder.get("qloo", await recordKey({ method: "GET", url }));
    expect(JSON.stringify(entry)).not.toContain("SECRET");
  });

  it("falls back to the fixture on a replay miss, and errors without one", async () => {
    const recorder = new MemoryRecorder();
    const r = await fetchJson({ ...base, url: "https://x.test/miss", mode: "replay", recorder, fixture: () => ({ n: 1 }) });
    expect(r).toMatchObject({ mode: "fixture", data: { n: 1 } });
    await expect(fetchJson({ ...base, url: "https://x.test/miss", mode: "replay", recorder })).rejects.toMatchObject({ code: "replay_miss" });
    await expect(fetchJson({ ...base, url: "https://x.test/miss", mode: "fixture", recorder })).rejects.toMatchObject({ code: "no_fixture" });
  });
});

describe("T4 fetchJson failure paths", () => {
  it("retries 429 then 503 and succeeds, honouring Retry-After", async () => {
    const sleep = vi.fn<(ms: number) => Promise<void>>(async () => {});
    const seq = [new Response("", { status: 429, headers: { "retry-after": "2" } }), new Response("", { status: 503 }), ok({ done: true })];
    const fetchImpl = vi.fn(async () => seq.shift()!);
    const r = await fetchJson({ ...base, sleep, url: "https://x.test/a", recorder: new MemoryRecorder(), fetchImpl: fetchImpl as never });
    expect(r.data).toEqual({ done: true });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls[0][0]).toBe(2000);
    expect(sleep.mock.calls[1][0]).toBe(500); // 250 * 2 * (0.5 + 0.5)
  });

  it("gives up after 3 retries with a typed error and no upstream text", async () => {
    const fetchImpl = vi.fn(async () => new Response("SECRET upstream stack trace", { status: 500 }));
    const err = await fetchJson({ ...base, url: "https://x.test/a", recorder: new MemoryRecorder(), fetchImpl: fetchImpl as never }).catch((e) => e);
    expect(err).toBeInstanceOf(UpstreamError);
    expect(err).toMatchObject({ code: "upstream_5xx", status: 500, retryable: true });
    expect(err.message).not.toContain("SECRET");
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    const limited = new Response("", { status: 429 });
    await expect(fetchJson({ ...base, retries: 0, url: "https://x.test/a", recorder: new MemoryRecorder(), fetchImpl: (async () => limited) as never })).rejects.toMatchObject({ code: "rate_limited" });
  });

  it("does not retry 4xx; maps 401 to unauthorized", async () => {
    const f = vi.fn(async () => new Response("{}", { status: 401 }));
    await expect(fetchJson({ ...base, url: "https://x.test/a", recorder: new MemoryRecorder(), fetchImpl: f as never })).rejects.toMatchObject({ code: "unauthorized" });
    const g = vi.fn(async () => new Response("{}", { status: 404 }));
    await expect(fetchJson({ ...base, url: "https://x.test/a", recorder: new MemoryRecorder(), fetchImpl: g as never })).rejects.toMatchObject({ code: "upstream_4xx" });
    expect(f).toHaveBeenCalledTimes(1);
    expect(g).toHaveBeenCalledTimes(1);
  });

  it("times out with a typed error", async () => {
    const fetchImpl = (_u: string, init: RequestInit) =>
      new Promise<Response>((_res, rej) => init.signal!.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError"))));
    await expect(fetchJson({ ...base, timeoutMs: 20, url: "https://x.test/slow", recorder: new MemoryRecorder(), fetchImpl: fetchImpl as never })).rejects.toMatchObject({ code: "timeout" });
  });

  it("retries network errors then reports network", async () => {
    const f = vi.fn(async () => { throw new TypeError("fetch failed"); });
    await expect(fetchJson({ ...base, retries: 2, url: "https://x.test/a", recorder: new MemoryRecorder(), fetchImpl: f as never })).rejects.toMatchObject({ code: "network" });
    expect(f).toHaveBeenCalledTimes(3);
  });

  it("rejects non-JSON bodies and schema mismatches without recording them", async () => {
    const recorder = new MemoryRecorder();
    await expect(fetchJson({ ...base, url: "https://x.test/a", recorder, fetchImpl: (async () => new Response("<html>", { status: 200 })) as never })).rejects.toMatchObject({ code: "bad_json" });
    await expect(fetchJson({ ...base, url: "https://x.test/b", recorder, schema: z.object({ n: z.number() }), fetchImpl: (async () => ok({ n: "x" })) as never })).rejects.toMatchObject({ code: "invalid_response" });
    expect(recorder.size()).toBe(0);
  });

  it("enforces the spend cap before a live call and meters usage after", async () => {
    const meter = new PricedSpendMeter(1.51, { m: { inPerMTok: 1000, outPerMTok: 1000 } });
    const fetchImpl = vi.fn(async () => ok({ usage: { i: 1000, o: 500 } }));
    const call = () => fetchJson({
      ...base, provider: "tokenfactory", url: "https://x.test/chat", method: "POST", body: { model: "m", max_tokens: 10, messages: [{ role: "user", content: "hi" }], p: Math.random() },
      recorder: new MemoryRecorder(), meter, fetchImpl: fetchImpl as never,
      usage: (d: { usage: { i: number; o: number } }) => ({ model: "m", inTokens: d.usage.i, outTokens: d.usage.o }),
    });
    await call();
    expect((await meter.totals()).usd).toBeCloseTo(1.5, 5);
    await expect(call()).rejects.toMatchObject({ code: "spend_cap" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("T3 FileRecorder", () => {
  it("writes one JSON file per response under <root>/<provider>/ and reads it back", async () => {
    const { mkdtemp, readdir, readFile, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { FileRecorder } = await import("./recorder");
    const root = await mkdtemp(join(tmpdir(), "le-rec-"));
    try {
      const rec = new FileRecorder(root);
      const url = "https://x.test/v2?q=1&api_key=SECRET";
      const r = await fetchJson({ ...base, url, mode: "live", recorder: rec, fetchImpl: (async () => ok({ a: 1 })) as never });
      expect(r.mode).toBe("live");
      const files = await readdir(join(root, "qloo"));
      expect(files).toHaveLength(1);
      expect(await readFile(join(root, "qloo", files[0]), "utf8")).not.toContain("SECRET");
      const back = await fetchJson({ ...base, url, mode: "replay", recorder: new FileRecorder(root) });
      expect(back).toMatchObject({ mode: "replay", data: { a: 1 } });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
