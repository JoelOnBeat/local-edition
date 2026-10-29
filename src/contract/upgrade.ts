import { z } from "zod";

/**
 * Upgrade contract primitives (docs/CONTRACT.md, "Upgrade contract"). Imported by domain.ts, so this file
 * imports nothing from it. Every field that old stored data lacks is optional; an absent field means the
 * default noted beside it, so rows written before the upgrade still parse.
 */

const iso = z.iso.datetime({ offset: true });

/** Which checker produced a guardrail verdict. Absent means `live`. */
export const GuardrailChecker = z.enum(["live", "nemo-guardrails@nebius-job"]);
export type GuardrailChecker = z.infer<typeof GuardrailChecker>;
export const DEFAULT_CHECKED_BY: GuardrailChecker = "live";

/** Which job in the pipeline made a model call (a `step_metrics` event names one). */
export const ModelRole = z.enum(["agent", "vision", "copy", "review", "check", "embed"]);
export type ModelRole = z.infer<typeof ModelRole>;

export const ReviewVerdict = z.enum(["approve", "needs_change"]);
export type ReviewVerdict = z.infer<typeof ReviewVerdict>;

/** What the Ultra reviewer says about one store's edition (also the payload of the `review` event). */
export const ReviewFields = z.object({
  verdict: ReviewVerdict,
  reason: z.string().min(1).max(600),
  /** Store ids whose editions this one clashes with (empty when it stands alone). */
  clashWith: z.array(z.string().min(1).max(64)).max(50),
  /** What to change, when the verdict is `needs_change`. */
  hint: z.string().max(600).nullable(),
  /** Model id of the reviewer. */
  reviewedBy: z.string().min(1).max(120),
});
export const EditionReview = ReviewFields.extend({ at: iso });
export type EditionReview = z.infer<typeof EditionReview>;

/** Result of re-checking an item's evidence. An item with a `mismatch` or `missing` is dropped, never shown. */
export const ItemVerification = z.object({
  lift: z.enum(["recomputed", "mismatch"]),
  entities: z.enum(["found", "missing"]),
});
export type ItemVerification = z.infer<typeof ItemVerification>;

/** The Tavily triage of an event tie-in: whether the listing was kept, and why. */
export const TieInTriage = z.object({ kept: z.boolean(), reason: z.string().min(1).max(300) });
export type TieInTriage = z.infer<typeof TieInTriage>;

export const JobMode = z.enum(["rebuild", "certify", "eval", "import"]);
export type JobMode = z.infer<typeof JobMode>;

export const EvalExpectation = z.enum(["block", "pass"]);
export const EvalRow = z.object({ phrase: z.string().min(1).max(500), expected: EvalExpectation, got: EvalExpectation });
export type EvalRow = z.infer<typeof EvalRow>;

/**
 * The guardrails red-team result the Nebius `eval` job (started on demand from the CLI) posts. `cases` counts the phrases that should be
 * blocked and `caught` those that were; `benign` counts the phrases that should pass and `falsePositives`
 * those that were wrongly blocked. Rates are 0..1.
 */
export const EvalResult = z.object({
  at: iso,
  cases: z.number().int().nonnegative(),
  caught: z.number().int().nonnegative(),
  falsePositives: z.number().int().nonnegative(),
  benign: z.number().int().nonnegative(),
  catchRate: z.number().min(0).max(1),
  falsePositiveRate: z.number().min(0).max(1),
  model: z.string().min(1).max(120),
  jobId: z.string().min(1).max(120),
  rows: z.array(EvalRow).max(200),
});
export type EvalResult = z.infer<typeof EvalResult>;

/** Error codes the upgrade and data-path decisions add. `{ error, code }` bodies use these exact strings. */
export const UPGRADE_ERROR_CODES = [
  "version_required", // 428: PATCH without If-Match
  "version_conflict", // 409: If-Match is stale
  "guardrail_unchecked", // 409: approving an unchecked item without override
  "guardrail_blocked", // 409: approving a blocked or flagged item
  "has_approvals", // error event: a build skipped a store with approved or edited items
  "build_running", // 409: one build per workspace at a time
] as const;

/** The `If-Match` header value for an item version. */
export const formatIfMatch = (version: number): string => String(version);

/** Reads an `If-Match` value (`3`, `"3"` or `W/"3"`) back to a version, or null when it is not one. */
export function parseIfMatch(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  const n = Number(raw.trim().replace(/^W\//, "").replace(/"/g, ""));
  return raw.trim() !== "" && Number.isInteger(n) && n >= 0 ? n : null;
}
