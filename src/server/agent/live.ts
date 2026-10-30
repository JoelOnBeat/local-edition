import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { Chain, Store } from "@/contract";
import { checkCopyDetailed } from "../guardrails";
import { repoCache } from "../qloo/deps";
import { BLOCK_TAG_TYPES, baselineCacheKey } from "../qloo/util";
import { serverEnv } from "@/lib/env";
import { artistsLocal } from "../qloo/artists";
import { blockProfile } from "../qloo/block";
import { brandsLocal } from "../qloo/brands";
import { placesNear } from "../qloo/places";
import { rising } from "../qloo/rising";
import { resolveAnchors } from "../qloo/anchors";
import { TavilyBudgetError, eventChain, isDemoWorkspace, prefetchEventChains, tavilyModeFor, workspaceOfChain } from "../tavily";
import type { EventChainBatch, EventChainResult } from "../tavily";
import { weekPhrase } from "../tavily/request";
import { getTokenFactory } from "../tokenfactory";
import { liveStoreSignals } from "../connectors/mail/inbound";
import { createLogger } from "../log";
import { getRepo } from "../store";
import type { Repo } from "../store/repo";
import type {
  AgentDeps,
  ArtistCandidate,
  BaselineTag,
  ChatClient,
  ChatMessage,
  EventCandidate,
  PlaceCandidate,
  QlooPort,
  RisingCandidate,
  TavilyPort,
  TokenFactoryPort,
} from "./ports";

/**
 * The only file that touches the other streams' modules. Everything the agent knows about Qloo,
 * Tavily, Token Factory and Guardrails passes through the ports in `ports.ts`.
 */

/** The block profile's city baseline cache key (`qloo/block.ts`); the verifier reads it back to recompute lifts. */
const baselineKey = (chain: Chain, group: string) => baselineCacheKey(chain.city.name, group);

/**
 * The chain's anchors as real Qloo entity ids and names. The sample chain's anchors carry placeholder ids (`sample-blue-bottle-coffee`),
 * which the queries drop, so without this the place, artist and rising queries would run with no anchor signal at all. Resolved through
 * /search once per brand and saved in the cache for 24 hours (the saved answer costs no call).
 */
async function resolvedAnchors(chain: Chain, cache: { cache: ReturnType<typeof repoCache> }) {
  const refs = await resolveAnchors(chain, cache);
  return { ids: refs.map((r) => r.entityId), names: Object.fromEntries(refs.map((r) => [r.entityId, r.name])) };
}
const ids = (evidenceId: string) => (evidenceId ? [evidenceId] : []);

