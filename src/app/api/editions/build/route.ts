import { buildRoute } from "@/server/agent/handlers";
import { useWorkflow } from "@/server/workflows/mode";
import { workflowBuildRoute } from "@/server/workflows/route";

export const dynamic = "force-dynamic";

/** Production: start the EditionBuild Workflow and tail its D1 progress. Dev and tests: build inline. */
export const POST: typeof buildRoute = (request, args) => (useWorkflow() ? workflowBuildRoute : buildRoute)(request, args);
