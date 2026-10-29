import { z } from "zod";
import type { AgentDeps, ChatToolSpec, StoreContext } from "./ports";
import { ToolMemory, type MenuPair } from "./memory";
import { clip, cosine, fnv, makeEvidence } from "./util";

/** Tools the Nemotron agent can call. Each is a thin wrapper over a data port. */

export interface ToolCtx {
  sc: StoreContext;
  deps: AgentDeps;
  mem: ToolMemory;
}

export interface ToolOutcome {
  /** One line for the `tool_result` event. */
  summary: string;
  /** Compact JSON the model reads. */
  payload: unknown;
  evidenceIds: string[];
}

export interface ToolDef<S extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  schema: S;
  run(ctx: ToolCtx, args: z.output<S>): Promise<ToolOutcome>;
}

const limitSchema = z.number().int().min(1).max(20).optional();
const emptyArgs = z.object({}).strict();
const noParams = { type: "object", properties: {}, additionalProperties: false };

const embedCaches = new WeakMap<object, Map<string, number[]>>();

async function embedCached(deps: AgentDeps, texts: string[]) {
  const cache = embedCaches.get(deps.tf) ?? new Map<string, number[]>();
  embedCaches.set(deps.tf, cache);
  const missing = [...new Set(texts.filter((t) => !cache.has(fnv(t))))];
  let mode: "live" | "replay" | "fixture" | "cache" = "cache";
  if (missing.length) {
    const res = await deps.tf.embed(missing);
    mode = res.mode;
    missing.forEach((t, i) => cache.set(fnv(t), res.vectors[i]));
  }
  return { vectors: texts.map((t) => cache.get(fnv(t)) ?? []), mode };
}

/** The store brief used as the rerank query and shown to the model. */
export function storeBrief(sc: StoreContext, mem: ToolMemory): string {
  const tags = (mem.profile?.tags ?? []).slice(0, 5).map((t) => t.name);
  const anchors = sc.chain.anchors.map((a) => a.name).join(", ");
  return [
    `${sc.chain.name}, a ${sc.chain.category} chain resembling ${anchors}.`,
    `Store: ${sc.store.name} (${sc.store.addressLabel}), ${sc.chain.city.name}.`,
    tags.length ? `The block leans: ${tags.join(", ")}.` : "",
  ].filter(Boolean).join(" ");
}

const blockProfile: ToolDef<typeof emptyArgs> = {
  name: "block_profile",
  description: "Qloo taste profile of this store's block: the tags (cuisine, flavour, ambience, music) that over-index here versus the city.",
  parameters: noParams,
  schema: emptyArgs,
  async run({ sc, deps, mem }) {
    const { profile, evidence } = await deps.qloo.blockProfile(sc.store, sc.chain);
    mem.profile = profile;
    const ids = mem.addEvidence(evidence);
    return {
      summary: `${profile.tags.length} tags over-index on this block`,
      payload: { tags: profile.tags.map((t) => ({ tagId: t.tagId, name: t.name, kind: t.kind, lift: round(t.lift) })) },
      evidenceIds: ids,
    };
  },
};

const placesArgs = z.object({ tagIds: z.array(z.string().min(1)).max(5).optional(), limit: limitSchema });
const placesNear: ToolDef<typeof placesArgs> = {
  name: "places_near",
  description: "Local places near the store that match the chain's taste, as candidate partners. Optionally narrow by Qloo tag ids from block_profile.",
  parameters: {
    type: "object",
    properties: {
      tagIds: { type: "array", items: { type: "string" }, maxItems: 5, description: "Qloo tag ids to narrow by" },
      limit: { type: "integer", minimum: 1, maximum: 20 },
    },
    additionalProperties: false,
  },
  schema: placesArgs,
  async run({ sc, deps, mem }, args) {
    const { items, evidence } = await deps.qloo.placesNear(sc.store, sc.chain, args);
    const ids = mem.addEvidence(evidence);
    const entries = mem.addPlaces(items);
    return {
      summary: `${entries.length} places within reach`,
      payload: { places: entries.map((e) => ({ ref: e.ref, name: e.place.entity.name, distanceM: Math.round(e.place.distanceM), tags: e.place.tags.slice(0, 3), affinity: round(e.place.affinity) })) },
      evidenceIds: ids,
    };
  },
};

const artistsArgs = z.object({ genres: z.array(z.string().min(1)).max(5).optional(), limit: limitSchema });
const artistsLocal: ToolDef<typeof artistsArgs> = {
  name: "artists_local",
  description: "Artists that fit this block for the in-store playlist. Qloo returns artists, never tracks.",
  parameters: {
    type: "object",
    properties: { genres: { type: "array", items: { type: "string" }, maxItems: 5 }, limit: { type: "integer", minimum: 1, maximum: 20 } },
    additionalProperties: false,
  },
  schema: artistsArgs,
  async run({ sc, deps, mem }, args) {
    const { items, evidence } = await deps.qloo.artistsLocal(sc.store, sc.chain, args);
    const ids = mem.addEvidence(evidence);
    const entries = mem.addArtists(items);
    return {
      summary: `${entries.length} artists for the room`,
      payload: { artists: entries.map((e) => ({ ref: e.ref, name: e.artist.entity.name, genres: e.artist.genres?.slice(0, 2) })) },
      evidenceIds: ids,
    };
  },
};

