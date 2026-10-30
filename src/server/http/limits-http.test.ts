import { describe, expect, it, vi } from "vitest";
import { routes } from "@/contract";
import { BODY_LIMITS, readLimited, withRoute } from "./api";
import { UpstreamError } from "./errors";
import { fetchJson } from "./fetch-json";
import { MemoryRecorder, NullRecorder, canonicalUrl, type Recorder } from "./recorder";

const req = (url: string, init?: RequestInit) => new Request(`http://t.test${url}`, init);
const noSleep = async () => {};
const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const base = { provider: "qloo", sleep: noSleep, random: () => 0.5, url: "https://x.test/v2?take=1" };

/** A request whose body streams `n` bytes with no Content-Length (chunked). */
function chunked(n: number, chunk = 64 * 1024): Request {
  let sent = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(c) {
      if (sent >= n) return c.close();
      const size = Math.min(chunk, n - sent);
      sent += size;
      c.enqueue(new Uint8Array(size).fill(97));
    },
  });
  return new Request("http://t.test/x", { method: "POST", body, duplex: "half" } as RequestInit);
}

describe("M6 body size limits (413 before parsing)", () => {
  it("rejects a declared Content-Length over the limit without reading the body", async () => {
    const body = new ReadableStream<Uint8Array>({ pull() {} });
    const r = new Request("http://t.test/x", { method: "PUT", body, headers: { "content-length": String(BODY_LIMITS.json + 1), "content-type": "application/json" }, duplex: "half" } as RequestInit);
    const h = withRoute(routes.putMenu, () => []);
    const res = await h(r);
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ code: "payload_too_large" });
    expect(r.bodyUsed).toBe(false);
    expect(body.locked).toBe(false);
  });

  it("cuts off a chunked body (no Content-Length) the moment it passes the limit", async () => {
    await expect(readLimited(chunked(BODY_LIMITS.json * 4), BODY_LIMITS.json)).rejects.toMatchObject({ status: 413, code: "payload_too_large" });
    const exact = await readLimited(chunked(1000), 1000);
    expect(exact.byteLength).toBe(1000);
  });

  it("applies per body kind: csv 128 KB, json 256 KB, multipart 5 MB + overhead, and a per-route override", async () => {
    expect(BODY_LIMITS.csv).toBeLessThan(BODY_LIMITS.json);
    expect(BODY_LIMITS.multipart).toBeGreaterThan(5 * 1024 * 1024);
    const csv = withRoute(routes.importStores, () => []);
    expect((await csv(chunked(BODY_LIMITS.csv + 10))).status).toBe(413);
    const small = withRoute(routes.createStore, () => ({}), { maxBodyBytes: 20 });
    const res = await small(req("/x", { method: "POST", body: JSON.stringify({ name: "Harlem", addressLabel: "125th St & Lenox Ave", lat: 40.8, lon: -73.9 }) }));
    expect(res.status).toBe(413);
  });

  it("rejects a malformed Content-Length and a body the route did not declare", async () => {
    const h = withRoute(routes.putMenu, () => []);
    const bad = await h(req("/x", { method: "PUT", body: "[]", headers: { "content-length": "abc" } }));
    expect(bad.status).toBeLessThan(500);
    expect(bad.status).toBeGreaterThanOrEqual(400);
  });

  it("runs `authenticate` on the raw bytes before parsing or validating anything", async () => {
    const seen: string[] = [];
    const h = withRoute(routes.createStore, () => ({}), {
      authenticate: ({ bytes }) => {
        seen.push(new TextDecoder().decode(bytes));
        throw Object.assign(new Error("no"), { name: "HttpError", status: 401, code: "bad_signature" });
      },
    });
    const res = await h(req("/x", { method: "POST", body: "{not json at all" }));
    expect(seen).toEqual(["{not json at all"]);
    expect(res.status).not.toBe(400); // the malformed JSON was never parsed
  });

  it("schema limits: ids <= 64, build storeIds <= 50, menu <= 300 items, name/description caps", () => {
    const parse = (id: keyof typeof routes, input: unknown) => routes[id].request.safeParse(input).success;
    const item = (i: number) => ({ id: `m${i}`, name: "Flat white", category: "coffee", price: 4.5, currency: "USD", description: null, source: "manual" });
    expect(parse("putMenu", { body: Array.from({ length: 300 }, (_, i) => item(i)) })).toBe(true);
    expect(parse("putMenu", { body: Array.from({ length: 301 }, (_, i) => item(i)) })).toBe(false);
    expect(parse("putMenu", { body: [{ ...item(1), name: "x".repeat(81) }] })).toBe(false);
    expect(parse("putMenu", { body: [{ ...item(1), description: "x".repeat(241) }] })).toBe(false);
    expect(parse("putMenu", { body: [{ ...item(1), id: "x".repeat(65) }] })).toBe(false);
    expect(parse("buildEditions", { body: { storeIds: Array.from({ length: 51 }, (_, i) => `s${i}`) } })).toBe(false);
    expect(parse("buildEditions", { body: { storeIds: Array.from({ length: 50 }, (_, i) => `s${i}`) } })).toBe(true);
    expect(parse("deleteStore", { params: { id: "x".repeat(65) } })).toBe(false);
    expect(parse("putChain", { body: { name: "x".repeat(81), brandVoice: ["warm"], anchors: [{ entityId: "a", name: "A", type: "urn:entity:brand" }] } })).toBe(false);
  });

  it("schema limits: item patch strings <= 600 and flavourTags <= 6", () => {
    const patch = (p: object) => routes.patchItem.request.safeParse({ params: { id: "e", itemId: "i" }, body: { action: "edit", patch: p } }).success;
    expect(patch({ description: "x".repeat(600) })).toBe(true);
    expect(patch({ description: "x".repeat(601) })).toBe(false);
    expect(patch({ staffLine: "x".repeat(601) })).toBe(false);
    expect(patch({ flavourTags: ["a", "b", "c", "d", "e", "f"] })).toBe(true);
    expect(patch({ flavourTags: ["a", "b", "c", "d", "e", "f", "g"] })).toBe(false);
  });
});

