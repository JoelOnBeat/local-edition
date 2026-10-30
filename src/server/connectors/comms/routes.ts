import { z } from "zod";
import { commsRoutes, type CommsRouteSpec } from "@/contract/connectors-comms";
import { HttpError } from "../../http/errors";
import { wsRoute } from "../../handlers/ws";
import type { RouteSpec } from "@/contract";
import { liveCommsDeps, type CommsDeps } from "./deps";
import { buildCommsState } from "./state";
import { postDigest } from "../slack/digest";
import { installUrl } from "../slack/install";
import { pollReplies } from "../mail/poll";
import { startMailConnect } from "../mail/connect";
import { ComposioClient } from "../mail/composio";

/** Cookie-authenticated handlers for the comms routes: `wsRoute` supplies the workspace, validation and `{ error, code }` errors. */

const asSpec = (spec: CommsRouteSpec, bodyKind: RouteSpec["bodyKind"]): RouteSpec => ({ ...spec, stream: "E", bodyKind, sse: false });

function route<S extends CommsRouteSpec, R>(spec: S, bodyKind: RouteSpec["bodyKind"], handler: (input: z.output<S["request"]>, ctx: { workspaceId: string }, deps: CommsDeps) => Promise<R | Response>) {
  return wsRoute(asSpec(spec, bodyKind), async (input, ctx) => handler(input as z.output<S["request"]>, { workspaceId: ctx.workspace.id }, await liveCommsDeps()));
}

const redirect = (location: string): Response => new Response(null, { status: 302, headers: { location, "cache-control": "no-store" } });

export const getComms = route(commsRoutes.getComms, "none", (_in, { workspaceId }, deps) => buildCommsState(deps, workspaceId));

export const putTargets = route(commsRoutes.putTargets, "json", async ({ body }, { workspaceId }, deps) => {
  const workspace = await deps.repo.getWorkspace(workspaceId);
  const stores = workspace ? await deps.repo.listStores(workspace.chainId) : [];
  const known = new Set(stores.map((s) => s.id));
  if (body.targets.some((t) => !known.has(t.storeId))) throw new HttpError(404, "unknown_store", "One of those stores does not exist.");
  await deps.store.putTargets(workspaceId, body.targets, deps.now().toISOString());
  return { targets: await deps.store.listTargets(workspaceId) };
});

export const slackInstall = route(commsRoutes.slackInstall, "none", async (_in, { workspaceId }, deps) => redirect(await installUrl(deps, workspaceId)));

export const postSlackDigest = route(commsRoutes.postDigest, "json", ({ body }, { workspaceId }, deps) => postDigest(deps, workspaceId, body.editionIds));

export const mailConnect = route(commsRoutes.mailConnect, "json", async ({ body }, { workspaceId }, deps) => ({ redirectUrl: await startMailConnect(deps, workspaceId, body.provider) }));

export const mailPoll = route(commsRoutes.mailPoll, "none", (_in, { workspaceId }, deps) => pollReplies(deps, workspaceId));

export const patchSuggestion = route(commsRoutes.patchSuggestion, "json", async ({ params, body }, { workspaceId }, deps) => {
  const found = await deps.store.getSuggestion(workspaceId, params.id);
  if (!found) throw new HttpError(404, "not_found", "That suggestion does not exist.");
  const next = { ...found, status: body.status };
  await deps.store.putSuggestion(workspaceId, next);
  return next;
});

export const disconnect = route(commsRoutes.disconnect, "none", async ({ params }, { workspaceId }, deps) => {
  if (params.provider === "slack") {
    await deps.store.deleteSlackInstall(workspaceId);
    return { ok: true };
  }
  const row = await deps.store.getMailConn(workspaceId, params.provider);
  if (row) {
    await new ComposioClient(deps.env.composioApiKey, deps.fetchImpl).deleteAccount(row.connectedAccountId).catch(() => undefined); // best effort: our row goes either way
    await deps.store.deleteMailConn(workspaceId, params.provider);
  }
  return { ok: true };
});
