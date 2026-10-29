import { describe, expect, it, vi } from "vitest";
import { UpstreamError, upstreamHttpStatus } from "../http/errors";
import { MemoryRecorder } from "../http/recorder";
import { SAMPLE_STORES } from "../sample/chain";
import { eventsThisWeek, toEvents, type TavilyOptions } from "./search";
import { buildTavilyBody, TAVILY_SEARCH_URL, weekPhrase } from "./request";
import { tavilyModeFor } from "./mode";
import { TAVILY_FIXTURE_STORE_IDS, tavilyFixture } from "./fixtures";
import { TavilyResponse } from "./schema";
import type { Store } from "@/contract";

const KEY = "tvly-TEST-NOT-A-REAL-KEY";
const noSleep = async () => {};
const clock = () => new Date("2026-10-29T04:00:00.000Z");
const williamsburg = SAMPLE_STORES[0];
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

const liveEnv = { TAVILY_MODE: "live" as const, TAVILY_API_KEY: KEY };
const replayEnv = { TAVILY_MODE: "replay" as const, TAVILY_API_KEY: undefined };
const fixtureEnv = { TAVILY_MODE: "fixture" as const, TAVILY_API_KEY: undefined };

function opts(extra: Partial<TavilyOptions>): TavilyOptions {
  return { sleep: noSleep, random: () => 0.5, clock, recorder: new MemoryRecorder(), ...extra };
}

const oneResult = {
  query: "events this week near Bedford Ave & N 7th St, Williamsburg, New York",
  results: [
    { title: "  Stoop sale  ", url: "https://events.example.com/stoop", content: "Saturday 7 November.", score: 0.8 },
    { title: "Bad link", url: "javascript:alert(1)", content: "Not a listing.", score: 0.9 },
    { title: "", url: "https://events.example.com/untitled", content: "Untitled.", score: 0.6, published_date: "2026-10-30" },
  ],
};

