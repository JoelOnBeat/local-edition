import { z } from "zod";

/**
 * One Slack "Regenerate" click, run as a Workflow (a Worker's `waitUntil` allows about 30 s; a regenerate can take longer).
 * It carries what the finishing steps need to update the digest message and to release the click's claim on failure.
 */
export const SlackRegenerateJob = z.object({
  editionId: z.string().min(1).max(64),
  itemId: z.string().min(1).max(64),
  userId: z.string().min(1).max(40),
  atUnix: z.number().int().nonnegative(),
  responseUrl: z.string().url().max(500).optional(),
  claimKey: z.string().min(1).max(200),
});
export type SlackRegenerateJob = z.infer<typeof SlackRegenerateJob>;

/** Workflow params, validated at the boundary before a run starts. */
export const BuildWorkflowParams = z.object({
  runId: z.string().min(1).max(64),
  workspaceId: z.string().min(1).max(64),
  storeIds: z.array(z.string().min(1).max(64)).max(50).optional(),
  force: z.boolean().optional(),
  weekOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  /** `cron` marks the WeeklyRebuild entry: it records a JobRun (certification is a separate on-demand CLI run, not started from here). */
  trigger: z.enum(["request", "cron"]).default("request"),
  /** Present: this instance regenerates one item for a Slack click instead of building editions. */
  regenerate: SlackRegenerateJob.optional(),
});
export type BuildWorkflowParams = z.infer<typeof BuildWorkflowParams>;

/** What a caller passes to `create()` (`trigger` may be omitted). */
export type BuildWorkflowInput = z.input<typeof BuildWorkflowParams>;
