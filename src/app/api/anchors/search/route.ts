import { routes } from "@/contract";
import { wsRoute } from "@/server/handlers/ws";
import { ipLimited, rateLimit } from "@/server/limits";
import { searchBrands } from "@/server/qloo";

/**
 * GET /api/anchors/search?q=: a Qloo lookup per request, so it needs the workspace cookie and is rate limited
 * per IP (before anything else) and per workspace. Varying `q` always misses the cache, so the limit is the
 * only thing between a script and the hackathon key's quota.
 */
const search = wsRoute(routes.searchAnchors, async ({ query }, { workspace }) => {
  await rateLimit({ key: `anchors:ws:${workspace.id}`, capacity: 30, refillPerMinute: 30 });
  return searchBrands(query.q);
});

export const GET = ipLimited({ name: "anchors", capacity: 60, refillPerMinute: 60 }, search);
