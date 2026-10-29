import { z } from "zod";
import { newId } from "@/lib/ids";
import { HttpError } from "../http/errors";
import { limitSpend } from "../handlers/limit";
import { buildSpec } from "../handlers/specs";
import { wsRoute } from "../handlers/ws";
import { platformEnvSync } from "../platform/env";
import { RunLog } from "./run-log";
import { tailRun } from "./tail";
import { BuildWorkflowParams } from "./types";

const LastEventId = z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

/**
 * POST /api/editions/build in production: starts the EditionBuild Workflow and streams its progress by
 * tailing the D1 event log (`: open` at once, a heartbeat every 15 s). Same validation and errors as the
 * in-process route. A request with `Last-Event-ID` re-attaches to the workspace's latest run instead of
 * starting one, so a dropped connection replays what it missed and a refresh never double-builds.
 */
export const workflowBuildRoute = wsRoute(buildSpec, async ({ body }, ctx) => {
  const env = platformEnvSync();
  if (!env?.LE_DB || !env.EDITION_BUILD) throw new HttpError(503, "workflow_unavailable", "Builds are not available right now.");
  const runLog = new RunLog(env.LE_DB);
  const workspaceId = ctx.workspace.id;

  const lastEventId = ctx.request.headers.get("last-event-id");
  if (lastEventId !== null) {
    const after = LastEventId.safeParse(lastEventId);
    const latest = after.success ? await runLog.latestFor(workspaceId) : null;
    if (after.success && latest) return tailRun({ runLog, runId: latest.id, afterSeq: after.data, signal: ctx.request.signal });
  }

  const stores = await ctx.repo.listStores(ctx.workspace.chainId);
  if (!stores.length) throw new HttpError(409, "no_stores", "Add a store before building an edition.");
  const unknown = body.storeIds?.filter((id) => !stores.some((s) => s.id === id)) ?? [];
  if (unknown.length) throw new HttpError(404, "unknown_store", "One of those stores does not exist.");
  await limitSpend(ctx, "build");

  const runId = newId("run");
  const total = body.storeIds?.length ?? stores.length;
  if (!(await runLog.start(runId, workspaceId, total))) throw new HttpError(409, "build_running", "A build is already running for this workspace. Wait for it to finish.");
  try {
    const params = BuildWorkflowParams.parse({ runId, workspaceId, storeIds: body.storeIds, force: body.force, trigger: "request" });
    await env.EDITION_BUILD.create({ id: runId, params });
  } catch {
    await runLog.finish(runId, "failed");
    throw new HttpError(503, "workflow_unavailable", "Could not start the build. Try again.");
  }
  return tailRun({ runLog, runId, signal: ctx.request.signal });
});
