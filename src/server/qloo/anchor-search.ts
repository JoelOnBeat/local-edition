import type { QlooEntityRef } from "@/contract";
import { suggestAnchors } from "@/lib/anchor-suggestions";
import { UpstreamError } from "../http/errors";
import { serial } from "../serial";
import type { Repo } from "../store/repo";
import { brandSearchKey, searchBrands } from "./anchors";
import { repoCache, resolveDeps, type QlooDeps } from "./deps";

/**
 * Brand search for the setup page, built so a visitor's typing cannot spend the hackathon key's Qloo credits:
 *  1. a saved answer (KV, two weeks) is always served first and costs nothing;
 *  2. only a miss may go live, and only while the workspace has live searches left today (3), on top of the app-wide ledger
 *     (300 total, 40 a day) the client checks before every live call;
 *  3. otherwise, or when the ledger refuses, the answer is suggested brands with `code: "qloo_budget"`. Nothing is called.
 * Replay and fixture runs make no live call and are not counted.
 */
export const LIVE_SEARCHES_PER_WORKSPACE_PER_DAY = 3;
export const QLOO_BUDGET_CODE = "qloo_budget";

export interface AnchorSearchResult {
  refs: QlooEntityRef[];
  /** `qloo_budget` when the refs are suggestions because no live search was allowed. */
  code: typeof QLOO_BUDGET_CODE | null;
}

const dayOf = (d: Date) => d.toISOString().slice(0, 10);
const counterKey = (workspaceId: string, now: Date) => `qloo:anchors:live:${workspaceId}:${dayOf(now)}`;

/** Takes one of the workspace's live searches for today; false when they are used up. Best effort across isolates (the ledger is the hard cap). */
async function takeLiveSearch(repo: Pick<Repo, "cacheGet" | "cachePut">, workspaceId: string, now: Date): Promise<boolean> {
  const key = counterKey(workspaceId, now);
  return serial(key, async () => {
    const used = (await repo.cacheGet<{ n: number }>(key))?.n ?? 0;
    if (used >= LIVE_SEARCHES_PER_WORKSPACE_PER_DAY) return false;
    await repo.cachePut(key, { n: used + 1 }, 2 * 24 * 3600);
    return true;
  });
}

export async function searchAnchorsGuarded(
  repo: Pick<Repo, "cacheGet" | "cachePut">,
  workspaceId: string,
  q: string,
  partial: Partial<QlooDeps> = {},
): Promise<AnchorSearchResult> {
  const deps = resolveDeps({ ...partial, cache: partial.cache ?? repoCache(repo) });
  const saved = await deps.cache.get<QlooEntityRef[]>(brandSearchKey(q));
  if (saved) return { refs: saved, code: null };
  if (deps.client.mode === "live" && !(await takeLiveSearch(repo, workspaceId, deps.now()))) {
    return { refs: suggestAnchors(q), code: QLOO_BUDGET_CODE };
  }
  try {
    return { refs: await searchBrands(q, deps), code: null };
  } catch (e) {
    if (e instanceof UpstreamError && e.code === "spend_cap") return { refs: suggestAnchors(q), code: QLOO_BUDGET_CODE };
    throw e;
  }
}
