import type { AgentEvent, BlockProfile, Evidence, GuardrailResult, Store } from "@/contract";
import { sampleSeed } from "../sample/chain";
import { createMemoryRepo } from "../store/memory";
import type { Repo } from "../store/repo";
import { AGENT_MODEL, COPY_MODEL, type AgentDeps, type ChatRequest, type ChatResponse, type ChatToolCall, type QlooPort } from "./ports";
import { fnv, makeEvidence } from "./util";

/** Test doubles for the agent's ports. Everything here is sample data. */

export const NOW = new Date("2026-10-28T02:00:00.000Z"); // Wed 28 Oct 2026 10:00 MYT
export const WEEK_OF = "2026-10-26";

export async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const e of it) out.push(e);
  return out;
}

export const types = (events: AgentEvent[]) => events.map((e) => e.type);
export const toolNames = (events: AgentEvent[], type: "tool_call" | "tool_result" = "tool_call") =>
  events.flatMap((e) => (e.type === type ? [e.tool] : []));

let seq = 0;
export const call = (name: string, args: unknown = {}): ChatToolCall => ({
  id: `call_${++seq}`,
  name,
  arguments: typeof args === "string" ? args : JSON.stringify(args),
});
export const turn = (...calls: ChatToolCall[]): ChatResponse => ({ content: null, toolCalls: calls });
export const text = (content: string): ChatResponse => ({ content, toolCalls: [] });

// ---- data ports ------------------------------------------------------------------------------

const ev = (store: Store, endpoint: string, summary: string, entityIds: string[] = [], mode: Evidence["mode"] = "fixture") =>
  makeEvidence({ source: endpoint.includes("search") ? "tavily" : "qloo", endpoint, params: { storeId: store.id }, summary, entityIds, mode, fetchedAt: NOW.toISOString(), metrics: { affinity: 0.8 } });

const ARTISTS = ["Khruangbin", "Alabama Shakes", "Nick Hakim", "Lianne La Havas", "Tom Misch", "Cleo Sol", "Joy Crookes", "Hiatus Kaiyote", "Sault", "Little Simz", "Michael Kiwanuka", "Leon Bridges"];

export interface FakeQlooOptions {
  /** Places come back without evidence ids (the evidence-less case). */
  placesWithoutEvidence?: boolean;
  artistCount?: number;
}

export function fakeQloo(o: FakeQlooOptions = {}): QlooPort {
  return {
    async blockProfile(store) {
      const evidence = [ev(store, "/v2/insights", `Around ${store.name}, cardamom pastries and soul records over-index against New York.`)];
      const profile: BlockProfile = {
        storeId: store.id,
        tags: [
          { tagId: "urn:tag:specialty_dish:place:cardamom_bun", name: "Cardamom Pastry", kind: "cuisine", affinity: 0.9, lift: 0.34 },
          { tagId: "urn:tag:genre:music:soul", name: "Soul", kind: "music", affinity: 0.88, lift: 0.3 },
          { tagId: "urn:tag:ambience:qloo:cozy", name: "Cozy", kind: "ambience", affinity: 0.8, lift: 0.2 },
          { tagId: "urn:tag:cuisine:qloo:cold_brew", name: "Cold Brew", kind: "flavour", affinity: 0.78, lift: 0.1 },
        ],
        evidenceIds: evidence.map((e) => e.id),
        computedAt: NOW.toISOString(),
      };
      return { profile, evidence };
    },
    async placesNear(store) {
      const evidence = [ev(store, "/v2/insights", `Three places near ${store.name} share the chain's taste.`)];
      const places = [
        ["Greenlight Bookstore", 240], ["Vinyl Haven Records", 410], ["Paper Plane Gallery", 760],
      ].map(([name, d], i) => ({
        entity: { entityId: `${fnv(store.id + name)}-place-${i}`, name: String(name), type: "urn:entity:place" },
        address: `${100 + i} Main St`, lat: store.lat + 0.001 * (i + 1), lon: store.lon, distanceM: Number(d),
        affinity: 0.9 - i * 0.1, tags: ["Books", "Local"], evidenceIds: o.placesWithoutEvidence ? [] : [evidence[0].id],
      }));
      return { items: places, evidence: o.placesWithoutEvidence ? [] : evidence };
    },
    async artistsLocal(store, _chain, opts) {
      const evidence = [ev(store, "/v2/insights", `Artists with a local skew near ${store.name}.`)];
      const n = o.artistCount ?? 12;
      const items = ARTISTS.slice(0, opts.limit ? Math.min(opts.limit, n) : n).map((name) => ({
        entity: { entityId: `${fnv(name)}-artist`, name, type: "urn:entity:artist" }, affinity: 0.7, evidenceIds: [evidence[0].id],
      }));
      return { items, evidence };
    },
    async brandsLocal(store) {
      const evidence = [ev(store, "/v2/insights", "Brands over-indexing here.")];
      return { items: [{ entity: { entityId: "brand-1", name: "Mast Brothers", type: "urn:entity:brand" }, evidenceIds: [evidence[0].id] }], evidence };
    },
    async rising(store, _chain, { kind }) {
      const evidence = [ev(store, "/v2/trending", `Rising ${kind}s in Qloo's population data.`)];
      return { items: [], evidence };
    },
  };
}

