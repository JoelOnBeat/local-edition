import type { MenuItem } from "@/contract";
import { createLogger } from "../log";
import { meteredEmbed } from "./metrics";
import type { AgentDeps } from "./ports";
import { fnv } from "./util";

const log = createLogger("agent:embed-cache");

/**
 * Embeddings for `menu_match`, so the tool's call stays small and the same work is never paid for twice.
 *
 * Measured on the live run `run_3q595...` (30 Oct 2026): the first store embedded the WHOLE menu and its tags in one request
 * (about 450 tokens), and Token Factory answered in 55-65 s when its Qwen embedding endpoint was cold (1-5 s when warm). That is longer
 * than the agent's 25 s tool limit, so `menu_match` failed, and the agent's retry started the same request again (nothing was saved
 * until a request finished, and the cache lived in one isolate's memory, which a Workflow step never shares). The store then fell back
 * to the deterministic plan instead of Nemotron.
 *
 * Now the menu is embedded once per menu version (a hash of its item texts) and saved in the provider cache (KV on Workers) for 30
 * days; a request already under way is joined, not repeated; and the block's tags (a handful of short strings) go out in one batch
 * of their own. A normal `menu_match` therefore costs one small call. The build's prefetch step warms the menu before the first store.
 */

const MENU_TTL_SECONDS = 30 * 24 * 3600;
const KEY = "embed:menu:v1:";
type Mode = Awaited<ReturnType<AgentDeps["tf"]["embed"]>>["mode"];

interface Packed { dim: number; n: number; f32: string }
interface Shared { menus: Map<string, Promise<MenuVectors>>; tags: Map<string, number[]>; tagBatches: Map<string, Promise<void>> }
export interface MenuVectors { vectors: number[][]; mode: Mode; source: "memory" | "kv" | "embedded" }

const shared = new WeakMap<object, Shared>();
const stateOf = (deps: AgentDeps): Shared => {
  let s = shared.get(deps.tf);
  if (!s) shared.set(deps.tf, (s = { menus: new Map(), tags: new Map(), tagBatches: new Map() }));
  return s;
};

export const menuItemText = (m: MenuItem) => `${m.name}. ${m.category}. ${m.description ?? ""}`.trim();
/** The menu's version: changes whenever an item's name, category or description does, or an item is added, removed or reordered. */
export const menuVersion = (menu: MenuItem[]): string => {
  const texts = menu.map(menuItemText);
  return `${fnv(texts.join("\n"))}.${texts.reduce((n, t) => n + t.length, 0)}.${texts.length}`;
};

function pack(vectors: number[][]): Packed {
  const dim = vectors[0]?.length ?? 0;
  const f = new Float32Array(vectors.length * dim);
  vectors.forEach((v, i) => f.set(v, i * dim));
  const bytes = new Uint8Array(f.buffer);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { dim, n: vectors.length, f32: btoa(bin) };
}

function unpack(p: Packed, expect: number): number[][] | null {
  if (!p || p.n !== expect || !p.dim || typeof p.f32 !== "string") return null;
  const bin = atob(p.f32);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  if (bytes.length !== p.n * p.dim * 4) return null;
  const f = new Float32Array(bytes.buffer);
  return Array.from({ length: p.n }, (_, i) => Array.from(f.subarray(i * p.dim, (i + 1) * p.dim)));
}

/** The menu's vectors: memory, else the saved copy for this menu version, else ONE embedding call (saved afterwards). Concurrent callers share it. */
export function menuVectors(deps: AgentDeps, menu: MenuItem[], tool = "menu_match"): Promise<MenuVectors> {
  const s = stateOf(deps);
  const key = `${KEY}${menuVersion(menu)}`;
  const known = s.menus.get(key);
  if (known) return known.then((r) => ({ ...r, source: r.source === "embedded" ? "memory" : r.source }));
  const work = (async (): Promise<MenuVectors> => {
    const saved = await deps.repo.cacheGet<Packed>(key).catch(() => null);
    const hit = saved ? unpack(saved, menu.length) : null;
    if (hit) return { vectors: hit, mode: "cache", source: "kv" };
    const res = await meteredEmbed(deps, menu.map(menuItemText), tool);
    await deps.repo.cachePut(key, pack(res.vectors), MENU_TTL_SECONDS).catch((e: unknown) => log.warn("menu embeddings not saved", { err: (e as Error)?.name }));
    return { vectors: res.vectors, mode: res.mode, source: "embedded" };
  })();
  s.menus.set(key, work);
  // A failed attempt is not remembered: the next caller tries again.
  work.catch(() => { if (s.menus.get(key) === work) s.menus.delete(key); });
  return work;
}

/** The tags' vectors in ONE batch (only the ones not seen before in this isolate); a batch already under way is joined. */
export async function tagVectors(deps: AgentDeps, texts: string[], tool = "menu_match"): Promise<{ vectors: number[][]; mode: Mode }> {
  const s = stateOf(deps);
  const keyOf = (t: string) => fnv(t);
  const missing = [...new Set(texts.filter((t) => !s.tags.has(keyOf(t))))];
  let mode: Mode = "cache";
  if (missing.length) {
    const id = missing.map(keyOf).join(",");
    let batch = s.tagBatches.get(id);
    if (!batch) {
      batch = meteredEmbed(deps, missing, tool).then((res) => {
        mode = res.mode;
        missing.forEach((t, i) => s.tags.set(keyOf(t), res.vectors[i]));
      });
      s.tagBatches.set(id, batch);
      batch.then(() => s.tagBatches.delete(id), () => s.tagBatches.delete(id));
    }
    await batch;
  }
  return { vectors: texts.map((t) => s.tags.get(keyOf(t)) ?? []), mode };
}

/** Embeds the menu ahead of the first store (never throws; a failure just leaves the first `menu_match` to do it). */
export async function warmMenuEmbeddings(deps: AgentDeps, menu: MenuItem[]): Promise<MenuVectors | null> {
  if (!menu.length) return null;
  try {
    return await menuVectors(deps, menu, "menu_warm");
  } catch (e) {
    log.warn("menu embeddings not warmed", { err: (e as Error)?.name });
    return null;
  }
}