describe("T2 request body", () => {
  it("builds the fixed search body from the neighbourhood, city and the week's dates", () => {
    expect(buildTavilyBody(williamsburg, "New York", clock())).toEqual({
      query: "Williamsburg New York events things to do this week October 26 to November 1 2026",
      topic: "general",
      time_range: "week",
      max_results: 6,
      search_depth: "basic",
    });
    expect(TAVILY_SEARCH_URL).toBe("https://api.tavily.com/search");
  });

  it("names the chain's city in the query and leaves the town out when there is none", () => {
    expect(buildTavilyBody(williamsburg, "London").query).toBe("Williamsburg London events things to do this week");
    expect(buildTavilyBody(williamsburg).query).toBe("Williamsburg events things to do this week");
  });

  it("falls back to the corner when the store has no name, and keeps the corner out otherwise", () => {
    expect(buildTavilyBody({ name: "", addressLabel: "Main St & 1st Ave" }).query).toBe("Main St & 1st Ave events things to do this week");
    expect(buildTavilyBody(williamsburg, "New York").query).not.toContain("Bedford");
  });

  it("dates the week Monday to Sunday, the same on every day of it and across a year end", () => {
    for (const day of ["2026-10-26T00:00:00Z", "2026-10-29T04:00:00Z", "2026-11-01T23:59:00Z"]) {
      expect(weekPhrase(new Date(day))).toBe("October 26 to November 1 2026");
    }
    expect(weekPhrase(new Date("2026-12-30T10:00:00Z"))).toBe("December 28 to January 3 2027");
  });

  it("posts the body with the key only in the Authorization header", async () => {
    const fetchImpl = vi.fn(async () => json({ query: "q", results: [] }));
    await eventsThisWeek(williamsburg, opts({ env: liveEnv, fetchImpl: fetchImpl as never }));
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(TAVILY_SEARCH_URL);
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${KEY}`);
    expect(JSON.parse(String(init.body))).toEqual(buildTavilyBody(williamsburg, undefined, clock()));
    expect(String(init.body)).not.toContain(KEY);
  });
});

describe("T3 live call, recording and replay", () => {
  it("records the live response without the key, then replays it without calling out", async () => {
    const recorder = new MemoryRecorder();
    const fetchImpl = vi.fn(async () => json(oneResult));
    const live = await eventsThisWeek(williamsburg, opts({ env: liveEnv, recorder, fetchImpl: fetchImpl as never }));
    expect(live.evidence.mode).toBe("live");
    expect(recorder.size()).toBe(1);
    expect(JSON.stringify(live.evidence)).not.toContain(KEY);

    const replayed = await eventsThisWeek(williamsburg, opts({ env: replayEnv, recorder, fetchImpl: fetchImpl as never }));
    expect(replayed.evidence.mode).toBe("replay");
    expect(replayed.events).toEqual(live.events);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("reports missing-key and does not call out when live has no key", async () => {
    const fetchImpl = vi.fn(async () => json(oneResult));
    const r = await eventsThisWeek(williamsburg, opts({ env: { TAVILY_MODE: "live", TAVILY_API_KEY: undefined }, fetchImpl: fetchImpl as never }));
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(r.evidence.mode).toBe("fixture"); // replay miss, then the sample fixture
    expect(tavilyModeFor({ TAVILY_MODE: "live", TAVILY_API_KEY: undefined })).toEqual({ run: "replay", status: "missing-key" });
  });
});

describe("T2 response parsing", () => {
  it("keeps http(s) links only, trims titles and maps published_date to date", () => {
    const events = toEvents(oneResult.results);
    expect(events).toEqual([
      { title: "Stoop sale", url: "https://events.example.com/stoop", date: undefined, snippet: "Saturday 7 November." },
      { title: "Untitled listing", url: "https://events.example.com/untitled", date: "2026-10-30", snippet: "Untitled." },
    ]);
  });

  it("clips long snippets to 280 characters with an ellipsis", () => {
    const [e] = toEvents([{ title: "Long", url: "https://events.example.com/l", content: "word ".repeat(120), score: 0.5 }]);
    expect(e.snippet.length).toBeLessThanOrEqual(280);
    expect(e.snippet.endsWith("…")).toBe(true);
  });

  it("writes evidence with the mean relevance, first url, the clock time and no key in params", async () => {
    const fetchImpl = vi.fn(async () => json(oneResult));
    const { events, evidence } = await eventsThisWeek(williamsburg, opts({ env: liveEnv, fetchImpl: fetchImpl as never }));
    expect(events).toHaveLength(2);
    expect(evidence).toMatchObject({
      source: "tavily",
      endpoint: "/search",
      entityIds: [],
      url: "https://events.example.com/stoop",
      fetchedAt: "2026-10-29T04:00:00.000Z",
      metrics: { relevance: 0.77 },
      summary: "Tavily found 2 event listings this week near Bedford Ave & N 7th St.",
    });
    expect(evidence.id).toMatch(/^ev_tv_/);
    expect(evidence.params).toEqual({
      query: buildTavilyBody(williamsburg, undefined, clock()).query,
      topic: "general",
      time_range: "week",
      max_results: "6",
      search_depth: "basic",
    });
  });

  it("rejects a malformed JSON body and a wrong response shape", async () => {
    await expect(
      eventsThisWeek(williamsburg, opts({ env: liveEnv, fetchImpl: vi.fn(async () => new Response("<html>", { status: 200 })) as never })),
    ).rejects.toMatchObject({ code: "bad_json" });
    await expect(
      eventsThisWeek(williamsburg, opts({ env: liveEnv, fetchImpl: vi.fn(async () => json({ results: "nope" })) as never })),
    ).rejects.toMatchObject({ code: "invalid_response" });
  });
});

describe("T2 empty results", () => {
  it("returns no events, evidence that says so, and no relevance metric", async () => {
    const fetchImpl = vi.fn(async () => json({ query: "q", results: [] }));
    const { events, evidence } = await eventsThisWeek(williamsburg, opts({ env: liveEnv, fetchImpl: fetchImpl as never }));
    expect(events).toEqual([]);
    expect(evidence.summary).toBe("Tavily found no event listings this week near Bedford Ave & N 7th St.");
    expect(evidence.metrics).toEqual({});
    expect(evidence.url).toBeUndefined();
  });
});

describe("T4 failure paths", () => {
  it("maps repeated 429 to rate_limited (HTTP 429) after the retries, without the key in the message", async () => {
    const sleep = vi.fn(async () => {});
    const fetchImpl = vi.fn(async () => new Response("", { status: 429 }));
    const err = await eventsThisWeek(williamsburg, opts({ env: liveEnv, sleep, fetchImpl: fetchImpl as never })).catch((e) => e);
    expect(err).toBeInstanceOf(UpstreamError);
    expect(err).toMatchObject({ code: "rate_limited", provider: "tavily", status: 429 });
    expect(upstreamHttpStatus(err)).toBe(429);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(err.message).not.toContain(KEY);
  });

  it("maps 401 to unauthorized and never exposes it as the client's own auth failure (502)", async () => {
    const fetchImpl = vi.fn(async () => new Response("", { status: 401 }));
    const err = await eventsThisWeek(williamsburg, opts({ env: liveEnv, fetchImpl: fetchImpl as never })).catch((e) => e);
    expect(err).toMatchObject({ code: "unauthorized", status: 401 });
    expect(upstreamHttpStatus(err)).toBe(502);
    expect(fetchImpl).toHaveBeenCalledTimes(1); // no retry on auth failure
    expect(err.message).not.toContain(KEY);
  });
});

describe("T3 fixtures", () => {
  it("serves the sample fixture on a replay miss, and an empty result for a store with none", async () => {
    const sample = await eventsThisWeek(williamsburg, opts({ env: replayEnv }));
    expect(sample.evidence.mode).toBe("fixture");
    expect(sample.events).toHaveLength(4);

    const added: Store = { ...williamsburg, id: "store_added_by_visitor", name: "Nowhere", addressLabel: "Main St & 1st Ave" };
    const none = await eventsThisWeek(added, opts({ env: fixtureEnv }));
    expect(none.events).toEqual([]);
    expect(none.evidence.summary).toContain("no event listings");
  });

  it("is deterministic: two fixture runs agree on events and evidence apart from the id", async () => {
    const a = await eventsThisWeek(williamsburg, opts({ env: fixtureEnv }));
    const b = await eventsThisWeek(williamsburg, opts({ env: fixtureEnv }));
    expect(a.events).toEqual(b.events);
    expect({ ...a.evidence, id: "x" }).toEqual({ ...b.evidence, id: "x" });
  });

  it("has a valid fixture for every sample store, answering that store's own query", () => {
    expect(TAVILY_FIXTURE_STORE_IDS.sort()).toEqual(SAMPLE_STORES.map((s) => s.id).sort());
    for (const store of SAMPLE_STORES) {
      const fixture = tavilyFixture(store.id, buildTavilyBody(store, "New York").query);
      expect(TavilyResponse.parse(fixture).query).toBe(buildTavilyBody(store, "New York").query);
      expect(fixture.results.length).toBeGreaterThanOrEqual(3);
    }
  });

  it("dates every listing in the week of Mon 2 Nov 2026 with the right weekday", () => {
    const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    for (const store of SAMPLE_STORES) {
      for (const r of tavilyFixture(store.id, "").results) {
        const matches = [...r.content.matchAll(/(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday) (\d{1,2}) November/g)];
        expect(matches.length, r.title).toBeGreaterThan(0);
        for (const [, weekday, day] of matches) {
          const n = Number(day);
          expect(n).toBeGreaterThanOrEqual(2);
          expect(n).toBeLessThanOrEqual(8);
          expect(weekdays[new Date(Date.UTC(2026, 10, n)).getUTCDay()]).toBe(weekday);
        }
      }
    }
  });
});

describe("fixtures for visitor-workspace store ids", () => {
  it("resolves a remapped store id to the sample store's listings", () => {
    const res = tavilyFixture("store_williamsburg~abc123", "events this week");
    expect(res.results.length).toBeGreaterThan(0);
  });
});