/** Hashed bag-of-words embeddings: texts that share words are close, so "Cardamom" finds the cardamom bun. */
export function embedText(t: string): number[] {
  const v = new Array<number>(48).fill(0);
  for (const w of t.toLowerCase().match(/[a-z]+/g) ?? []) v[parseInt(fnv(w), 36) % 48] += 1;
  return v;
}

export function fakeTf(opts: { rerankFails?: boolean } = {}): AgentDeps["tf"] {
  return {
    async embed(texts) { return { vectors: texts.map(embedText), mode: "fixture" }; },
    async rerank(_q, docs) {
      if (opts.rerankFails) throw new Error("rerank unavailable");
      return { ranked: docs.map((_, index) => ({ index, score: 0.9 - index * 0.1 })), method: "rerank", mode: "fixture" };
    },
  };
}

export function fakeTavily(): AgentDeps["tavily"] {
  return {
    async eventsThisWeek(store) {
      const evidence = [makeEvidence({ source: "tavily", endpoint: "/search", params: { storeId: store.id }, summary: `Event listings near ${store.name} this week.`, mode: "fixture", fetchedAt: NOW.toISOString() })];
      return {
        items: [
          { title: "Brooklyn Record Fair", url: "https://www.eventbrite.com/e/brooklyn-record-fair", startsAt: "2026-10-30T18:00:00", venue: "Brooklyn Expo", snippet: "Vinyl dealers and live sets.", evidenceIds: [evidence[0].id] },
          { title: "Open Mic Night", url: "https://www.meetup.com/open-mic", startsAt: "2026-11-01", venue: null, snippet: "Poetry and songs.", evidenceIds: [evidence[0].id] },
        ],
        evidence,
      };
    },
  };
}

/** Blocks any text containing "boost your immunity"; passes the rest. `down` makes the service unreachable. */
export function fakeGuardrails(mode: "ok" | "down" | "block-all" = "ok"): AgentDeps["guardrails"] & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async checkCopy({ text: t }) {
      calls.push(t);
      if (mode === "down") throw new Error("guardrails unreachable");
      if (mode === "block-all" || /boost your immunity/i.test(t)) {
        return { status: "blocked", rail: "no_health_claims", reasons: ["Makes a health claim."] } satisfies GuardrailResult;
      }
      return { status: "passed", reasons: [] };
    },
  };
}

// ---- scripted chat ---------------------------------------------------------------------------

export const COPY_JSON = {
  special: { name: "Cardamom Morning Bun", description: "Rolled with cardamom sugar, a Williamsburg regular's order this week.", staffLine: "Try the cardamom bun, it is this week's block favourite." },
  sound: { brief: "Keep it warm and low. Start with Khruangbin and Nick Hakim, then drift toward soul.", mood: "warm soul" },
  partner: { reason: "A short walk away and it shares our taste for slow afternoons and good paper.", offerIdea: "Swap counter cards with their front desk this week." },
  event: { title: "Vinyl and Coffee Night", description: "An evening of records spun in the shop, timed to the record fair down the road." },
};