function qlooPort(repo: Repo): QlooPort {
  const cache = { cache: repoCache(repo) };
  return {
    blockProfile: (store, chain) => blockProfile(store, chain, cache),

    async baseline(chain) {
      const out: BaselineTag[] = [];
      for (const group of [...BLOCK_TAG_TYPES.map((t) => t.type), "places"]) {
        const hit = await cache.cache.get<unknown>(baselineKey(chain, group));
        if (Array.isArray(hit)) {
          for (const t of hit as { tagId?: string; affinity?: number }[]) if (typeof t?.tagId === "string" && typeof t.affinity === "number") out.push({ tagId: t.tagId, affinity: t.affinity, group });
        } else if (hit && typeof hit === "object") {
          // The places fallback caches tag id -> share.
          for (const [tagId, affinity] of Object.entries(hit as Record<string, unknown>)) if (typeof affinity === "number") out.push({ tagId, affinity, group });
        }
      }
      return out.length ? out : null;
    },

    async placesNear(store, chain, o) {
      const a = await resolvedAnchors(chain, cache);
      const r = await placesNear(store, { tags: o.tagIds, take: o.limit, anchorIds: a.ids, anchorNames: a.names }, cache);
      const items: PlaceCandidate[] = r.hits.map((h) => ({
        entity: { entityId: h.place.entityId, name: h.place.name, type: h.place.type },
        address: h.place.address, lat: h.place.lat, lon: h.place.lon, distanceM: h.place.distanceM,
        affinity: h.affinity ?? undefined, tags: h.tags.map((t) => t.name), evidenceIds: ids(h.evidenceId),
      }));
      return { items, evidence: r.evidence };
    },

    async artistsLocal(store, chain, o) {
      const a = await resolvedAnchors(chain, cache);
      const r = await artistsLocal(store, a.ids, { tags: o.genres, take: o.limit, anchorNames: a.names }, cache);
      const items: ArtistCandidate[] = r.hits.map((h) => ({ entity: h.artist, affinity: h.affinity ?? undefined, evidenceIds: ids(h.evidenceId) }));
      return { items, evidence: r.evidence };
    },

    async brandsLocal(store, _chain, o) {
      const r = await brandsLocal(store, { take: o.limit }, cache);
      return { items: r.hits.map((h) => ({ entity: h.brand, affinity: h.affinity ?? undefined, evidenceIds: ids(h.evidenceId) })), evidence: r.evidence };
    },

    async rising(store, chain, o) {
      if (o.kind === "brand") return { items: [], evidence: [] };
      const r = await rising(store, { anchorIds: (await resolvedAnchors(chain, cache)).ids, kinds: [o.kind] }, cache);
      const items: RisingCandidate[] = r.hits.map((h) => ({
        entity: h.entity, kind: h.kind, rankDelta: h.rankOff === null ? undefined : h.rankOff - h.rankHigh, evidenceIds: h.evidenceIds,
      }));
      return { items, evidence: r.evidence };
    },
  };
}

const log = createLogger("agent:live");

/** One prefetch per chain and week per isolate, for a quarter of an hour: the stores of one build ask in turn and share it. */
const PREFETCH_TTL_MS = 15 * 60_000;
const prefetches = new Map<string, { at: number; run: Promise<EventChainBatch> }>();

/** Tests only. */
export function resetTavilyPrefetch(): void {
  prefetches.clear();
}

/**
 * The build's and regenerate's one door to Tavily: the cached chain (search, page read, triage), never a bare search.
 * It reads this week's saved result first; a live call happens only for the demo workspace's unmodified sample stores
 * and is reserved against the GLOBAL credit ledger first (see `src/server/tavily/budget.ts`). Anywhere else, or when the
 * credits are spent, it throws TavilyBudgetError and the tool tells the agent it is using this week's saved events.
 * In live mode the demo workspace's first store to ask prefetches ALL of the chain's stores in one batch (a search each
 * and one batched page read for the lot: 10 credits for eight stores, not 16), so the other stores' turns find their
 * results saved.
 */
function tavilyPort(repo: Repo): TavilyPort {
  /** The demo workspace's live batch for every store of the chain, shared by the prefetch step and the first store that asks. */
  const liveBatch = async (store: Store, chain: Chain): Promise<EventChainBatch | undefined> => {
    const opts = { workspaceId: workspaceOfChain(chain) };
    if (!isDemoWorkspace(opts.workspaceId) || tavilyModeFor(serverEnv()).run !== "live") return undefined;
    const stores = await repo.listStores(chain.id);
    const all = stores.some((s) => s.id === store.id) ? stores : [store, ...stores];
    const key = `${chain.id}|${weekPhrase(new Date())}`;
    const memo = prefetches.get(key);
    let entry = memo && Date.now() - memo.at < PREFETCH_TTL_MS ? memo : undefined;
    if (!entry) {
      entry = { at: Date.now(), run: prefetchEventChains(all, chain, opts) };
      prefetches.set(key, entry);
      entry.run.catch(() => prefetches.delete(key));
    }
    return entry.run;
  };
  return {
    /**
     * The week's whole Tavily prefetch (8 searches and one page read live) as its own step, before the agent loop: it does not fit
     * inside one tool call's 25 s. Results are saved, so `events_this_week` then reads the cache. Never throws: a store the prefetch
     * could not cover falls back to saved events exactly as before.
     */
    async prefetchWeek(stores: Store[], chain: Chain) {
      if (!stores.length) return;
      try {
        await liveBatch(stores[0], chain);
      } catch (e) {
        log.warn("week events prefetch failed; the agent will use saved events", { err: e });
      }
    },
    async eventsThisWeek(store: Store, chain: Chain) {
      const opts = { workspaceId: workspaceOfChain(chain) };
      let r: EventChainResult | undefined = (await liveBatch(store, chain))?.results.get(store.id);
      r ??= await eventChain(store, chain, opts);
      if (r.fallback === "tavily_budget") throw new TavilyBudgetError(r.budgetReason ?? "daily");
      // Only the events Lightning kept become candidates; each carries the evidence row that backs its tie-in.
      const items: EventCandidate[] = r.events
        .filter((e) => e.triage.kept && e.evidenceId)
        .map((e) => ({ title: e.title, url: e.url, startsAt: e.date, venue: e.venue, snippet: e.snippet, evidenceIds: [e.evidenceId as string] }));
      return { items, evidence: r.evidence };
    },
  };
}

