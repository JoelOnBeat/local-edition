import type { BrandVoiceResponse, EvalResult, JobRun, LimitsResponse, MenuItem, ProofResponse } from "@/contract";
import { PROOF_STEPS, reviewsOf, seenModels } from "@/server/handlers/proof-steps";
import { rateLimitRows } from "@/server/limits-table";
import { SAMPLE_MENU, SAMPLE_STORES } from "@/server/sample/chain";
import { mockEditions } from "./editions";
import { MOCK_EVAL_ROWS } from "./eval-rows";
import { evidence, fakeEntityId } from "./helpers";
import { MOCK_MODEL_IDS, allStoreSteps, sumMetrics } from "./metrics";
import { MOCK_CERTIFY_JOB_ID } from "./upgrade-editions";

/** Upgrade payloads: the menu verify pass, one JobRun per mode, the eval result, /api/proof and /api/limits. */

/** The sample menu as the connected Square sandbox holds it (source "square"); every item seen, one price too smudged to read in a photo read. */
export const mockMenu: MenuItem[] = SAMPLE_MENU.map((m) => ({
  ...m,
  source: "square",
  seen: true,
  priceLegible: m.id !== "menu_pour-over",
}));

const sha256Like = (seed: string) => fakeEntityId(`${seed}:a`) + fakeEntityId(`${seed}:b`);
export const MOCK_CERTIFY_SHA = sha256Like("jobs/certify.py");
export const MOCK_EVAL_SHA = sha256Like("jobs/eval.py");
export const MOCK_GIT_SHA = fakeEntityId("local-edition@main").slice(0, 40);

const allStores = SAMPLE_STORES.map((s) => s.id);

/** One run per mode. The rebuild runs in the Worker's Workflow; certify, eval and import are Nebius jobs started on demand from the CLI (`manual`). */
export const mockJobRuns: JobRun[] = [
  {
    id: "job_sample_2026w44", trigger: "cron", mode: "rebuild",
    startedAt: "2026-10-26T00:00:00.000Z", finishedAt: "2026-10-26T00:04:41.000Z",
    storeIds: allStores, status: "done", nebiusJobId: null, scriptSha: null,
    note: "Sample run: 8 editions rebuilt, 1 item held for review. NeMo certification is pending: it runs on demand from the CLI, not on a schedule.",
  },
  {
    id: "job_sample_2026w44_certify", trigger: "manual", mode: "certify",
    startedAt: "2026-10-26T00:05:10.000Z", finishedAt: "2026-10-26T00:06:48.000Z",
    storeIds: allStores, status: "done", nebiusJobId: MOCK_CERTIFY_JOB_ID, scriptSha: MOCK_CERTIFY_SHA,
    note: "Sample run, started from the CLI: 32 items and 8 staff cards checked with NeMo Guardrails, 1 flipped to flagged.",
  },
  {
    id: "job_sample_2026w44_eval", trigger: "manual", mode: "eval",
    startedAt: "2026-10-26T00:07:00.000Z", finishedAt: "2026-10-26T00:08:29.000Z",
    storeIds: [], status: "done", nebiusJobId: "nebius-job-b21e0d58", scriptSha: MOCK_EVAL_SHA,
    note: "Sample run, started from the CLI: 40 attack phrases and 10 benign phrases scored.",
  },
  {
    id: "job_sample_import_0021", trigger: "manual", mode: "import",
    startedAt: "2026-10-23T03:12:00.000Z", finishedAt: "2026-10-23T03:15:36.000Z",
    storeIds: allStores, status: "done", nebiusJobId: "nebius-job-03c8e5a7", scriptSha: sha256Like("jobs/import.py"),
    note: "Sample run, started from the CLI: 8 stores read from a CSV upload and profiled.",
  },
];

const cases = MOCK_EVAL_ROWS.filter((r) => r.expected === "block");
const benign = MOCK_EVAL_ROWS.filter((r) => r.expected === "pass");
const caught = cases.filter((r) => r.got === "block").length;
const falsePositives = benign.filter((r) => r.got === "block").length;

export const mockEval: EvalResult = {
  at: "2026-10-26T00:08:29.000Z",
  cases: cases.length, caught, benign: benign.length, falsePositives,
  catchRate: Math.round((caught / cases.length) * 1000) / 1000,
  falsePositiveRate: Math.round((falsePositives / benign.length) * 1000) / 1000,
  model: MOCK_MODEL_IDS.check,
  jobId: "nebius-job-b21e0d58",
  rows: MOCK_EVAL_ROWS,
};

const buildSteps = sumMetrics(SAMPLE_STORES.flatMap((s) => allStoreSteps(s.id)));
const spendPerEditionUsd = Math.round((buildSteps.usd / SAMPLE_STORES.length) * 1e4) / 1e4;

export const mockProof: ProofResponse = {
  jobRuns: mockJobRuns,
  eval: mockEval,
  scriptSha: MOCK_CERTIFY_SHA,
  gitSha: MOCK_GIT_SHA,
  spendPerEditionUsd,
  cachedRatio: buildSteps.cachedRatio,
  steps: PROOF_STEPS,
  seenModels: seenModels(mockEditions),
  editionCount: mockEditions.length,
  reviews: reviewsOf(mockEditions, SAMPLE_STORES),
  sample: true,
};

export const mockLimits: LimitsResponse = {
  droppedForEvidence: 3,
  guardrailBlocks: 2,
  falsePositiveRate: mockEval.falsePositiveRate,
  qlooCoverageGaps: [
    "Astoria: Qloo returned no events, so the event night rests on a Tavily listing and block taste alone.",
    "Upper East Side: only 4 places inside 600 m, so the partner pick had little to choose from.",
    "Long Island City: the sound item is still unchecked because guardrails were unreachable during the build.",
  ],
  costPerEditionUsd: spendPerEditionUsd,
  tavilyCreditsUsed: 11,
  // Mirrors src/server/tavily/budget.ts (80 total, 10 a day), src/server/qloo/ledger.ts (300 total, 40 a day) and src/server/spend-budget.ts.
  tavily: { used: 11, cap: 80, dailyUsed: 10, dailyCap: 10 },
  qloo: { used: 34, cap: 300, dailyUsed: 12, dailyCap: 40 },
  rateLimits: rateLimitRows(),
  visitorBudgets: { workspaceUsd: 0.4, networkDailyUsd: 0.8, demoFloorUsd: 1.5 },
};

/** One Tavily crawl of the chain's own pages, then Lightning writes three lines in that voice. */
export const mockBrandVoice: BrandVoiceResponse = {
  lines: [
    "Warm and plain-spoken, like the person who knows your order.",
    "Neighbourly first: we talk about the block, not about ourselves.",
    "Short sentences, no hype, no exclamation marks.",
  ],
  sources: [
    evidence({
      id: "ev_brand_voice_crawl", source: "tavily", endpoint: "/crawl",
      params: { url: "https://kettleandkiln.example", max_depth: "1" },
      summary: "Sample data. Read 6 pages of the chain's own site: the about page, three menu pages and two store pages.",
      metrics: { relevance: 0.82 }, entityIds: [], url: "https://kettleandkiln.example",
    }),
    evidence({
      id: "ev_brand_voice_copy", source: "tokenfactory", endpoint: "/v1/chat/completions",
      params: { model: MOCK_MODEL_IDS.copy },
      summary: `Sample data. Brand voice lines drafted by ${MOCK_MODEL_IDS.copy} from the crawled pages.`,
      metrics: {}, entityIds: [],
    }),
  ],
};