const brandsArgs = z.object({ limit: limitSchema });
const brandsLocal: ToolDef<typeof brandsArgs> = {
  name: "brands_local",
  description: "Brands that over-index around this block; ideas for what the store pairs well with.",
  parameters: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 20 } }, additionalProperties: false },
  schema: brandsArgs,
  async run({ sc, deps, mem }, args) {
    const { items, evidence } = await deps.qloo.brandsLocal(sc.store, sc.chain, args);
    const ids = mem.addEvidence(evidence);
    const entries = mem.addBrands(items);
    return { summary: `${entries.length} local brands`, payload: { brands: entries.map((e) => ({ ref: e.ref, name: e.brand.entity.name })) }, evidenceIds: ids };
  },
};

const risingArgs = z.object({ kind: z.enum(["place", "artist", "brand"]) });
const rising: ToolDef<typeof risingArgs> = {
  name: "rising",
  description: "What is rising in Qloo's population data for places, artists or brands near this store. Never say it is rising on this street.",
  parameters: { type: "object", properties: { kind: { type: "string", enum: ["place", "artist", "brand"] } }, required: ["kind"], additionalProperties: false },
  schema: risingArgs,
  async run({ sc, deps, mem }, args) {
    const { items, evidence } = await deps.qloo.rising(sc.store, sc.chain, args);
    const ids = mem.addEvidence(evidence);
    const entries = mem.addRising(items);
    return { summary: `${entries.length} rising ${args.kind}s`, payload: { rising: entries.map((e) => ({ ref: e.ref, name: e.item.entity.name, kind: e.item.kind, rankDelta: e.item.rankDelta })) }, evidenceIds: ids };
  },
};

const eventsThisWeek: ToolDef<typeof emptyArgs> = {
  name: "events_this_week",
  description: "Real events near the store this week (Tavily web search), usable as a tie-in for an event night.",
  parameters: noParams,
  schema: emptyArgs,
  async run({ sc, deps, mem }) {
    const { items, evidence } = await deps.tavily.eventsThisWeek(sc.store, sc.chain, sc.weekOf);
    const ids = mem.addEvidence(evidence);
    const entries = mem.addEvents(items);
    return {
      summary: `${entries.length} events this week`,
      payload: { events: entries.map((e) => ({ ref: e.ref, title: e.event.title, startsAt: e.event.startsAt, venue: e.event.venue ?? null, source: hostOf(e.event.url) })) },
      evidenceIds: ids,
    };
  },
};

