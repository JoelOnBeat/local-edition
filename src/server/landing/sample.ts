import type { BlockTag, Chain, Edition, EditionItem, Store } from "@/contract";
import { createLogger } from "../log";
import { createQlooClient } from "../qloo/client";
import { computeBlock } from "../qloo/block";
import { repoCache } from "../qloo/deps";
import { seedableEditions } from "../sample/live-editions";
import { DEMO_WORKSPACE_ID, getRepo } from "../store";
import type { Repo } from "../store/repo";
import type { LandingFeatured, LandingGuardrail, LandingSample, LandingStoreRow, LandingTag } from "./types";

const log = createLogger("landing");

/** The landing's read of the demo workspace is saved for ten minutes: a public page view never rebuilds it. */
export const LANDING_CACHE_KEY = "landing:sample:v1";
export const LANDING_TTL_SECONDS = 600;
const FEATURED_STORE = "store_williamsburg";
const DONE = new Set(["approved", "edited"]);

const tagOf = (t: BlockTag): LandingTag => ({ name: t.name, affinity: t.affinity, lift: t.lift });
const byLift = (a: BlockTag, b: BlockTag) => b.lift - a.lift || b.affinity - a.affinity;

function itemText(i: EditionItem): string {
  switch (i.kind) {
    case "special": return i.description;
    case "sound": return i.brief;
    case "partner": return i.reason;
    case "event": return i.description;
  }
}

function guardrailOf(stores: Store[], editions: Edition[]): LandingGuardrail | null {
  for (const e of editions) {
    const hit = e.items.find((i) => i.guardrail.status === "rewritten" && i.guardrail.original);
    if (!hit) continue;
    const reason = hit.guardrail.reasons[0] ?? "The line was rewritten before anyone saw it.";
    return {
      store: stores.find((s) => s.id === e.storeId)?.name ?? "A store",
      before: hit.guardrail.original!,
      after: itemText(hit),
      rail: hit.guardrail.rail ?? "guardrails",
      reason,
    };
  }
  return null;
}

/** Block tags for one store, read ONLY from saved real Qloo answers: a public page view never makes a live call or spends a credit. */
async function savedTags(repo: Repo, store: Store, chain: Chain): Promise<BlockTag[] | null> {
  try {
    const client = createQlooClient({ cacheOnly: true });
    const { profile } = await computeBlock(store, chain, { client, cache: repoCache(repo) });
    return [...profile.tags].sort(byLift);
  } catch (e) {
    log.warn("block tags not readable from saved answers", { store: store.id, code: (e as { code?: string }).code });
    return null;
  }
}

function featuredOf(store: Store, edition: Edition, tags: BlockTag[] | null): LandingFeatured {
  const sp = edition.items.find((i) => i.kind === "special");
  const so = edition.items.find((i) => i.kind === "sound");
  const pa = edition.items.find((i) => i.kind === "partner");
  const ev = edition.items.find((i) => i.kind === "event");
  return {
    name: store.name,
    address: store.addressLabel,
    colorIndex: store.colorIndex,
    tags: (tags ?? []).slice(0, 4).map(tagOf),
    special: sp?.kind === "special" ? { name: sp.name, description: sp.description, flavourTags: sp.flavourTags } : null,
    sound: so?.kind === "sound" ? { mood: so.mood, brief: so.brief, artists: so.artists.slice(0, 3).map((a) => a.name) } : null,
    partner: pa?.kind === "partner" ? { name: pa.place.name, reason: pa.reason, offerIdea: pa.offerIdea, distanceM: pa.place.distanceM } : null,
    event: ev?.kind === "event" ? { title: ev.title, when: `${ev.day} ${ev.time}`, description: ev.description } : null,
  };
}

/** Reads the canonical demo workspace: its stores, their newest editions built from live Qloo answers, and each block's saved taste tags. */
export async function readLandingSample(repo: Repo): Promise<LandingSample | null> {
  const demo = await repo.getWorkspace(DEMO_WORKSPACE_ID);
  const chain = demo && (await repo.getChain(demo.chainId));
  if (!demo || !chain) return null;
  const stores = (await repo.listStores(chain.id)).sort((a, b) => a.colorIndex - b.colorIndex);
  const editions = seedableEditions(await repo.listEditions({ storeIds: stores.map((s) => s.id), finishedOnly: true }));
  if (!editions.length) return null;
  const byStore = new Map(editions.map((e) => [e.storeId, e]));

  const tags = new Map<string, BlockTag[] | null>();
  await Promise.all(stores.map(async (s) => { if (byStore.has(s.id)) tags.set(s.id, await savedTags(repo, s, chain)); }));

  const rows: LandingStoreRow[] = stores.map((s) => {
    const ed = byStore.get(s.id);
    const top = tags.get(s.id)?.[0];
    const sp = ed?.items.find((i) => i.kind === "special");
    return {
      id: s.id,
      name: s.name,
      address: s.addressLabel,
      colorIndex: s.colorIndex,
      status: !ed ? "none" : ed.status === "flagged" ? "flagged" : ed.status === "approved" ? "approved" : "draft",
      special: sp?.kind === "special" ? sp.name : "",
      approved: ed ? ed.items.filter((i) => DONE.has(i.status)).length : 0,
      total: ed?.items.length ?? 0,
      topTag: top ? tagOf(top) : null,
    };
  });
  const star = stores.find((s) => s.id === FEATURED_STORE && byStore.has(s.id)) ?? stores.find((s) => byStore.has(s.id))!;
  return {
    weekOf: byStore.get(star.id)!.weekOf,
    readAt: new Date().toISOString(),
    rows,
    featured: featuredOf(star, byStore.get(star.id)!, tags.get(star.id) ?? null),
    guardrail: guardrailOf(stores, editions),
  };
}

/** The landing's data: the saved view if fresh, else a new read (saved for ten minutes). Null when the demo workspace has nothing live to show. Never throws. */
export async function landingSample(): Promise<LandingSample | null> {
  try {
    const repo = await getRepo();
    const saved = await repo.cacheGet<LandingSample>(LANDING_CACHE_KEY).catch(() => null);
    if (saved) return saved;
    const fresh = await readLandingSample(repo);
    if (fresh) await repo.cachePut(LANDING_CACHE_KEY, fresh, LANDING_TTL_SECONDS).catch(() => undefined);
    return fresh;
  } catch (e) {
    log.warn("landing sample unavailable", { err: e });
    return null;
  }
}
