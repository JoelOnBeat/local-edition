import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvCache } from "@/lib/env";
import { newToken } from "@/lib/ids";
import { SAMPLE_CHAIN_ID, SAMPLE_CITY, SAMPLE_STORES } from "../sample/chain";
import { DAILY_CREDIT_SLICE, TOTAL_CREDIT_CAP, TavilyBudgetError, createLedger, extractCredits } from "../tavily/budget";
import { repoCache } from "../tavily/cache";
import { setTokenFactory } from "../tokenfactory/client";
import { ensureDemoWorkspace } from "../session";
import { getRepo } from "../store";
import { liveAgentDeps, resetTavilyPrefetch } from "./live";
import { ToolMemory } from "./memory";
import { TOOL_BY_NAME } from "./tools";
import { fakeTavily, harness, WEEK_OF } from "./test-utils";

/**
 * H1: the build's and regenerate's Tavily door (`liveAgentDeps().tavily`) is the cached chain with the global ledger,
 * not a bare search. Live mode, a stubbed network, Lightning offline.
 */

const KEY = "tvly-TEST-NOT-A-REAL-KEY";
const saved = { ...process.env };
let calls: { path: string; body: Record<string, unknown>; auth: string | null }[];

function tavilyNetwork() {
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    calls.push({ path, body, auth: new Headers(init?.headers).get("authorization") });
    const json = (o: unknown) => new Response(JSON.stringify(o), { status: 200, headers: { "content-type": "application/json" } });
    if (path === "/search") {
      return json({ query: body.query, results: [{ title: "Ceramics opening at Salt Line", url: "https://events.example.com/ceramics", content: "Opening night, Thursday 5 November, 6 to 9pm.", score: 0.84 }] });
    }
    return json({ results: (body.urls as string[]).map((u) => ({ url: u, raw_content: `Page ${u}. Doors at 6pm.` })), failed_results: [] });
  }));
}

beforeEach(() => {
  Object.assign(process.env, { TAVILY_MODE: "live", TAVILY_API_KEY: KEY, TF_MODE: "fixture", QLOO_MODE: "fixture", STORE_DRIVER: "memory" });
  delete process.env.NEBIUS_API_KEY;
  resetEnvCache();
  setTokenFactory(undefined);
  resetTavilyPrefetch();
  tavilyNetwork();
});
afterEach(() => {
  vi.unstubAllGlobals();
  process.env = { ...saved };
  resetEnvCache();
  setTokenFactory(undefined);
});

const chainOf = (id: string) => ({ id, name: "Kettle & Kiln (sample chain)", category: "coffee" as const, brandVoice: ["Warm and plain-spoken."], anchors: [], city: { ...SAMPLE_CITY }, isSample: true });
const demoChain = chainOf(SAMPLE_CHAIN_ID);
const visitorChain = chainOf(`${SAMPLE_CHAIN_ID}~${newToken().slice(0, 6)}`);
const williamsburg = SAMPLE_STORES[0];

