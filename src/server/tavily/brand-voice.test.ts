import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BrandVoiceResponse } from "@/contract";
import { POST } from "@/app/api/chain/brand-voice/route";
import { resetEnvCache } from "@/lib/env";
import { MemoryRecorder } from "../http/recorder";
import { setTokenFactory } from "../tokenfactory/client";
import { chatBody, jsonRes, scriptedTf } from "../tokenfactory/test-utils";
import { DAILY_CREDIT_SLICE, createLedger } from "./budget";
import { generateBrandVoice, quoteOnPage, verifyLines } from "./brand-voice";
import { memoryCache, repoCache } from "./cache";
import { CLOCK, KEY, liveEnv, noSleep, tavilyFetch } from "./test-utils";

const CHAIN = { id: "chain_a", name: "Kettle & Kiln" };
const PAGES = [
  { url: "https://kettleandkiln.com/about", raw_content: "We keep things plain and warm here. Come in, say hello, and we will remember your order. No fuss, no hype, just good coffee made by people who live nearby." },
  { url: "https://kettleandkiln.com/visit", raw_content: "Find us on the corner of Bedford and North Seventh. Dogs are welcome on the patio and the stoop is always free to sit on." },
];
const GOOD = {
  lines: [
    { text: "Plain and warm, like someone who remembers your order.", page: 1, quote: "Come in, say hello, and we will remember your order" },
    { text: "No hype: good coffee, made by neighbours.", page: 1, quote: "No fuss, no hype, just good coffee made by people who live nearby" },
    { text: "Open-handed about the block: dogs and the stoop welcome.", page: 2, quote: "Dogs are welcome on the patio and the stoop is always free to sit on" },
  ],
};

function setup(answer: unknown = GOOD) {
  const net = tavilyFetch({ crawl: (body) => ({ base_url: body.url, results: PAGES }) });
  const tf = scriptedTf(() => jsonRes(chatBody(JSON.stringify(answer))));
  const cache = memoryCache();
  const opts = { env: liveEnv, fetchImpl: net.fetchImpl, tf: tf.tf, cache, ledger: createLedger(cache, CLOCK, { stub: null }), workspaceId: "demo", clock: CLOCK, sleep: noSleep, recorder: new MemoryRecorder() };
  return { net, tf, cache, opts };
}

