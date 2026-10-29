import { routes } from "@/contract";
import { HttpError } from "../http/errors";
import { sseResponse } from "../http/sse";
import { wsRoute } from "../handlers/ws";
import { getOrCreateCard } from "./card";
import { buildEditions } from "./build";
import { getAgentDeps } from "./deps";
import { regenerateItem } from "./regenerate";
import { loadEditionAccess } from "./workspace";

/** POST /api/editions/build: SSE of AgentEvent. Bad store ids fail with a status before the stream opens. */
export const buildRoute = wsRoute(routes.buildEditions, async ({ body }, ctx) => {
  const stores = await ctx.repo.listStores(ctx.workspace.chainId);
  if (!stores.length) throw new HttpError(409, "no_stores", "Add a store before building an edition.");
  const unknown = body.storeIds?.filter((id) => !stores.some((s) => s.id === id)) ?? [];
  if (unknown.length) throw new HttpError(404, "unknown_store", "One of those stores does not exist.");
  const deps = await getAgentDeps();
  return sseResponse(buildEditions({ workspaceId: ctx.workspace.id, storeIds: body.storeIds }, deps), { signal: ctx.request.signal });
});

/** POST /api/editions/:id/items/:itemId/regenerate: SSE of AgentEvent for one rewritten item. */
export const regenerateRoute = wsRoute(routes.regenerateItem, async ({ params, body }, ctx) => {
  const { edition } = await loadEditionAccess(ctx.repo, ctx.workspace.id, params.id);
  if (edition.status === "drafting") throw new HttpError(409, "edition_drafting", "This edition is still being built.");
  if (!edition.items.some((i) => i.id === params.itemId)) throw new HttpError(404, "item_not_found", "That item does not exist in this edition.");
  const deps = await getAgentDeps();
  const events = regenerateItem({ workspaceId: ctx.workspace.id, editionId: params.id, itemId: params.itemId, hint: body.hint }, deps);
  return sseResponse(events, { signal: ctx.request.signal });
});

/** GET /api/editions/:id/card: the staff card, written on first request. */
export const cardRoute = wsRoute(routes.getCard, async ({ params }, ctx) => getOrCreateCard(await getAgentDeps(), ctx.workspace.id, params.id));
