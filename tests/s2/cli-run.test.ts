import { beforeEach, describe, expect, it } from "vitest";
import { GET as proofGET } from "@/app/api/proof/route";
import { postJobEval, postJobResults } from "@/server/handlers/job-batch";
import { ProofBody } from "@/server/handlers/proof";
import { readJobRuns } from "@/server/handlers/proof-ledger";
import { deriveJobSecret, signRequest } from "@/server/jobs/hmac";
import { ensureDemoWorkspace } from "@/server/session";
import type { Repo } from "@/server/store";
import { buildRunnerJob, parseArgs } from "../../scripts/nebius/runner";
import { cleanEdition, fakePorts, freshApp, req } from "../e/helpers";

/**
 * A certify/eval run started from the CLI (scripts/nebius-job.ts) reports to the app the way the Nebius job does: the per-job
 * secret HMAC(shared, job name) in x-le-signature, the job's name in x-le-job-id, trigger "manual". It must land on the proof
 * ledger once per (mode, job name) however often the job retries its post.
 */

const SHARED = "cli-run-shared-secret-0123456789abcdef-xyz";
const nowSec = () => Math.floor(Date.now() / 1000);
let tick = 0;
let repo: Repo;
let jobName: string;
let jobSecret: string;

beforeEach(async () => {
  repo = freshApp({ LE_JOB_SECRET: SHARED }, fakePorts());
  await ensureDemoWorkspace(repo);
  await repo.putEdition(cleanEdition("store_williamsburg", "ed_cli_1"));
  const built = await buildRunnerJob(parseArgs(["certify", "eval"]), { LE_JOB_SECRET: SHARED, NEBIUS_API_KEY: "tf-key-for-this-test-only-0123456789" }, new Date());
  jobName = built.name;
  jobSecret = await deriveJobSecret(SHARED, jobName);
  tick = 0;
});

async function jobPost(handler: typeof postJobResults, path: string, body: Record<string, unknown>) {
  const raw = JSON.stringify({ ts: nowSec() + ++tick, jobId: jobName, scriptSha: "c".repeat(64), startedAt: new Date().toISOString(), trigger: "manual", ...body });
  const signature = await signRequest(jobSecret, { method: "POST", path, jobId: jobName }, raw);
  return handler(req(path, { method: "POST", headers: { "content-type": "application/json", "x-le-signature": signature, "x-le-job-id": jobName }, body: raw }));
}

const rows = [
  ...Array.from({ length: 40 }, (_, n) => ({ phrase: `Red team ${n}`, expected: "block" as const, got: "block" as const })),
  ...Array.from({ length: 10 }, (_, n) => ({ phrase: `Benign ${n}`, expected: "pass" as const, got: "pass" as const })),
];
const evalBody = () => ({ at: new Date().toISOString(), cases: 40, caught: 40, falsePositives: 0, benign: 10, catchRate: 1, falsePositiveRate: 0, model: "nvidia/Nemotron-3_5-Lightning", jobId: jobName, rows });

describe("a CLI-started job reports to the app", () => {
  it("records a manual certify JobRun with the Nebius job name, once however often the job re-posts", async () => {
    const item = (await repo.getEdition("ed_cli_1"))!.items[0];
    const result = { editionId: "ed_cli_1", itemId: item.id, guardrail: { status: "passed", reasons: ["Passed."], checkedBy: "nemo-guardrails@nebius-job", certifiedAt: new Date().toISOString(), jobId: jobName } };
    for (let i = 0; i < 3; i++) expect((await jobPost(postJobResults, "/api/jobs/results", { results: [result] })).status).toBe(200);
    const runs = await readJobRuns(repo);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ mode: "certify", trigger: "manual", nebiusJobId: jobName, status: "done", scriptSha: "c".repeat(64) });
  });

  it("records a manual eval JobRun once, and /api/proof lists both runs with the job name", async () => {
    for (let i = 0; i < 2; i++) expect((await jobPost(postJobEval, "/api/jobs/eval", evalBody())).status).toBe(200);
    await jobPost(postJobResults, "/api/jobs/results", { results: [] });
    const runs = (await readJobRuns(repo)).filter((r) => r.mode === "eval");
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ trigger: "manual", nebiusJobId: jobName });
    const proof = ProofBody.parse(await (await proofGET(req("/api/proof", { ip: "198.51.100.77" }))).json());
    expect(proof.jobRuns.find((r) => r.mode === "eval")).toMatchObject({ trigger: "manual", nebiusJobId: jobName });
    expect(proof.eval).toMatchObject({ jobId: jobName, caught: 40 });
  });

  it("a different job name is a different run, and a post signed for another job is refused", async () => {
    expect((await jobPost(postJobEval, "/api/jobs/eval", evalBody())).status).toBe(200);
    const other = "local-edition-eval-209901010000";
    const raw = JSON.stringify({ ts: nowSec() + 50, ...evalBody(), jobId: other, trigger: "manual" });
    const res = await postJobEval(req("/api/jobs/eval", { method: "POST", headers: { "content-type": "application/json", "x-le-job-id": other, "x-le-signature": await signRequest(jobSecret, { method: "POST", path: "/api/jobs/eval", jobId: other }, raw) }, body: raw }));
    expect(res.status).toBe(401);
    expect((await readJobRuns(repo)).filter((r) => r.mode === "eval")).toHaveLength(1);
  });
});