describe("T3 brand voice from one Tavily crawl", () => {
  it("crawls 10 pages (basic) once, writes lines backed by real quotes, and cites each page", async () => {
    const { net, opts, tf } = setup();
    const r = await generateBrandVoice(CHAIN, "https://kettleandkiln.com/", opts);
    expect(net.count("crawl")).toBe(1);
    expect(net.calls[0].body).toEqual({ url: "https://kettleandkiln.com/", limit: 10, max_depth: 1, extract_depth: "basic", format: "text" });
    expect(net.calls[0].authorization).toBe(`Bearer ${KEY}`);
    expect(r.lines).toHaveLength(3);
    expect(BrandVoiceResponse.safeParse({ lines: r.lines, sources: r.sources }).success).toBe(true);
    const tavily = r.sources.filter((s) => s.source === "tavily");
    expect(tavily.map((s) => s.url)).toEqual(["https://kettleandkiln.com/about", "https://kettleandkiln.com/visit"]);
    expect(tavily[0].summary).toContain("remember your order");
    expect(r.sources.at(-1)).toMatchObject({ source: "tokenfactory", endpoint: "/chat/completions" });
    expect(JSON.stringify(r)).not.toContain(KEY);
    expect((tf.calls[0].body.messages as { content: string }[])[0].content).toMatch(/untrusted/);
    expect(await opts.ledger.usage()).toMatchObject({ today: 3, total: 3 });
  });

  it("serves the saved result on the next call for the same chain and address: one crawl", async () => {
    const { net, opts, tf } = setup();
    await generateBrandVoice(CHAIN, "https://kettleandkiln.com/", opts);
    const again = await generateBrandVoice(CHAIN, "https://kettleandkiln.com/", opts);
    expect(again.cached).toBe(true);
    expect(again.lines).toHaveLength(3);
    expect(net.count("crawl")).toBe(1);
    expect(tf.calls).toHaveLength(1);
    const other = await generateBrandVoice({ id: "chain_b", name: "Other" }, "https://other.example.com/", opts);
    expect(other.cached).toBe(false);
  });

  it("keys the saved voice by chain AND address: another address is crawled, never answered with the old lines", async () => {
    const { net, opts } = setup();
    const first = await generateBrandVoice(CHAIN, "https://kettleandkiln.com/", opts);
    const second = await generateBrandVoice(CHAIN, "https://kettleandkiln.example.org/", opts);
    expect(second.cached).toBe(false);
    expect(net.count("crawl")).toBe(2);
    expect(first.sources[0].params.url).toBe("https://kettleandkiln.com");
    expect(second.sources[0].params.url).toBe("https://kettleandkiln.example.org");
  });

  it("remembers a failed crawl for 24 hours, so a retry does not buy another 3 credits, then tries again", async () => {
    let now = Date.parse("2026-10-29T04:00:00Z");
    const cache = memoryCache(() => now);
    let status = 422;
    let calls = 0;
    const fetchImpl = (async () => { calls++; return new Response(JSON.stringify({ detail: "no" }), { status, headers: { "content-type": "application/json" } }); }) as unknown as typeof fetch;
    const opts = { ...setup().opts, cache, fetchImpl, ledger: createLedger(cache, CLOCK, { stub: null }) };
    await expect(generateBrandVoice(CHAIN, "https://down.example.com/", opts)).rejects.toMatchObject({ status: 422, code: "crawl_failed" });
    await expect(generateBrandVoice(CHAIN, "https://down.example.com/", opts)).rejects.toMatchObject({ status: 422, code: "crawl_failed" });
    expect(calls).toBe(1);
    // Another address is its own key.
    await expect(generateBrandVoice(CHAIN, "https://other-down.example.com/", opts)).rejects.toMatchObject({ code: "crawl_failed" });
    expect(calls).toBe(2);
    now += 24 * 3600 * 1000 + 1000;
    status = 422;
    await expect(generateBrandVoice(CHAIN, "https://down.example.com/", opts)).rejects.toMatchObject({ code: "crawl_failed" });
    expect(calls).toBe(3);
  });

  it("remembers an empty crawl (no_site_text) too, and a transient 503 is not remembered", async () => {
    const { opts } = setup();
    const empty = tavilyFetch({ crawl: () => ({ results: [{ url: "https://x.com/", raw_content: "ok" }] }) });
    const o = { ...opts, fetchImpl: empty.fetchImpl };
    await expect(generateBrandVoice(CHAIN, "https://x.com/", o)).rejects.toMatchObject({ code: "no_site_text" });
    await expect(generateBrandVoice(CHAIN, "https://x.com/", o)).rejects.toMatchObject({ code: "no_site_text" });
    expect(empty.count("crawl")).toBe(1);

    let calls = 0;
    const flaky = (async () => { calls++; return new Response("no", { status: 503 }); }) as unknown as typeof fetch;
    await expect(generateBrandVoice(CHAIN, "https://y.com/", { ...opts, fetchImpl: flaky })).rejects.toBeTruthy();
    const first = calls;
    await expect(generateBrandVoice(CHAIN, "https://y.com/", { ...opts, fetchImpl: flaky })).rejects.toBeTruthy();
    expect(calls).toBeGreaterThan(first);
  });

  it("puts only http(s) page addresses into the evidence rows", async () => {
    const pages = [
      { url: "javascript:alert(1)//about", raw_content: PAGES[0].raw_content },
      { url: "https://kettleandkiln.com/visit", raw_content: PAGES[1].raw_content },
    ];
    const net = tavilyFetch({ crawl: (body) => ({ base_url: body.url, results: pages }) });
    const { opts } = setup();
    const r = await generateBrandVoice(CHAIN, "https://kettleandkiln.com/", { ...opts, fetchImpl: net.fetchImpl });
    const tavily = r.sources.filter((s) => s.source === "tavily");
    expect(tavily.length).toBeGreaterThan(0);
    expect(tavily.every((s) => s.url === undefined || /^https?:\/\//.test(s.url))).toBe(true);
    expect(tavily.find((s) => s.summary.includes("remember your order"))!.url).toBeUndefined();
  });

  it("drops lines whose quote is not on the page and refuses with 422 when none survive", async () => {
    const mixed = { lines: [GOOD.lines[0], { text: "Fabulous award-winning roast.", page: 1, quote: "We were voted best roaster in the whole city" }] };
    const r = await generateBrandVoice(CHAIN, "https://kettleandkiln.com/", setup(mixed).opts);
    expect(r.lines).toEqual([GOOD.lines[0].text]);
    const bad = { lines: [{ text: "Invented voice line here.", page: 2, quote: "Nothing like this appears on the page at all" }] };
    await expect(generateBrandVoice(CHAIN, "https://kettleandkiln.com/", setup(bad).opts)).rejects.toMatchObject({ status: 422, code: "brand_voice_unsupported" });
  });

  it("refuses private or malformed addresses before any credit or call", async () => {
    const { net, opts } = setup();
    await expect(generateBrandVoice(CHAIN, "http://169.254.169.254/", opts)).rejects.toMatchObject({ status: 400, code: "private_url" });
    await expect(generateBrandVoice(CHAIN, "ftp://x.com/", opts)).rejects.toMatchObject({ status: 400, code: "invalid_url" });
    expect(net.calls).toHaveLength(0);
    expect(await opts.ledger.usage()).toMatchObject({ today: 0, total: 0 });
  });

  it("answers 429 tavily_budget when today's slice has under 3 credits left, with no call out", async () => {
    const { net, opts, cache } = setup();
    const ledger = createLedger(cache, CLOCK, { stub: null });
    await ledger.reserve(DAILY_CREDIT_SLICE - 2);
    await expect(generateBrandVoice(CHAIN, "https://kettleandkiln.com/", { ...opts, ledger })).rejects.toMatchObject({ status: 429, code: "tavily_budget" });
    expect(net.calls).toHaveLength(0);
  });

  it("allows the chain-setup crawl live only in the demo workspace: a visitor's gets 429 tavily_budget and no call", async () => {
    const { net, opts } = setup();
    await expect(generateBrandVoice(CHAIN, "https://kettleandkiln.com/", { ...opts, workspaceId: "ws_visitor" })).rejects.toMatchObject({ status: 429, code: "tavily_budget" });
    expect(net.calls).toHaveLength(0);
    expect(await opts.ledger.usage()).toMatchObject({ total: 0 });
  });

  it("answers 422 no_site_text when the crawl returns nothing readable", async () => {
    const { opts } = setup();
    const empty = tavilyFetch({ crawl: () => ({ results: [{ url: "https://x.com/", raw_content: "ok" }] }) });
    await expect(generateBrandVoice(CHAIN, "https://x.com/", { ...opts, fetchImpl: empty.fetchImpl })).rejects.toMatchObject({ status: 422, code: "no_site_text" });
  });
});

describe("T2 line verification", () => {
  const pages = [{ url: "https://a.com/", text: "We keep things plain and warm. Say hello." }];
  it("matches quotes loosely on case and punctuation, but requires real words", () => {
    expect(quoteOnPage("we keep things PLAIN and warm", pages[0])).toBe(true);
    expect(quoteOnPage("plain warm", pages[0])).toBe(false);
    expect(quoteOnPage("anything at all here friend", undefined)).toBe(false);
  });

  it("drops links, markup, health claims, duplicates and lines under 8 characters", () => {
    const q = "We keep things plain and warm";
    const line = (text: string) => ({ text, page: 1, quote: q });
    const kept = verifyLines(
      { lines: [line("Visit https://spam.example now"), line("<b>Bold voice line</b>"), line("Gluten free and healthy tone"), line("Short"), line("Plain and warm."), line("plain and warm")] },
      pages,
    );
    expect(kept.map((l) => l.text)).toEqual(["Plain and warm."]);
  });
});

describe("T4 POST /api/chain/brand-voice", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    process.env.TAVILY_MODE = "fixture";
    process.env.TF_MODE = "fixture";
    delete process.env.TAVILY_API_KEY;
    delete process.env.NEBIUS_API_KEY;
    resetEnvCache();
    setTokenFactory(undefined);
  });
  afterEach(() => {
    process.env = { ...saved };
    resetEnvCache();
    setTokenFactory(undefined);
  });
  const post = (body: unknown, raw = false) =>
    POST(new Request("http://localhost/api/chain/brand-voice", { method: "POST", headers: { "content-type": "application/json" }, body: raw ? String(body) : JSON.stringify(body) }));

  it("runs offline from fixtures, labelled as a sample, and matches the contract", async () => {
    const res = await post({ url: "https://kettleandkiln.com/" });
    expect(res.status).toBe(200);
    const body = BrandVoiceResponse.parse(await res.json());
    expect(body.lines.length).toBeGreaterThan(0);
    expect(body.sources.find((s) => s.source === "tokenfactory")!.summary).toMatch(/Sample mode/);
    expect(res.headers.get("x-le-cache")).toBe("fresh");
  });

  it("rejects a missing url, a private url and a body that is not JSON with {error, code}", async () => {
    expect(await (await post({})).json()).toMatchObject({ code: "invalid_input" });
    const priv = await post({ url: "http://localhost:3000/" });
    expect(priv.status).toBe(400);
    expect(await priv.json()).toMatchObject({ code: "private_url", error: expect.any(String) });
    const bad = await post("{nope", true);
    expect(bad.status).toBe(400);
  });

  it("answers 429 tavily_budget with the saved-events message for a visitor workspace in live mode, with no credit spent", async () => {
    process.env.TAVILY_MODE = "live";
    process.env.TAVILY_API_KEY = KEY;
    resetEnvCache();
    const mint = await post({});
    const cookie = mint.headers.get("set-cookie")!.split(";")[0];
    const id = decodeURIComponent(cookie.split("=")[1]);
    expect(id).toMatch(/^ws_/);
    const res = await POST(new Request("http://localhost/api/chain/brand-voice", {
      method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ url: "https://kettleandkiln.com/" }),
    }));
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ code: "tavily_budget", error: expect.stringContaining("saved events") });
    expect((await createLedger(await repoCache(), undefined, { stub: null }).usage()).total).toBe(0);
  });
});