describe("LOW fetchJson hardening", () => {
  it("never follows redirects (a custom auth header must not reach another origin)", async () => {
    const fetchImpl = vi.fn(async (_u: string, init?: RequestInit) => {
      expect(init?.redirect).toBe("manual"); // workerd rejects "error"; manual + the 3xx refusal below never follows
      return ok({ a: 1 });
    });
    await fetchJson({ ...base, mode: "live", recorder: new MemoryRecorder(), fetchImpl: fetchImpl as never });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("refuses a redirect answer instead of following it", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 302, headers: { location: "https://example.org/" } }));
    await expect(fetchJson({ ...base, mode: "live", retries: 0, recorder: new MemoryRecorder(), fetchImpl: fetchImpl as never })).rejects.toMatchObject({ code: "upstream_4xx" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("times out a body that trickles in after the headers arrived", async () => {
    const fetchImpl = (async (_u: string, init?: RequestInit) => {
      const signal = init?.signal as AbortSignal;
      const body = new ReadableStream<Uint8Array>({
        start(c) {
          signal.addEventListener("abort", () => c.error(new DOMException("aborted", "AbortError")));
        },
      });
      return new Response(body, { status: 200 });
    }) as never;
    const started = Date.now();
    await expect(fetchJson({ ...base, mode: "live", timeoutMs: 40, retries: 0, recorder: new MemoryRecorder(), fetchImpl })).rejects.toMatchObject({ code: "timeout" });
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("a timeout settles the reservation at the estimate", async () => {
    const { PricedSpendMeter } = await import("./spend");
    const meter = new PricedSpendMeter(5, { m: { inPerMTok: 1, outPerMTok: 1 } });
    const fetchImpl = ((_u: string, init?: RequestInit) =>
      new Promise((_r, reject) => (init?.signal as AbortSignal).addEventListener("abort", () => reject(new DOMException("a", "AbortError"))))) as never;
    await expect(fetchJson({
      ...base, provider: "tokenfactory", method: "POST", body: { model: "m", max_tokens: 1_000_000, messages: [] },
      mode: "live", timeoutMs: 20, retries: 0, recorder: new MemoryRecorder(), meter, fetchImpl,
    })).rejects.toMatchObject({ code: "timeout" });
    expect((await meter.totals()).usd).toBeCloseTo(1, 1);
  });

  it("flags a 400 that names response_format, and only that, with a hint (no upstream body in the message)", async () => {
    const mk = (text: string) => (async () => new Response(text, { status: 400 })) as never;
    const fmt = await fetchJson({ ...base, mode: "live", recorder: new MemoryRecorder(), fetchImpl: mk('{"error":{"message":"response_format json_schema is not supported"}}') }).catch((e: unknown) => e);
    expect(fmt).toBeInstanceOf(UpstreamError);
    expect(fmt).toMatchObject({ code: "upstream_4xx", hint: "response_format_unsupported" });
    expect(String((fmt as Error).message)).not.toContain("json_schema");
    const other = await fetchJson({ ...base, mode: "live", recorder: new MemoryRecorder(), fetchImpl: mk('{"error":"image too large"}') }).catch((e: unknown) => e);
    expect((other as UpstreamError).hint).toBeUndefined();
  });
});

describe("LOW recorder hygiene", () => {
  it("keeps only allowlisted params: credential-looking names the old denylist missed are dropped", () => {
    const url = canonicalUrl("https://x.test/p?access_key=A&subscription-key=B&sessionid=C&filter.type=urn%3Atag&signal.location=POINT&take=3&q=hi");
    expect(url).not.toMatch(/access_key|subscription|sessionid/);
    expect(url).toContain("filter.type=");
    expect(url).toContain("signal.location=");
    expect(url).toContain("take=3");
  });

  it("strips user:pass@ and the hash from recorded URLs", () => {
    const url = canonicalUrl("https://alice:hunter2@x.test/p?q=1#frag");
    expect(url).toBe("https://x.test/p?q=1");
    expect(url).not.toContain("hunter2");
  });

  it("production recorder keeps nothing (no unbounded memory of live responses)", async () => {
    const rec: Recorder = new NullRecorder();
    await rec.put({ key: "k", provider: "qloo", method: "GET", url: "u", status: 200, body: { v: new Array(4096).fill(0.1) }, recordedAt: "now" });
    expect(await rec.get("qloo", "k")).toBeUndefined();
    const prev = process.env.NODE_ENV;
    (process.env as Record<string, string>).NODE_ENV = "production";
    try {
      const { getRecorder, setRecorder } = await import("./recorder");
      setRecorder(undefined);
      expect(getRecorder()).toBeInstanceOf(NullRecorder);
    } finally {
      (process.env as Record<string, string>).NODE_ENV = prev ?? "test";
      (await import("./recorder")).setRecorder(new MemoryRecorder());
    }
  });
});
