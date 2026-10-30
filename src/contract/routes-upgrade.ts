import { z } from "zod";
import { Chain, Evidence, GuardrailResult, JobRun, isoDate } from "./domain";
import { AgentEvent } from "./events";
import type { RouteSpec } from "./route-spec";
import { EvalResult } from "./upgrade";

/** Routes the upgrade adds (docs/CONTRACT.md, "Upgrade contract"). Spread into `routes` by routes.ts. */

const id = z.string().min(1).max(64);
/** HMAC-SHA256 (hex) of the raw request body (empty for GET), keyed by LE_JOB_SECRET. Same header as /api/jobs/monday. */
const signed = z.object({ "x-le-signature": z.string().min(1).max(200) });
/** Most results one certify or eval post may carry. */
export const MAX_JOB_RESULTS = 500;

/** One pipeline step and the model that runs it, from the server's model table (not copied into the page). */
export const ProofStep = z.object({
  step: z.string().min(1).max(80),
  model: z.string().min(1).max(120),
  does: z.string().min(1).max(300),
  /** Set when the step was last skipped because its model was unavailable on Token Factory (a 404), and has not answered since. */
  skipped: z.object({ at: z.iso.datetime({ offset: true }), note: z.string().min(1).max(300) }).optional(),
});
export type ProofStep = z.infer<typeof ProofStep>;

/** The Ultra reviewer's verdict on one store's edition. */
export const ProofReview = z.object({
  storeId: id,
  storeName: z.string().max(80),
  colorIndex: z.number().int().min(1).max(8),
  verdict: z.enum(["approve", "needs_change"]),
  reason: z.string().max(600),
  hint: z.string().max(400).nullable(),
  reviewedBy: z.string().max(120),
  /** When the reviewer read this edition. */
  reviewedAt: z.iso.datetime({ offset: true }),
});
export type ProofReview = z.infer<typeof ProofReview>;

export const ProofResponse = z.object({
  jobRuns: z.array(JobRun),
  eval: EvalResult.nullable(),
  /** sha256 of the certify script that last ran; null when no job has run. */
  scriptSha: z.string().min(7).max(64).nullable(),
  /** Git commit the deployed Worker was built from; null in local dev. */
  gitSha: z.string().min(7).max(64).nullable(),
  /** Average dollars per finished edition; null until a build has recorded its model calls. */
  spendPerEditionUsd: z.number().nonnegative().nullable(),
  /** Share of prompt tokens served from the provider's prefix cache, 0..1. */
  cachedRatio: z.number().min(0).max(1).nullable(),
  /** Which model runs each step. */
  steps: z.array(ProofStep).max(20),
  /** Models the public (demo) editions name as having run, so the page can mark the steps it has evidence for. */
  seenModels: z.array(z.string().max(120)).max(20),
  /** Editions the reviewer and the counts below were read from. */
  editionCount: z.number().int().nonnegative(),
  reviews: z.array(ProofReview).max(100),
  /** True when the editions above belong to the sample chain (the demo workspace or a visitor's sample), whose review is one shared read. */
  sample: z.boolean(),
});
export type ProofResponse = z.infer<typeof ProofResponse>;

/** A counter against a hard total and a daily slice (Tavily credits, Qloo calls). */
export const BudgetUsage = z.object({
  used: z.number().int().nonnegative(),
  cap: z.number().int().positive(),
  dailyUsed: z.number().int().nonnegative(),
  dailyCap: z.number().int().positive(),
});
export type BudgetUsage = z.infer<typeof BudgetUsage>;

/** A burst, then a steady refill per minute: "4, then 1 a minute". */
export const RateLimitRow = z.object({ action: z.string().max(80), workspace: z.string().max(80), ip: z.string().max(80) });
export type RateLimitRow = z.infer<typeof RateLimitRow>;

