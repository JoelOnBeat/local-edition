import { vi } from "vitest";
import type { Chain, Store } from "@/contract";
import { chatBody, jsonRes, scriptedTf } from "../tokenfactory/test-utils";
import type { TriageOut } from "./triage";

/** Test kit for the Tavily chain: a scripted Tavily fetch and a scripted Lightning. Tests only. */

export const KEY = "tvly-TEST-NOT-A-REAL-KEY";
export const CLOCK = () => new Date("2026-10-29T04:00:00.000Z");
export const liveEnv = { TAVILY_MODE: "live" as const, TAVILY_API_KEY: KEY };
export const replayEnv = { TAVILY_MODE: "replay" as const, TAVILY_API_KEY: undefined };
export const fixtureEnv = { TAVILY_MODE: "fixture" as const, TAVILY_API_KEY: undefined };
export const noSleep = async () => {};

export const CHAIN: Pick<Chain, "name" | "category" | "brandVoice" | "city"> = {
  name: "Kettle & Kiln (sample chain)",
  category: "coffee",
  brandVoice: ["Warm and plain-spoken.", "Neighbourly first."],
  city: { name: "New York", lat: 40.73, lon: -73.99 },
};

export const store = (slug: string, name: string): Store => ({
  id: `store_${slug}`, chainId: "chain_kettle_kiln", name, addressLabel: `${name} corner`, lat: 40.7, lon: -73.9, colorIndex: 1,
});
export const WILLIAMSBURG = store("williamsburg", "Williamsburg");
export const ASTORIA = store("astoria", "Astoria");

export interface SeenCall {
  url: string;
  path: string;
  body: Record<string, unknown>;
  authorization: string | null;
}

type Responder = (body: Record<string, unknown>, n: number) => unknown;

/** A fetch that answers Tavily's /search, /extract and /crawl from the given responders. */
export function tavilyFetch(r: { search?: Responder; extract?: Responder; crawl?: Responder }) {
  const calls: SeenCall[] = [];
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    const path = new URL(String(url)).pathname;
    calls.push({ url: String(url), path, body, authorization: new Headers(init?.headers).get("authorization") });
    const handler = r[path.slice(1) as "search" | "extract" | "crawl"];
    if (!handler) return jsonRes({ error: "no handler" }, 500);
    return jsonRes(handler(body, calls.filter((c) => c.path === path).length));
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls, count: (name: string) => calls.filter((c) => c.path === `/${name}`).length };
}

export const listing = (title: string, content: string, score = 0.8, url = `https://events.example.com/${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`) => ({
  title, url, content, score,
});

export interface ListedEvent {
  title: string;
  venue?: string | null;
  date?: string | null;
  result: number;
  detail?: string | null;
}

/** One listed event per search result: what Lightning returns when every result is itself an event. */
export const listEach = (results: { title: string; content: string }[]): ListedEvent[] =>
  results.map((r, i) => ({ title: r.title, result: i + 1, detail: r.content }));

/**
 * Lightning that answers the event-listing call with `list` (a 500 when omitted, to exercise the fallback) and each
 * triage by the candidate's title (the prompt carries `title: <title>`; listed events carry it in their snippet).
 */
export function triageTf(byTitle: Record<string, Partial<TriageOut>>, o: { mode?: "live" | "replay" | "fixture"; list?: (prompt: string) => ListedEvent[] } = {}) {
  const base: TriageOut = { is_event: true, title: null, venue: "The Hall", date: "2026-11-04", near_store: true, on_brand: true, reason: "A neighbourhood event." };
  return scriptedTf((_url, body) => {
    const messages = body.messages as { role: string; content: string }[];
    const user = messages.find((m) => m.role === "user")?.content ?? "";
    if (user.includes("<result n=")) return o.list ? jsonRes(chatBody(JSON.stringify({ events: o.list(user) }))) : jsonRes({ error: "no list" }, 500);
    const title = user.match(/^title: (.*)$/m)?.[1] ?? "";
    const answer = byTitle[title];
    if (!answer) return jsonRes({ error: "unexpected" }, 500);
    return jsonRes(chatBody(JSON.stringify({ ...base, ...answer })));
  }, { mode: o.mode ?? "live" });
}
