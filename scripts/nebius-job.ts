/**
 * Starts a Local Edition Nebius Serverless Job from a developer's session, on demand (30 Oct 2026, 02:30 MYT rule).
 *
 *   npx tsx scripts/nebius-job.ts certify eval            # NeMo certify, then the red-team eval, in one job
 *   npx tsx scripts/nebius-job.ts certify eval --dry-run  # validate only: creates and bills nothing
 *   npx tsx scripts/nebius-job.ts import --csv-url https://example.org/stores.csv
 *
 * Why not from the Worker: the Nebius AI Cloud control plane (auth.eu.nebius.com, api.nebius.cloud) times out with a Cloudflare 522
 * when called from Cloudflare egress, while Token Factory works. So no Worker, cron or Workflow starts a job; this does, as
 * `nebius --profile hackathon-jobs-sa`. The job then POSTs its results to the app (https://localedition.pages.dev) with the
 * per-job secret, and they show on the proof ledger as a `manual` JobRun.
 *
 * Environment (loaded by the developer, never printed): LE_JOB_SECRET (the app's shared secret), NEBIUS_API_KEY (Token Factory).
 * The IAM token comes from the CLI in-process and is never printed, logged or written to disk. The job is deleted when it ends.
 */
import { deriveJobSecret } from "../src/server/jobs/hmac";
import { cliTokenProvider, readJobLogs } from "./nebius/cli";
import { isNebiusError } from "./nebius/errors";
import { createJobsClient, type JobsClient } from "./nebius/jobs";
import { buildRunnerJob, parseArgs, redact, summarize, UsageError, USAGE } from "./nebius/runner";
import { isTerminalState } from "./nebius/schemas";

const POLL_MS = 5_000;
const MAX_WAIT_MS = 65 * 60_000; // the job's own timeout is 1 h
const MAX_POLL_FAILURES = 5;

const out = (line: string) => process.stdout.write(`${line}\n`);
const err = (line: string) => process.stderr.write(`${line}\n`);
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

let interrupted = false;
for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => { interrupted = true; err(`${sig}: stopping, the job will be deleted.`); });

/** Polls until the job ends (or is being deleted), recording each state with the seconds since the start. */
async function waitForEnd(jobs: JobsClient, jobId: string, secs: () => string, seen: string[]): Promise<{ state: string; detail: string }> {
  const deadline = Date.now() + MAX_WAIT_MS;
  let last = "";
  let detail = "";
  let failures = 0;
  while (!interrupted && Date.now() < deadline) {
    try {
      const job = await jobs.get(jobId);
      failures = 0;
      const state = job.status?.state ?? "STATE_UNSPECIFIED";
      if (state !== last) {
        last = state;
        seen.push(`${state}@${secs()}`);
        out(`[${secs()}] state ${state}`);
      }
      const d = job.status?.stateDetails;
      detail = [d?.code, d?.message].filter(Boolean).join(": ");
      if (isTerminalState(state) || state === "DELETING") break;
    } catch (e) {
      if (++failures >= MAX_POLL_FAILURES) throw e;
    }
    await sleep(POLL_MS);
  }
  return { state: last || "UNKNOWN", detail };
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const now = new Date();
  const env = { LE_JOB_SECRET: process.env.LE_JOB_SECRET, NEBIUS_API_KEY: process.env.NEBIUS_API_KEY };
  const built = await buildRunnerJob(args, env, now);
  const secrets = [env.LE_JOB_SECRET, env.NEBIUS_API_KEY, await deriveJobSecret(env.LE_JOB_SECRET ?? "", built.name)];
  const jobs = createJobsClient({ tokens: cliTokenProvider() });
  const t0 = Date.now();
  const secs = () => `${Math.round((Date.now() - t0) / 1000)}s`;

  for (const line of summarize(built.request)) out(line);
  if (args.dryRun) {
    await jobs.validate(built.request);
    out(`dry run accepted for ${built.name}: nothing was created.`);
    return 0;
  }

  let jobId = "";
  try {
    jobId = (await jobs.create(built.request)).jobId;
  } catch (e) {
    // A create that timed out may still have made the job: look it up by name so it cannot be left running.
    if (isNebiusError(e) && e.code === "nebius_unavailable") {
      jobId = (await jobs.getByName(built.request.metadata.parentId, built.name).then((j) => j.metadata.id ?? "", () => ""));
    }
    if (!jobId) throw e;
  }
  out(`[${secs()}] created ${built.name} id=${jobId}`);

  const seen: string[] = [];
  let result = { state: "UNKNOWN", detail: "" };
  try {
    result = await waitForEnd(jobs, jobId, secs, seen);
    const logs = await readJobLogs(jobId);
    out("----- job logs -----");
    out(logs === null ? "(logs not readable)" : redact(logs.trimEnd(), secrets));
    out("----- end logs -----");
  } finally {
    // Deletion is asynchronous on Nebius's side (the record shows DELETING for a few minutes): accepted counts as done.
    try {
      const del = await jobs.delete(jobId);
      out(`[${secs()}] delete requested, operation=${del.id ?? "?"}`);
    } catch (e) {
      err(`DELETE FAILED for ${jobId}: ${isNebiusError(e) ? e.code : "error"}. Delete it by hand: nebius --profile hackathon-jobs-sa ai job delete ${jobId}`);
    }
  }
  const exitCode = result.state === "COMPLETED" ? 0 : 1;
  out(`job: ${jobId} (${built.name})`);
  out(`states: ${seen.join(" -> ") || "(none)"}`);
  out(`detail: ${result.detail || "(none)"}`);
  out(`wall: ${secs()}`);
  out(`exit code: ${exitCode}`);
  return exitCode;
}

main().then(
  (code) => process.exit(code),
  (e: unknown) => {
    if (e instanceof UsageError) {
      err(`${e.message}\n${USAGE}`);
      process.exit(2);
    }
    err(`FAILED: ${isNebiusError(e) ? JSON.stringify(e.toErrorBody()) : e instanceof Error ? e.message.slice(0, 300) : "unknown"}`);
    process.exit(1);
  },
);
