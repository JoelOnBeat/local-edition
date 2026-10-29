import { z } from "zod";
import { cosine, fnv, makeEvidence } from "./util";
import { meteredEmbed, meteredRerank } from "./metrics";
import type { MenuPair } from "./memory";
import type { AgentDeps } from "./ports";
import { signed, round, storeBrief, type ToolDef } from "./tool-types";

/** The two tools that match menu items and places to the block with embeddings (and the reranker, when it exists). */

const embedCaches = new WeakMap<object, Map<string, number[]>>();

async function embedCached(deps: AgentDeps, texts: string[]) {
  const cache = embedCaches.get(deps.tf) ?? new Map<string, number[]>();
  embedCaches.set(deps.tf, cache);
  const missing = [...new Set(texts.filter((t) => !cache.has(fnv(t))))];
  let mode: "live" | "replay" | "fixture" | "cache" = "cache";
  if (missing.length) {
    const res = await meteredEmbed(deps, missing, "menu_match");
    mode = res.mode;
    missing.forEach((t, i) => cache.set(fnv(t), res.vectors[i]));
  }
  return { vectors: texts.map((t) => cache.get(fnv(t)) ?? []), mode };
}

const MATCH_THRESHOLD = 0.5;
const menuMatchArgs = z.object({ tagNames: z.array(z.string().min(1)).max(8).optional() });
export const menuMatch: ToolDef<typeof menuMatchArgs> = {
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
export const partnersRank: ToolDef<typeof partnersArgs> = {
  name: "partners_rank",
  description: "Rerank candidate partner places by fit to this store's brief. Call places_near first.",
  parameters: { type: "object", properties: { placeRefs: { type: "array", items: { type: "string" }, maxItems: 20 } }, additionalProperties: false },
  schema: partnersArgs,
  async run({ sc, deps, mem }, args) {
    const entries = (args.placeRefs?.length ? args.placeRefs.flatMap((r) => (mem.places.has(r) ? [mem.places.get(r)!] : [])) : [...mem.places.values()]).slice(0, 20);
    if (!entries.length) return { summary: "no places to rank: call places_near first", payload: { error: "No places in memory. Call places_near first." }, evidenceIds: [] };
    const docs = entries.map((e) => `${e.place.entity.name}. ${e.place.tags.slice(0, 3).join(", ")}. ${Math.round(e.place.distanceM)} m.`);
    const { ranked, method, mode } = await meteredRerank(deps, storeBrief(sc, mem), docs, "partners_rank");
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

