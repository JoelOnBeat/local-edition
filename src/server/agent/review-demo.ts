import { createLogger } from "../log";
import { DEMO_WORKSPACE_ID } from "../session";
import type { AgentDeps } from "./ports";
import { reviewEditions } from "./review";

const log = createLogger("agent:review-demo");

export interface DemoReviewOutcome {
  /** Verdicts saved on the demo workspace's editions. */
  reviewed: number;
  /** The review ended with an error event (a skipped model, a spend cap, a bad answer); the editions stay unreviewed. */
  stopped: string | null;
}

/**
 * The last step of a demo-workspace build: Nemotron 3 Ultra reads the week's editions side by side and each verdict is saved on its
 * edition. New sample workspaces copy those editions (`createVisitorWorkspace`), so a judge opening the sample finds real reviewer
 * notes rather than "not read yet". It never throws and never rewrites a verdict: a failure leaves the editions as the build made them.
 */
export async function reviewDemoWorkspace(deps: AgentDeps, workspaceId: string = DEMO_WORKSPACE_ID): Promise<DemoReviewOutcome> {
  const out: DemoReviewOutcome = { reviewed: 0, stopped: null };
  try {
    for await (const e of reviewEditions({ workspaceId }, deps)) {
      if (e.type === "review") out.reviewed++;
      else if (e.type === "error" && e.code !== "review_missing") out.stopped = e.code;
    }
  } catch (e) {
    out.stopped = "review_crashed";
    log.warn("demo review failed; the editions stay unreviewed", { err: (e as Error)?.name });
  }
  return out;
}