export interface ScriptOptions {
  /** Agent-model replies in order; once exhausted the last one repeats. A function sees the request. */
  agent?: (ChatResponse | Error)[] | ((req: ChatRequest, n: number) => ChatResponse);
  /** Copy-model reply per kind (JSON object) or a function over the user text. */
  copy?: (user: string, req: ChatRequest) => string;
}

export interface ScriptedChat { complete(req: ChatRequest): Promise<ChatResponse>; requests: ChatRequest[]; agentCalls: number; copyCalls: number }

export function scriptedChat(o: ScriptOptions = {}): ScriptedChat {
  const script = o.agent ?? happyAgent();
  const chat: ScriptedChat = {
    requests: [], agentCalls: 0, copyCalls: 0,
    async complete(req) {
      chat.requests.push({ ...req, messages: [...req.messages] });
      if (req.model === AGENT_MODEL) {
        chat.agentCalls++;
        // The turn number is read from the conversation itself, so each store replays the script from the top.
        const n = req.messages.filter((m) => m.role === "assistant").length;
        if (typeof script === "function") return script(req, n);
        const reply = script[Math.min(n, script.length - 1)];
        if (reply instanceof Error) throw reply;
        return reply;
      }
      if (req.model === COPY_MODEL) {
        chat.copyCalls++;
        const user = String([...req.messages].reverse().find((m) => m.role === "user")?.content ?? "");
        const system = String(req.messages[0].content ?? "");
        const out = o.copy ? o.copy(user, req) : defaultCopy(user, system);
        return text(out);
      }
      throw new Error(`unexpected model ${req.model}`);
    },
  };
  return chat;
}

function defaultCopy(user: string, system: string): string {
  if (system.includes("Reply with only the rewritten text")) return "A warm cardamom bun, rolled fresh each morning.";
  const kind = (["special", "sound", "partner", "event", "card"] as const).find((k) => user.includes(`Write the ${k} copy`));
  if (kind) return JSON.stringify(COPY_JSON[kind as keyof typeof COPY_JSON]);
  return JSON.stringify({ lines: [{ heading: "This week's special", body: "Cardamom Morning Bun. Try the cardamom bun." }, { heading: "On the speakers", body: "Warm soul, low volume." }, { heading: "Next door", body: "Greenlight Bookstore, swap counter cards." }] });
}

/** A model that behaves: gather in two turns, rank, then submit by ref. */
export function happyAgent(): ChatResponse[] {
  return [
    turn(call("block_profile")),
    turn(call("menu_match"), call("places_near"), call("artists_local"), call("events_this_week")),
    turn(call("partners_rank")),
    turn(call("submit_candidates", {
      special: { pairRef: "s1" },
      sound: { artistRefs: ["a1", "a2", "a3", "a4", "a5", "a6", "a7", "a8", "a9"], mood: "warm soul" },
      partner: { placeRef: "p1", angle: "books and slow afternoons" },
      event: { eventRef: "e1" },
    })),
  ];
}

export interface Harness {
  deps: AgentDeps;
  repo: Repo;
  chat: ScriptedChat;
  guardrails: ReturnType<typeof fakeGuardrails>;
  workspaceId: string;
  storeIds: string[];
}

export async function harness(opts: ScriptOptions & { qloo?: FakeQlooOptions; guardrails?: "ok" | "down" | "block-all"; tf?: { rerankFails?: boolean }; limits?: AgentDeps["limits"]; storeCount?: number } = {}): Promise<Harness> {
  const repo = createMemoryRepo();
  const seed = sampleSeed();
  seed.stores = seed.stores.slice(0, opts.storeCount ?? 2);
  const workspace = await repo.createWorkspace(seed);
  const chat = scriptedChat(opts);
  const guardrails = fakeGuardrails(opts.guardrails);
  const deps: AgentDeps = { repo, chat, qloo: fakeQloo(opts.qloo), tavily: fakeTavily(), tf: fakeTf(opts.tf), guardrails, now: () => NOW, limits: opts.limits };
  return { deps, repo, chat, guardrails, workspaceId: workspace.id, storeIds: seed.stores.map((s) => s.id) };
}
