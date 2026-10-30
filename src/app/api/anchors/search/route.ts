import { routes } from "@/contract";
import { wsRoute } from "@/server/handlers/ws";
import { ipLimited, rateLimit } from "@/server/limits";
import { ANCHOR_SEARCH_LIMITS } from "@/server/limits-table";
import { searchAnchorsGuarded } from "@/server/qloo/anchor-search";

/**
 * GET /api/anchors/search?q=: cache-first (a saved real answer costs nothing), at most 3 live Qloo searches per workspace a day on top
 * of the app-wide ledger. When no live search is allowed, or Qloo cannot answer, it fails with `qloo_budget` or `qloo_unavailable`
 * (never with suggested brands). It also needs the workspace cookie and is rate limited per IP (before anything else) and per workspace.
 */
const search = wsRoute(routes.searchAnchors, async ({ query }, ctx) => {
  await rateLimit({ key: `anchors:ws:${ctx.workspace.id}`, ...ANCHOR_SEARCH_LIMITS.workspace });
  return searchAnchorsGuarded(ctx.repo, ctx.workspace.id, query.q);
});

export const GET = ipLimited({ name: "anchors", ...ANCHOR_SEARCH_LIMITS.ip }, search);
