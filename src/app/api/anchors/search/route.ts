import { routes } from "@/contract";
import { wsRoute } from "@/server/handlers/ws";
import { ipLimited, rateLimit } from "@/server/limits";
import { ANCHOR_SEARCH_LIMITS } from "@/server/limits-table";
import { QLOO_BUDGET_CODE, searchAnchorsGuarded } from "@/server/qloo/anchor-search";

/**
 * GET /api/anchors/search?q=: cache-first (a saved answer costs nothing), at most 3 live Qloo searches per workspace a day on top
 * of the app-wide ledger, and suggested brands with `x-le-code: qloo_budget` when no live search is allowed. It also needs the
 * workspace cookie and is rate limited per IP (before anything else) and per workspace.
 */
const search = wsRoute(routes.searchAnchors, async ({ query }, ctx) => {
  await rateLimit({ key: `anchors:ws:${ctx.workspace.id}`, ...ANCHOR_SEARCH_LIMITS.workspace });
  const { refs, code } = await searchAnchorsGuarded(ctx.repo, ctx.workspace.id, query.q);
  // Suggested brands, not a Qloo answer: the picker still works, and the header says why.
  return code ? Response.json(refs, { headers: { "x-le-code": QLOO_BUDGET_CODE } }) : refs;
});

export const GET = ipLimited({ name: "anchors", ...ANCHOR_SEARCH_LIMITS.ip }, search);
