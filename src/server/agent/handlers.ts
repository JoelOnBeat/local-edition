import { routes } from "@/contract";
import { HttpError } from "../http/errors";
import type { AgentEvent } from "@/contract";
import { sseResponse } from "../http/sse";
import { runInBackground } from "../jobs/background";
import { limitSpend } from "../handlers/limit";
import { buildSpec } from "../handlers/specs";
import { wsRoute } from "../handlers/ws";
import { reapStaleDrafts } from "../store/reaper";
import { acquireBuildLock, releaseBuildLock } from "./build-lock";
import { getOrCreateCard } from "./card";
import { buildEditions } from "./build";
import { getAgentDeps } from "./deps";
import { regenerateItem } from "./regenerate";
import { reviewEditions } from "./review";
import { loadEditionAccess } from "./workspace";

/** The inline build's `run_done` starts the Slack head-office digest in the background (the Workflow does the same in its own step). */
async function* digestWhenDone(events: AsyncGenerator<AgentEvent>, workspaceId: string): AsyncGenerator<AgentEvent> {
  for await (const e of events) {
    if (e.type === "run_done" && e.editionIds.length) {
      runInBackground(import("../connectors/slack/after-build").then((m) => m.postDigestAfterBuild(workspaceId, e.editionIds)));
    }
    yield e;
  }
}

/**
 * POST /api/editions/build: SSE of AgentEvent. Bad store ids, the rate limit and a build already running
 * for this workspace (409 `build_running`) all fail with a status before the stream opens.
 */
export const buildRoute = wsRoute(buildSpec, async ({ body }, ctx) => {
  const stores = await ctx.repo.listStores(ctx.workspace.chainId);
  if (!stores.length) throw new HttpError(409, "no_stores", "Add a store before building an edition.");
  // A new account starts with no taste anchors; Qloo has nothing to compare a block against until it has some.
  if (!(await ctx.repo.getChain(ctx.workspace.chainId))?.anchors.length) throw new HttpError(409, "no_anchors", "Pick at least one taste anchor before building an edition.");
  const unknown = body.storeIds?.filter((id) => !stores.some((s) => s.id === id)) ?? [];
  if (unknown.length) throw new HttpError(404, "unknown_store", "One of those stores does not exist.");
  await limitSpend(ctx, "build");
  const deps = await getAgentDeps();
  const lock = await acquireBuildLock(ctx.repo, ctx.workspace.id);
  try {
    // buildEditions releases the lock when the stream ends or the client leaves.
    const events = digestWhenDone(buildEditions({ workspaceId: ctx.workspace.id, storeIds: body.storeIds, force: body.force, lock }, deps), ctx.workspace.id);
    return sseResponse(events, { signal: ctx.request.signal });
  } catch (e) {
    await releaseBuildLock(ctx.repo, lock);
    throw e;
  }
});

/** POST /api/editions/:id/items/:itemId/regenerate: SSE of AgentEvent for one rewritten item. */
export const regenerateRoute = wsRoute(routes.regenerateItem, async ({ params, body }, ctx) => {
  const { edition: stored } = await loadEditionAccess(ctx.repo, ctx.workspace.id, params.id);
  const [edition] = await reapStaleDrafts(ctx.repo, [stored]);
  if (edition.status === "drafting") throw new HttpError(409, "edition_drafting", "This edition is still being built.");
  if (!edition.items.some((i) => i.id === params.itemId)) throw new HttpError(404, "item_not_found", "That item does not exist in this edition.");
  await limitSpend(ctx, "regenerate");
  const deps = await getAgentDeps();
  const events = regenerateItem({ workspaceId: ctx.workspace.id, editionId: params.id, itemId: params.itemId, hint: body.hint }, deps);
  return sseResponse(events, { signal: ctx.request.signal });
});

/**
 * POST /api/editions/review: SSE of AgentEvent, one `review` per store from the Ultra reviewer. It spends one
 * Ultra call, so it shares the regenerate allowance (there is no `review` bucket in handlers/limit.ts).
 */
export const reviewRoute = wsRoute(routes.reviewEditions, async ({ body }, ctx) => {
  await limitSpend(ctx, "regenerate");
  const deps = await getAgentDeps();
  const events = reviewEditions({ workspaceId: ctx.workspace.id, weekOf: body.weekOf }, deps);
  return sseResponse(events, { signal: ctx.request.signal });
});

/** GET /api/editions/:id/card: the staff card, written on first request (rate limited: it costs a model call). */
export const cardRoute = wsRoute(routes.getCard, async ({ params }, ctx) => {
  const { edition } = await loadEditionAccess(ctx.repo, ctx.workspace.id, params.id);
  const existing = await ctx.repo.getStaffCardByEdition(edition.id);
  if (!existing?.lines.length) await limitSpend(ctx, "card");
  return getOrCreateCard(await getAgentDeps(), ctx.workspace.id, params.id);
});
