import { RUN_ID_HEADER } from "@/contract";
import { buildRoute } from "@/server/agent/handlers";
import { apiError } from "@/server/http/api";
import { useWorkflow } from "@/server/workflows/mode";
import { workflowBuildRoute } from "@/server/workflows/route";

export const dynamic = "force-dynamic";

/**
 * Production: start the EditionBuild Workflow and tail its D1 progress. Dev and tests: build inline. In-process builds keep no
 * run log, so a request to replay a named run must never start a build: it is a plain 404.
 */
export const POST: typeof buildRoute = (request, args) => {
  if (useWorkflow()) return workflowBuildRoute(request, args);
  if (request.headers.has(RUN_ID_HEADER)) return Promise.resolve(apiError(404, "run_not_found", "This server keeps no run log to replay."));
  return buildRoute(request, args);
};
