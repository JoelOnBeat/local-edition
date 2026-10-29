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
});
export type ProofResponse = z.infer<typeof ProofResponse>;

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
});
export type LimitsResponse = z.infer<typeof LimitsResponse>;

/** What the Nebius certify job reads: every item of the week's editions that needs a NeMo check. */
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
