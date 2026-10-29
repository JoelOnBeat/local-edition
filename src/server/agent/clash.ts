import type { Edition, EditionItem, EditionItemKind } from "@/contract";
import { createLogger } from "../log";
import { meteredEmbed } from "./metrics";
import type { AgentDeps } from "./ports";
import { cosine } from "./util";

const log = createLogger("agent:clash");

/**
 * Cross-store clashes, found without a model before the reviewer sees anything: two stores of one chain
 * handing out the same partner, the same event night or near-identical copy are the cheapest thing for head
 * office to miss and the easiest for code to prove. Exact matches are facts; embedding cosine above
 * `COSINE_CLASH` over item names and descriptions is a candidate the reviewer judges.
 */

export const COSINE_CLASH = 0.88;
/** Two sound briefs clash when at least this share of the smaller artist list is shared. */
export const ARTIST_OVERLAP_CLASH = 0.5;

export type ClashKind = "same_partner" | "same_event" | "shared_artists" | "similar_copy";

export interface Clash {
  kind: ClashKind;
  itemKind: EditionItemKind;
  /** The two stores, in the order they were given. */
  a: string;
  b: string;
  /** One plain sentence for the reviewer's prompt and for tests. */
  detail: string;
  /** Cosine or overlap share, when the clash is a measurement rather than an exact match. */
  score?: number;
}

export interface StoreEdition {
  storeId: string;
  storeName: string;
  edition: Edition;
}

const live = (e: Edition): EditionItem[] => e.items.filter((i) => i.status !== "rejected");
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** The text embedded for an item: its name and description, never ids or prices. */
export function itemText(item: EditionItem): string {
  switch (item.kind) {
    case "special": return `${item.name}. ${item.description}`;
    case "sound": return item.brief;
    case "partner": return `${item.place.name}. ${item.offerIdea}`;
    case "event": return `${item.title}. ${item.description}`;
  }
}

function exactClashes(entries: StoreEdition[]): Clash[] {
  const out: Clash[] = [];
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const [x, y] = [entries[i], entries[j]];
      for (const p of live(x.edition)) {
        for (const q of live(y.edition)) {
          if (p.kind === "partner" && q.kind === "partner" && p.place.entityId === q.place.entityId) {
            out.push({ kind: "same_partner", itemKind: "partner", a: x.storeId, b: y.storeId, detail: `${x.storeName} and ${y.storeName} both pair with ${p.place.name}.` });
          }
          if (p.kind === "event" && q.kind === "event") {
            const sameListing = p.tieIn && q.tieIn && p.tieIn.url === q.tieIn.url;
            const sameNight = p.day === q.day && norm(p.title) === norm(q.title);
            if (sameListing || sameNight) out.push({ kind: "same_event", itemKind: "event", a: x.storeId, b: y.storeId, detail: `${x.storeName} and ${y.storeName} both run "${p.title}" on ${p.day === q.day ? p.day : "different nights"}${sameListing ? ", tied to the same listing" : ""}.` });
          }
          if (p.kind === "sound" && q.kind === "sound") {
            const ids = new Set(p.artists.map((a) => a.entityId));
            const shared = q.artists.filter((a) => ids.has(a.entityId)).length;
            const share = shared / Math.max(1, Math.min(p.artists.length, q.artists.length));
            if (share >= ARTIST_OVERLAP_CLASH) out.push({ kind: "shared_artists", itemKind: "sound", a: x.storeId, b: y.storeId, detail: `${x.storeName} and ${y.storeName} share ${shared} of their artists.`, score: Math.round(share * 100) / 100 });
          }
        }
      }
    }
  }
  return out;
}

async function copyClashes(deps: AgentDeps, entries: StoreEdition[], exact: Clash[]): Promise<Clash[]> {
  const rows = entries.flatMap((e) => live(e.edition).filter((i) => i.kind !== "sound").map((item) => ({ entry: e, item, text: itemText(item) })));
  if (rows.length < 2) return [];
  let vectors: number[][];
  try {
    vectors = (await meteredEmbed(deps, rows.map((r) => r.text), "review_clashes")).vectors;
  } catch (e) {
    log.warn("embeddings unavailable; only exact clashes are reported", { err: (e as Error)?.name });
    return [];
  }
  const out: Clash[] = [];
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const [x, y] = [rows[i], rows[j]];
      if (x.entry.storeId === y.entry.storeId || x.item.kind !== y.item.kind) continue;
      const taken = exact.some((c) => c.itemKind === x.item.kind && c.a === x.entry.storeId && c.b === y.entry.storeId);
      const score = cosine(vectors[i], vectors[j]);
      if (taken || score < COSINE_CLASH) continue;
      out.push({ kind: "similar_copy", itemKind: x.item.kind, a: x.entry.storeId, b: y.entry.storeId, score: Math.round(score * 100) / 100, detail: `${x.entry.storeName} and ${y.entry.storeName} have near-identical ${x.item.kind} copy (similarity ${score.toFixed(2)}).` });
    }
  }
  return out;
}

/** Every cross-store clash among `entries`, exact matches first. */
export async function findClashes(deps: AgentDeps, entries: StoreEdition[]): Promise<Clash[]> {
  const exact = exactClashes(entries);
  return [...exact, ...(await copyClashes(deps, entries, exact)).sort((p, q) => (q.score ?? 0) - (p.score ?? 0))];
}