export const LimitsResponse = z.object({
  droppedForEvidence: z.number().int().nonnegative(),
  guardrailBlocks: z.number().int().nonnegative(),
  /** From the last eval; null before one has run. */
  falsePositiveRate: z.number().min(0).max(1).nullable(),
  /** One plain sentence per gap, for example "Astoria: Qloo returned no places inside 600 m". */
  qlooCoverageGaps: z.array(z.string().min(1).max(240)).max(100),
  /** Null until a build has recorded its model calls and a finished edition. */
  costPerEditionUsd: z.number().nonnegative().nullable(),
  tavilyCreditsUsed: z.number().nonnegative(),
  /** Tavily's hard total and daily slice, with what the whole app has used. */
  tavily: BudgetUsage,
  /** Live Qloo calls against the hard cap (300) and daily slice (40); null when the ledger could not be read. */
  qloo: BudgetUsage.nullable(),
  rateLimits: z.array(RateLimitRow).max(30),
  /** What one visitor may spend (dollars), and the share of the cap held back for the demo. */
  visitorBudgets: z.object({ workspaceUsd: z.number().nonnegative(), networkDailyUsd: z.number().nonnegative(), demoFloorUsd: z.number().nonnegative() }),
});
export type LimitsResponse = z.infer<typeof LimitsResponse>;

/** What the Nebius certify job (started on demand from the CLI) reads: every item of the week's editions that needs a NeMo check. */
export const PendingJobItem = z.object({
  editionId: id,
  itemId: id,
  /** `card` is the staff card's copy; its itemId is the card token. */
  kind: z.enum(["special", "sound", "partner", "event", "card"]),
  text: z.string().min(1).max(4000),
  brandVoice: Chain.shape.brandVoice,
});
export type PendingJobItem = z.infer<typeof PendingJobItem>;
export const PendingJobsResponse = z.object({ items: z.array(PendingJobItem).max(MAX_JOB_RESULTS) });
export type PendingJobsResponse = z.infer<typeof PendingJobsResponse>;

export const JobResult = z.object({ editionId: id, itemId: id, guardrail: GuardrailResult });
export type JobResult = z.infer<typeof JobResult>;
export const JobResultsBody = z.object({ results: z.array(JobResult).max(MAX_JOB_RESULTS) });
export type JobResultsBody = z.infer<typeof JobResultsBody>;

export const BrandVoiceResponse = z.object({ lines: Chain.shape.brandVoice, sources: z.array(Evidence).max(20) });
export type BrandVoiceResponse = z.infer<typeof BrandVoiceResponse>;

export const upgradeRoutes = {
  getProof: {
    method: "GET", path: "/api/proof", stream: "S5", bodyKind: "none", sse: false,
    request: z.object({}), response: ProofResponse,
  },
  getLimits: {
    method: "GET", path: "/api/limits", stream: "S5", bodyKind: "none", sse: false,
    request: z.object({}), response: LimitsResponse,
  },
  reviewEditions: {
    method: "POST", path: "/api/editions/review", stream: "S3", bodyKind: "json", sse: true,
    request: z.object({ body: z.object({ weekOf: isoDate.optional() }) }), response: AgentEvent,
  },
  getPendingJobs: {
    method: "GET", path: "/api/jobs/pending", stream: "S2", bodyKind: "none", sse: false,
    request: z.object({ headers: signed }), response: PendingJobsResponse,
  },
  postJobResults: {
    method: "POST", path: "/api/jobs/results", stream: "S2", bodyKind: "json", sse: false,
    request: z.object({ headers: signed, body: JobResultsBody }), response: z.object({ updated: z.number().int().nonnegative() }),
  },
  postJobEval: {
    method: "POST", path: "/api/jobs/eval", stream: "S2", bodyKind: "json", sse: false,
    request: z.object({ headers: signed, body: EvalResult }), response: z.object({ ok: z.literal(true) }),
  },
  generateBrandVoice: {
    method: "POST", path: "/api/chain/brand-voice", stream: "S4", bodyKind: "json", sse: false,
    request: z.object({ body: z.object({}) }), response: BrandVoiceResponse,
  },
} as const satisfies Record<string, RouteSpec>;