const tfPort: TokenFactoryPort = {
  async embed(texts) {
    const r = await getTokenFactory().embeddings(texts);
    return { vectors: r.vectors, mode: r.mode };
  },
  async rerank(query, docs) {
    const r = await getTokenFactory().rerank(query, docs);
    return { ranked: r.results, method: r.method === "rerank" ? "rerank" : "embedding", mode: r.mode };
  },
};

function toOpenAi(m: ChatMessage): ChatCompletionMessageParam {
  if (m.role === "tool") return { role: "tool", tool_call_id: m.toolCallId, content: m.content };
  if (m.role === "assistant") {
    return {
      role: "assistant",
      content: m.content,
      ...(m.toolCalls?.length ? { tool_calls: m.toolCalls.map((c) => ({ id: c.id, type: "function" as const, function: { name: c.name, arguments: c.arguments } })) } : {}),
    };
  }
  return { role: m.role, content: m.content };
}

const chatClient: ChatClient = {
  async complete(req) {
    const r = await getTokenFactory().chat(req.messages.map(toOpenAi), {
      model: req.model,
      maxTokens: req.maxTokens ?? 800,
      temperature: req.temperature,
      reasoning: req.reasoning,
      responseFormat: req.responseFormat ? { type: "json_schema", json_schema: { name: req.responseFormat.name, schema: req.responseFormat.schema, strict: true } } : undefined,
      tools: req.tools?.map((t) => ({ type: "function" as const, function: { name: t.name, description: t.description, parameters: t.parameters } })),
    });
    return {
      content: r.content,
      toolCalls: r.toolCalls.map((c) => ({ id: c.id, name: c.name, arguments: c.arguments })),
      usage: {
        promptTokens: r.usage.inTokens,
        // The Token Factory client does not parse `prompt_tokens_details.cached_tokens` yet; read it when it does.
        cachedTokens: (r.usage as { cachedTokens?: number }).cachedTokens ?? 0,
        completionTokens: r.usage.outTokens,
        reasoningTokens: r.usage.reasoningTokens,
      },
    };
  },
};

/** Live wiring: repo from STORE_DRIVER, providers in their own modes (replay/fixture without keys). */
export async function liveAgentDeps(): Promise<AgentDeps> {
  const repo = await getRepo();
  return {
    repo,
    storeSignals: liveStoreSignals,
    chat: chatClient,
    qloo: qlooPort(repo),
    tavily: tavilyPort(repo),
    tf: tfPort,
    guardrails: {
      // The detailed form carries the revised text when the sidecar rewrote the copy.
      checkCopy: async (input) => {
        const r = await checkCopyDetailed(input);
        return { ...r.result, text: r.text };
      },
    },
    now: () => new Date(),
    // Fixture mode only: the evidence verifier is shown catching one labelled, deliberately bad item.
    seedBadItem: serverEnv().QLOO_MODE === "fixture",
  };
}
