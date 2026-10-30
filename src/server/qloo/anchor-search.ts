import type { QlooEntityRef } from "@/contract";
import { HttpError } from "../http/errors";
import { serial } from "../serial";
import type { Repo } from "../store/repo";
import { brandSearchKey, searchBrands } from "./anchors";
import { repoCache, resolveDeps, type QlooDeps } from "./deps";

/**
 * Brand search for the setup page, built so a visitor's typing cannot spend the hackathon key's Qloo credits:
 *  1. a saved answer (KV, two weeks, real Qloo answers only) is always served first and costs nothing;
 *  2. only a miss may go live, and only while the workspace has live searches left today (3), on top of the app-wide ledger
 *     (2,000 total, 200 a day) the client checks before every live call;
 *  3. otherwise the search fails with `qloo_budget` (or `qloo_unavailable` when Qloo cannot answer) and the page says so with a retry.
 *     No suggested or sample brands stand in for a Qloo answer.
 */
export const LIVE_SEARCHES_PER_WORKSPACE_PER_DAY = 3;
export const QLOO_BUDGET_CODE = "qloo_budget";

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
): Promise<QlooEntityRef[]> {
  const deps = resolveDeps({ ...partial, cache: partial.cache ?? repoCache(repo) });
  const saved = await deps.cache.get<QlooEntityRef[]>(brandSearchKey(q));
  if (saved) return saved;
  if (deps.client.mode === "live" && !(await takeLiveSearch(repo, workspaceId, deps.now()))) {
    throw new HttpError(429, QLOO_BUDGET_CODE, `This workspace has used its ${LIVE_SEARCHES_PER_WORKSPACE_PER_DAY} live Qloo searches for today. Searches you have already made still work. Try again tomorrow.`);
  }
  return searchBrands(q, deps);
}
