import { z } from "zod";

/** Workflow params, validated at the boundary before a run starts. */
export const BuildWorkflowParams = z.object({
  runId: z.string().min(1).max(64),
  workspaceId: z.string().min(1).max(64),
  storeIds: z.array(z.string().min(1).max(64)).max(50).optional(),
  force: z.boolean().optional(),
  weekOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  /** `cron` marks the WeeklyRebuild entry: it records a JobRun (certification is a separate on-demand CLI run, not started from here). */
  trigger: z.enum(["request", "cron"]).default("request"),
});
export type BuildWorkflowParams = z.infer<typeof BuildWorkflowParams>;

/** What a caller passes to `create()` (`trigger` may be omitted). */
export type BuildWorkflowInput = z.input<typeof BuildWorkflowParams>;
