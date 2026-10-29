import type { BrandVoiceResponse, EvalResult, JobRun, LimitsResponse, MenuItem, ProofResponse } from "@/contract";
import { SAMPLE_MENU, SAMPLE_STORES } from "@/server/sample/chain";
import { MOCK_EVAL_ROWS } from "./eval-rows";
import { evidence, fakeEntityId } from "./helpers";
import { MOCK_MODEL_IDS, allStoreSteps, sumMetrics } from "./metrics";
import { MOCK_CERTIFY_JOB_ID } from "./upgrade-editions";

/** Upgrade payloads: the menu verify pass, one JobRun per mode, the eval result, /api/proof and /api/limits. */

/** The sample menu as the VL verify pass leaves it: every item seen, one price too smudged to read. */
export const mockMenu: MenuItem[] = SAMPLE_MENU.map((m) => ({
  ...m,
  source: "vl",
  seen: true,
  priceLegible: m.id !== "menu_pour-over",
}));

const sha256Like = (seed: string) => fakeEntityId(`${seed}:a`) + fakeEntityId(`${seed}:b`);
export const MOCK_CERTIFY_SHA = sha256Like("jobs/certify.py");
export const MOCK_EVAL_SHA = sha256Like("jobs/eval.py");
export const MOCK_GIT_SHA = fakeEntityId("local-edition@main").slice(0, 40);

const allStores = SAMPLE_STORES.map((s) => s.id);

/** One run per mode. The rebuild runs in the Worker's Workflow and starts the certify job. */
export const mockJobRuns: JobRun[] = [
  {
    id: "job_sample_2026w44", trigger: "cron", mode: "rebuild",
    startedAt: "2026-10-26T00:00:00.000Z", finishedAt: "2026-10-26T00:04:41.000Z",
    storeIds: allStores, status: "done", nebiusJobId: MOCK_CERTIFY_JOB_ID, scriptSha: null,
    note: "Sample run: 8 editions rebuilt, 1 item held for review.",
  },
  {
    id: "job_sample_2026w44_certify", trigger: "cron", mode: "certify",
    startedAt: "2026-10-26T00:05:10.000Z", finishedAt: "2026-10-26T00:06:48.000Z",
    storeIds: allStores, status: "done", nebiusJobId: MOCK_CERTIFY_JOB_ID, scriptSha: MOCK_CERTIFY_SHA,
    note: "Sample run: 32 items and 8 staff cards checked with NeMo Guardrails, 1 flipped to flagged.",
  },
  {
    id: "job_sample_2026w44_eval", trigger: "cron", mode: "eval",
    startedAt: "2026-10-26T00:07:00.000Z", finishedAt: "2026-10-26T00:08:29.000Z",
    storeIds: [], status: "done", nebiusJobId: "nebius-job-b21e0d58", scriptSha: MOCK_EVAL_SHA,
    note: "Sample run: 40 attack phrases and 10 benign phrases scored.",
  },
  {
    id: "job_sample_import_0021", trigger: "manual", mode: "import",
    startedAt: "2026-10-23T03:12:00.000Z", finishedAt: "2026-10-23T03:15:36.000Z",
    storeIds: allStores, status: "done", nebiusJobId: "nebius-job-03c8e5a7", scriptSha: sha256Like("jobs/import.py"),
    note: "Sample run: 8 stores read from a CSV upload and profiled.",
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
