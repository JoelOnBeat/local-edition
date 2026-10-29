import { z } from "zod";
import { routes, type EvalResult } from "@/contract";
import { createLogger } from "../log";
import { HttpError } from "../http/errors";
import { withRoute } from "../http/api";
import { recordBatchRun, saveEval } from "../jobs/batch-runs";
import { applyResults, listPending } from "../jobs/certify";
import { JOB_RESULT_MAX_BYTES, authenticate, authenticateTimestamped, requireFreshAndOnce } from "../jobs/job-auth";
import { ensureDemoWorkspace } from "../session";
import { getRepo } from "../store";
import { parseStoreCsv } from "./csv";
import { addStores, importStores } from "./workspace";

const log = createLogger("jobs:batch");

const iso = z.iso.datetime({ offset: true });
/** Signed extras the job puts in the JSON body. The route's body schema strips them; the signature covers them. */
const Extras = z.object({
  ts: z.number().int(),
  jobId: z.string().min(1).max(120).optional(),
  scriptSha: z.string().min(7).max(64).nullable().optional(),
  startedAt: iso.optional(),
  trigger: z.enum(["cron", "manual"]).default("manual"),
  failed: z.number().int().nonnegative().max(1000).default(0),
});

function extrasOf(rawBody: string | null): z.infer<typeof Extras> {
  let json: unknown;
  try {
    json = JSON.parse(rawBody ?? "");
  } catch {
    throw new HttpError(400, "invalid_json", "The request body is not valid JSON.");
  }
  const parsed = Extras.safeParse(json);
  if (!parsed.success) throw new HttpError(400, "invalid_input", "ts is required (epoch seconds); jobId, scriptSha, startedAt, trigger and failed must be well formed.");
  return parsed.data;
}

/** GET: the copy the Nebius certify job must check. Header-timestamp signature (scheme 2). */
export const getPendingJobs = withRoute(routes.getPendingJobs, async (_input, { request }) => {
  const repo = await getRepo();
  await authenticateTimestamped(request, new Uint8Array(0), repo);
  const items = await listPending(repo);
  log.info("pending read", { items: items.length, job: request.headers.get("x-le-job-id") ?? undefined });
  return { items };
});

/** POST: NeMo's verdicts. Approved copy that NeMo blocks is flipped to `flagged`. */
export const postJobResults = withRoute(
  routes.postJobResults,
  async ({ headers, body }, { rawBody }) => {
    const extras = extrasOf(rawBody);
    const repo = await getRepo();
    await requireFreshAndOnce(repo, extras.ts, headers["x-le-signature"]);
    const jobId = extras.jobId ?? body.results.find((r) => r.guardrail.jobId)?.guardrail.jobId ?? null;
    const out = await applyResults(repo, body.results, { jobId });
    if (jobId) {
      const parts = [`Certified ${out.updated} item${out.updated === 1 ? "" : "s"} with NeMo Guardrails: ${out.passed} passed, ${out.blocked} blocked`];
      if (out.flipped) parts.push(`${out.flipped} flipped to flagged`);
      if (out.stale + out.skipped) parts.push(`${out.stale + out.skipped} not applied (changed or gone)`);
      if (extras.failed) parts.push(`${extras.failed} without a verdict`);
      await recordBatchRun(repo, {
        mode: "certify", jobId, trigger: extras.trigger, startedAt: extras.startedAt ?? new Date().toISOString(),
        scriptSha: extras.scriptSha ?? null, storeIds: out.storeIds, note: `${parts.join(", ")}.`,
      });
    }
    return { updated: out.updated };
  },
  { maxBodyBytes: JOB_RESULT_MAX_BYTES, authenticate },
);

/** The rows are the evidence: the rates the job states must be what the rows say. */
export function evalMismatch(e: EvalResult): string | null {
  const red = e.rows.filter((r) => r.expected === "block");
  const benign = e.rows.filter((r) => r.expected === "pass");
  const caught = red.filter((r) => r.got === "block").length;
  const falsePositives = benign.filter((r) => r.got === "block").length;
  if (red.length !== e.cases || benign.length !== e.benign) return "cases and benign must equal the number of rows of each kind.";
  if (caught !== e.caught || falsePositives !== e.falsePositives) return "caught and falsePositives must equal what the rows say.";
  const near = (a: number, b: number) => Math.abs(a - b) < 0.0005;
  if (!near(e.catchRate, e.cases ? caught / e.cases : 0) || !near(e.falsePositiveRate, e.benign ? falsePositives / e.benign : 0)) return "the rates must equal caught / cases and falsePositives / benign.";
  return null;
}

/** POST: the red-team result of the NeMo rails. Kept in the repo cache under `eval:latest`. */
export const postJobEval = withRoute(
  routes.postJobEval,
  async ({ headers, body }, { rawBody }) => {
    const extras = extrasOf(rawBody);
    const mismatch = evalMismatch(body);
    if (mismatch) throw new HttpError(400, "eval_inconsistent", `The eval result does not add up: ${mismatch}`);
    const repo = await getRepo();
    await requireFreshAndOnce(repo, extras.ts, headers["x-le-signature"]);
    await saveEval(repo, body);
    await recordBatchRun(repo, {
      mode: "eval", jobId: body.jobId, trigger: extras.trigger, startedAt: extras.startedAt ?? body.at,
      scriptSha: extras.scriptSha ?? null, storeIds: [],
      note: `Caught ${body.caught} of ${body.cases} red-team phrases; ${body.falsePositives} of ${body.benign} benign phrases wrongly blocked.`,
    });
    return { ok: true as const };
  },
  { maxBodyBytes: JOB_RESULT_MAX_BYTES, authenticate },
);

/**
 * POST /api/stores/import. A request with a visitor cookie goes the normal way (the visitor's own workspace). A request
 * carrying `x-le-signature` is the Nebius import job: header-timestamp signature, and the stores go into the canonical
 * demo workspace, which no cookie can reach.
 */
const importForJob = withRoute(
  routes.importStores,
  async ({ body }, { request, rawBody, rawBytes }) => {
    const repo = await getRepo();
    const workspace = await ensureDemoWorkspace(repo);
    const stores = await addStores({ request, rawBody, rawBytes, repo, workspace }, parseStoreCsv(body), true);
    const jobId = request.headers.get("x-le-job-id")?.slice(0, 120) || `import-${Date.now()}`;
    await recordBatchRun(repo, {
      mode: "import", jobId, trigger: "manual", startedAt: new Date().toISOString(), scriptSha: request.headers.get("x-le-script-sha")?.slice(0, 64) || null,
      storeIds: stores.map((s) => s.id), note: `Imported ${stores.length} store${stores.length === 1 ? "" : "s"} from a CSV into the demo workspace.`,
    });
    return stores;
  },
  { authenticate: async ({ request, bytes }) => authenticateTimestamped(request, bytes, await getRepo()) },
);

export const importStoresRoute = (request: Request, args?: { params: Promise<Record<string, string>> }): Promise<Response> =>
  request.headers.has("x-le-signature") ? importForJob(request, args) : importStores(request, args);