describe("the agent's Tavily port goes through the cached chain and the global ledger", () => {
  it("a build spends credits through the ledger (search, then one page read) and the counter shows them", async () => {
    const deps = await liveAgentDeps();
    const r = await deps.tavily.eventsThisWeek(williamsburg, demoChain, WEEK_OF);
    expect(calls.map((c) => c.path)).toEqual(["/search", "/extract"]);
    expect(calls.every((c) => c.auth === `Bearer ${KEY}`)).toBe(true);
    expect(r.evidence.length).toBeGreaterThan(0);
    expect(r.evidence.every((e) => e.source === "tavily")).toBe(true);
    const usage = await createLedger(await repoCache(), undefined, { stub: null }).usage();
    expect(usage).toMatchObject({ total: 2, today: 2, dailyCap: DAILY_CREDIT_SLICE, totalCap: TOTAL_CREDIT_CAP });
  });

  it("the first store of the demo's build prefetches all eight in one batch: 8 searches and ONE page read, and the others find theirs saved", async () => {
    process.env.TAVILY_MODE = "live";
    await ensureDemoWorkspace(await getRepo());
    const deps = await liveAgentDeps();
    // The daily slice covers a whole weekly build: eight searches plus one batched page read, with nothing refused.
    const first = await deps.tavily.eventsThisWeek(SAMPLE_STORES[0], demoChain, WEEK_OF);
    expect(first.evidence.length).toBeGreaterThan(0);
    expect(calls.filter((c) => c.path === "/search")).toHaveLength(SAMPLE_STORES.length);
    const extracts = calls.filter((c) => c.path === "/extract");
    expect(extracts).toHaveLength(1);
    const credits = SAMPLE_STORES.length + extractCredits((extracts[0].body.urls as string[]).length);
    expect(credits).toBeLessThanOrEqual(DAILY_CREDIT_SLICE);
    const after = calls.length;
    for (const s of SAMPLE_STORES.slice(1)) {
      const r = await deps.tavily.eventsThisWeek(s, demoChain, WEEK_OF);
      expect(r.evidence.length).toBeGreaterThan(0);
    }
    expect(calls).toHaveLength(after); // each of the other seven turns found its result saved
    expect(await createLedger(await repoCache(), undefined, { stub: null }).usage()).toMatchObject({ total: credits, today: credits });
  });

  it("prefetchWeek runs the whole batch up front and never throws; the stores' turns then read the saved results without a call", async () => {
    await ensureDemoWorkspace(await getRepo());
    const deps = await liveAgentDeps();
    await deps.tavily.prefetchWeek!(SAMPLE_STORES, demoChain);
    expect(calls.filter((c) => c.path === "/search")).toHaveLength(SAMPLE_STORES.length);
    expect(calls.filter((c) => c.path === "/extract")).toHaveLength(1);
    const after = calls.length;
    resetTavilyPrefetch(); // a different isolate: nothing memoised, only the saved results
    for (const s of SAMPLE_STORES) expect((await (await liveAgentDeps()).tavily.eventsThisWeek(s, demoChain, WEEK_OF)).evidence.length).toBeGreaterThan(0);
    expect(calls).toHaveLength(after);
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network down"); }));
    resetTavilyPrefetch();
    await expect(deps.tavily.prefetchWeek!([], demoChain)).resolves.toBeUndefined();
  });

  it("when part of the slice is already spent, the batch is capped there: fewer searches, no page read, and the stores left over use saved events", async () => {
    await ensureDemoWorkspace(await getRepo());
    const ledger = createLedger(await repoCache(), undefined, { stub: null });
    await ledger.reserve(DAILY_CREDIT_SLICE - 6); // six credits left today
    const deps = await liveAgentDeps();
    const first = await deps.tavily.eventsThisWeek(SAMPLE_STORES[0], demoChain, WEEK_OF);
    expect(first.evidence.length).toBeGreaterThan(0);
    expect(calls.filter((c) => c.path === "/search")).toHaveLength(6);
    expect(calls.filter((c) => c.path === "/extract")).toHaveLength(0);
    const after = calls.length;
    for (const s of SAMPLE_STORES.slice(1, 6)) await deps.tavily.eventsThisWeek(s, demoChain, WEEK_OF);
    expect(calls).toHaveLength(after);
    await expect(deps.tavily.eventsThisWeek(SAMPLE_STORES[7], demoChain, WEEK_OF)).rejects.toMatchObject({ code: "tavily_budget", reason: "daily" });
    expect(calls).toHaveLength(after);
    expect(await ledger.usage()).toMatchObject({ total: DAILY_CREDIT_SLICE, today: DAILY_CREDIT_SLICE });
  });

  it("every candidate cites its own evidence row, and only kept events become candidates", async () => {
    const deps = await liveAgentDeps();
    const r = await deps.tavily.eventsThisWeek(williamsburg, demoChain, WEEK_OF);
    const ids = new Set(r.evidence.map((e) => e.id));
    for (const item of r.items) {
      expect(item.evidenceIds).toHaveLength(1);
      expect(ids.has(item.evidenceIds[0])).toBe(true);
    }
  });

  it("a second build and a regenerate reuse this week's saved events: no call, no credit", async () => {
    const deps = await liveAgentDeps();
    await deps.tavily.eventsThisWeek(williamsburg, demoChain, WEEK_OF);
    const before = calls.length;
    await deps.tavily.eventsThisWeek(williamsburg, demoChain, WEEK_OF);
    expect(calls).toHaveLength(before);
    expect((await createLedger(await repoCache(), undefined, { stub: null }).usage()).total).toBe(2);
  });

  it("a visitor workspace reads the saved events and never spends: unsaved, it throws tavily_budget with the saved-events message", async () => {
    const deps = await liveAgentDeps();
    const visitorStore = { ...williamsburg, id: `${williamsburg.id}~abc123`, chainId: visitorChain.id };
    await expect(deps.tavily.eventsThisWeek(visitorStore, visitorChain, WEEK_OF)).rejects.toMatchObject({ status: 429, code: "tavily_budget", reason: "scope" });
    expect(calls).toHaveLength(0);
    // After the demo's build saved the week, the same visitor gets the events for free.
    await deps.tavily.eventsThisWeek(williamsburg, demoChain, WEEK_OF);
    const before = calls.length;
    const r = await deps.tavily.eventsThisWeek(visitorStore, visitorChain, WEEK_OF);
    expect(calls).toHaveLength(before);
    expect(r.evidence[0].mode).toBe("cache");
  });
});

describe("the events_this_week tool", () => {
  const ctxFor = async (tavily: Awaited<ReturnType<typeof harness>>["deps"]["tavily"]) => {
    const h = await harness();
    const sc = { chain: demoChain, store: williamsburg, menu: [], weekOf: WEEK_OF };
    return { sc, deps: { ...h.deps, tavily }, mem: new ToolMemory() };
  };

  it("says it is using this week's saved events when live search is not available, and carries on with no event", async () => {
    const refusing = { eventsThisWeek: async () => { throw new TavilyBudgetError("daily"); } };
    const out = await TOOL_BY_NAME.get("events_this_week")!.run(await ctxFor(refusing), {});
    expect(out.summary).toMatch(/saved events/);
    expect(out.evidenceIds).toEqual([]);
    expect(out.payload).toMatchObject({ events: [], note: expect.stringContaining("saved events") });
  });

  it("any other failure still surfaces as a failed tool", async () => {
    const broken = { eventsThisWeek: async () => { throw new Error("boom"); } };
    await expect(TOOL_BY_NAME.get("events_this_week")!.run(await ctxFor(broken), {})).rejects.toThrow("boom");
  });

  it("returns the port's events as before when there is no budget problem", async () => {
    const out = await TOOL_BY_NAME.get("events_this_week")!.run(await ctxFor(fakeTavily()), {});
    expect(out.summary).toMatch(/2 events/);
    expect(out.evidenceIds.length).toBeGreaterThan(0);
  });
});