const MATCH_THRESHOLD = 0.5;
const menuMatchArgs = z.object({ tagNames: z.array(z.string().min(1)).max(8).optional() });
const menuMatch: ToolDef<typeof menuMatchArgs> = {
  name: "menu_match",
  description: "Match menu items to the block's cuisine and flavour tags by embedding similarity. Returns the best item and tag pairs with scores. Call block_profile first unless you pass tagNames.",
  parameters: { type: "object", properties: { tagNames: { type: "array", items: { type: "string" }, maxItems: 8 } }, additionalProperties: false },
  schema: menuMatchArgs,
  async run({ sc, deps, mem }, args) {
    const profileTags = (mem.profile?.tags ?? []).filter((t) => t.kind === "cuisine" || t.kind === "flavour");
    const tags = args.tagNames?.length
      ? args.tagNames.map((name) => mem.profile?.tags.find((t) => t.name.toLowerCase() === name.toLowerCase()) ?? { tagId: `adhoc-${fnv(name)}`, name, kind: "flavour" as const, affinity: 0, lift: 0 })
      : (profileTags.length ? profileTags : mem.profile?.tags ?? []).slice(0, 8);
    if (!tags.length) return { summary: "no tags to match: call block_profile first", payload: { error: "No tags available. Call block_profile first or pass tagNames." }, evidenceIds: [] };
    if (!sc.menu.length) return { summary: "the menu is empty", payload: { error: "The chain has no menu items." }, evidenceIds: [] };

    const itemTexts = sc.menu.map((m) => `${m.name}. ${m.category}. ${m.description ?? ""}`.trim());
    const tagTexts = tags.map((t) => `${t.name} (${t.kind}, e.g. cuisine or specialty dish)`);
    const { vectors, mode } = await embedCached(deps, [...itemTexts, ...tagTexts]);
    const itemVecs = vectors.slice(0, sc.menu.length);
    const now = deps.now().toISOString();

    const raw: { menuIdx: number; tagIdx: number; score: number }[] = [];
    tags.forEach((_, tagIdx) => {
      itemVecs
        .map((v, menuIdx) => ({ menuIdx, tagIdx, score: cosine(v, vectors[sc.menu.length + tagIdx]) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 2)
        .forEach((p) => raw.push(p));
    });
    raw.sort((a, b) => b.score - a.score);
    const strong = raw.filter((p) => p.score >= MATCH_THRESHOLD);
    const kept = (strong.length ? strong : raw.slice(0, 1)).slice(0, 6);

    const pairs: Omit<MenuPair, "ref">[] = kept.map((p) => {
      const item = sc.menu[p.menuIdx];
      const tag = tags[p.tagIdx];
      const score = Math.round(p.score * 1000) / 1000;
      const ev = makeEvidence({
        source: "tokenfactory",
        endpoint: "/v1/embeddings",
        params: { model: "Qwen/Qwen3-Embedding-8B", menuItemId: item.id, tagId: tag.tagId },
        summary: `${item.name} is the closest menu match to the block's ${tag.name} lean (similarity ${score.toFixed(2)}, lift ${signed(tag.lift)}).`,
        metrics: { relevance: score, lift: tag.lift, affinity: tag.affinity },
        entityIds: [tag.tagId],
        mode,
        fetchedAt: now,
      });
      mem.addEvidence([ev]);
      return { menuItemId: item.id, menuItemName: item.name, tagId: tag.tagId, tagName: tag.name, lift: tag.lift, score, evidenceId: ev.id };
    });
    const stored = mem.setPairs(pairs);
    return {
      summary: `${stored.length} item and tag pairs, best ${stored[0].menuItemName} with ${stored[0].tagName} (${stored[0].score.toFixed(2)})`,
      payload: { pairs: stored.map((p) => ({ ref: p.ref, menuItem: p.menuItemName, tag: p.tagName, score: p.score, lift: round(p.lift) })), weak: strong.length === 0 },
      evidenceIds: stored.map((p) => p.evidenceId),
    };
  },
};

const partnersArgs = z.object({ placeRefs: z.array(z.string().min(1)).max(20).optional() });
const partnersRank: ToolDef<typeof partnersArgs> = {
  name: "partners_rank",
  description: "Rerank candidate partner places by fit to this store's brief. Call places_near first.",
  parameters: { type: "object", properties: { placeRefs: { type: "array", items: { type: "string" }, maxItems: 20 } }, additionalProperties: false },
  schema: partnersArgs,
  async run({ sc, deps, mem }, args) {
    const entries = (args.placeRefs?.length ? args.placeRefs.flatMap((r) => (mem.places.has(r) ? [mem.places.get(r)!] : [])) : [...mem.places.values()]).slice(0, 20);
    if (!entries.length) return { summary: "no places to rank: call places_near first", payload: { error: "No places in memory. Call places_near first." }, evidenceIds: [] };
    const docs = entries.map((e) => `${e.place.entity.name}. ${e.place.tags.slice(0, 3).join(", ")}. ${Math.round(e.place.distanceM)} m.`);
    const { ranked, method, mode } = await deps.tf.rerank(storeBrief(sc, mem), docs);
    const now = deps.now().toISOString();
    const ids: string[] = [];
    for (const r of ranked) {
      const entry = entries[r.index];
      if (!entry) continue;
      const score = Math.round(r.score * 1000) / 1000;
      const ev = makeEvidence({
        source: "tokenfactory",
        endpoint: method === "rerank" ? "/v1/rerank" : "/v1/embeddings",
        params: { method, placeId: entry.place.entity.entityId },
        summary: `${entry.place.entity.name} scores ${score.toFixed(2)} for fit to this store's brief (${method === "rerank" ? "reranker" : "embedding similarity"}).`,
        metrics: { relevance: score, distanceM: entry.place.distanceM },
        entityIds: [entry.place.entity.entityId],
        mode,
        fetchedAt: now,
      });
      mem.addEvidence([ev]);
      entry.rerankScore = score;
      entry.rerankEvidenceId = ev.id;
      ids.push(ev.id);
    }
    const order = [...entries].sort((a, b) => (b.rerankScore ?? -1) - (a.rerankScore ?? -1));
    return {
      summary: `ranked ${ranked.length} places by ${method}, best ${order[0]?.place.entity.name ?? "none"}`,
      payload: { ranked: order.map((e) => ({ ref: e.ref, name: e.place.entity.name, score: e.rerankScore, distanceM: Math.round(e.place.distanceM) })) },
      evidenceIds: ids,
    };
  },
};

export const TOOLS: ToolDef[] = [blockProfile, placesNear, artistsLocal, brandsLocal, rising, eventsThisWeek, menuMatch, partnersRank] as unknown as ToolDef[];
export const TOOL_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

export function toolSpecs(): ChatToolSpec[] {
  return TOOLS.map(({ name, description, parameters }) => ({ name, description, parameters }));
}

/** Result text sent back to the model, capped so a long list cannot blow the context. */
export function renderPayload(payload: unknown): string {
  return clip(JSON.stringify(payload), 6000);
}

function round(n: number | undefined): number | undefined {
  return n === undefined ? undefined : Math.round(n * 100) / 100;
}
function signed(n: number): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}`;
}
function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return "web"; }
}
