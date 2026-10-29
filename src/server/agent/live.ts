import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { Chain, Store } from "@/contract";
import { checkCopyDetailed } from "../guardrails";
import { repoCache } from "../qloo/deps";
import { BLOCK_TAG_TYPES } from "../qloo/util";
import { serverEnv } from "@/lib/env";
import { artistsLocal } from "../qloo/artists";
import { blockProfile } from "../qloo/block";
import { brandsLocal } from "../qloo/brands";
import { placesNear } from "../qloo/places";
import { rising } from "../qloo/rising";
import { eventsThisWeek } from "../tavily";
import { getTokenFactory } from "../tokenfactory";
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
const baselineKey = (chain: Chain, group: string) => `qloo:baseline:v1:${chain.city.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}:${group}`;

const anchorIds = (chain: Chain) => chain.anchors.map((a) => a.entityId);
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
      const r = await placesNear(store, { tags: o.tagIds, take: o.limit, anchorIds: anchorIds(chain) }, cache);
      const items: PlaceCandidate[] = r.hits.map((h) => ({
        entity: { entityId: h.place.entityId, name: h.place.name, type: h.place.type },
        address: h.place.address, lat: h.place.lat, lon: h.place.lon, distanceM: h.place.distanceM,
        affinity: h.affinity ?? undefined, tags: h.tags.map((t) => t.name), evidenceIds: ids(h.evidenceId),
      }));
      return { items, evidence: r.evidence };
    },

    async artistsLocal(store, chain, o) {
      const r = await artistsLocal(store, anchorIds(chain), { tags: o.genres, take: o.limit }, cache);
      const items: ArtistCandidate[] = r.hits.map((h) => ({ entity: h.artist, affinity: h.affinity ?? undefined, evidenceIds: ids(h.evidenceId) }));
      return { items, evidence: r.evidence };
    },

    async brandsLocal(store, _chain, o) {
      const r = await brandsLocal(store, { take: o.limit }, cache);
      return { items: r.hits.map((h) => ({ entity: h.brand, affinity: h.affinity ?? undefined, evidenceIds: ids(h.evidenceId) })), evidence: r.evidence };
    },

    async rising(store, chain, o) {
      if (o.kind === "brand") return { items: [], evidence: [] };
      const r = await rising(store, { anchorIds: anchorIds(chain), kinds: [o.kind] }, cache);
      const items: RisingCandidate[] = r.hits.map((h) => ({
        entity: h.entity, kind: h.kind, rankDelta: h.rankOff === null ? undefined : h.rankOff - h.rankHigh, evidenceIds: h.evidenceIds,
      }));
      return { items, evidence: r.evidence };
    },
  };
}

const tavilyPort: TavilyPort = {
  async eventsThisWeek(store: Store, chain: Chain) {
    const r = await eventsThisWeek(store, { city: chain.city.name });
    const items: EventCandidate[] = r.events.map((e) => ({
      title: e.title, url: e.url, startsAt: e.date ?? null, snippet: e.snippet, evidenceIds: [r.evidence.id],
    }));
    return { items, evidence: [r.evidence] };
  },
};

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
    chat: chatClient,
    qloo: qlooPort(repo),
    tavily: tavilyPort,
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
