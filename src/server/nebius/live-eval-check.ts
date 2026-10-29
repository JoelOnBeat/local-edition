/**
 * One-off live proof of the job path (30 Oct 2026). Not imported by the app.
 *
 *   NEBIUS_LIVE_TOKEN="$(nebius --profile hackathon-jobs-sa iam get-access-token)" NEBIUS_API_KEY=... \
 *     npx tsx src/server/nebius/live-eval-check.ts
 *
 * Creates the real eval job (`buildLocalEditionJob` with `printOnly`, the generated job bundle, run.sh with the hashed
 * wheels) as `local-edition-eval-check-<timestamp>`. The job cannot reach a developer's machine, so it runs with APP_URL
 * unset and `EVAL_PRINT=1`: the eval table goes to the job's stdout instead of being posted. Polls until terminal, reads
 * the logs with the CLI (`nebius ai job logs`), then deletes the job in a `finally`. The IAM token comes from the CLI
 * profile (the service-account key file is never read); neither it nor the model key is printed.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { JOB_BUNDLE, JOB_PACK_B64 } from "../jobs/job-bundle.generated";
import { isNebiusError } from "./errors";
import { buildLocalEditionJob, timestamp } from "./job-spec";
import { createJobsClient } from "./jobs";
import { isTerminalState } from "./schemas";

const run = promisify(execFile);
const token = process.env.NEBIUS_LIVE_TOKEN;
const apiKey = process.env.NEBIUS_API_KEY;
if (!token || token.length < 20 || !apiKey) {
  process.stderr.write("NEBIUS_LIVE_TOKEN and NEBIUS_API_KEY must be set.\n");
  process.exit(2);
}

const out = (line: string) => process.stdout.write(`${line}\n`);
const jobs = createJobsClient({ tokens: { getToken: async () => token } });
const NEBIUS_CLI = `${process.env.HOME}/.local/bin/nebius`;

function buildRequest() {
  const built = buildLocalEditionJob({ modes: ["eval"], printOnly: true, bundle: JOB_BUNDLE, pack: JOB_PACK_B64, secrets: { NEBIUS_API_KEY: apiKey! }, trigger: "manual", now: new Date() });
  const name = `local-edition-eval-check-${timestamp(new Date())}`;
  const request = { ...built.request, metadata: { ...built.request.metadata, name, labels: { app: "local-edition", purpose: "eval-check" } } };
  request.spec = {
    ...request.spec,
    environmentVariables: (request.spec.environmentVariables ?? []).map((e) => (e.name === "JOB_NAME" ? { ...e, value: name } : e)),
  };
  return { name, request };
}

async function main(): Promise<void> {
  const { name, request } = buildRequest();
  const t0 = Date.now();
  const secs = () => `${Math.round((Date.now() - t0) / 1000)}s`;
  await jobs.validate(request);
  out(`[${secs()}] dry run accepted for ${name} (${request.spec.injectedFiles?.length} injected files, no APP_URL)`);
  const { jobId } = await jobs.create(request);
  out(`[${secs()}] created ${name} id=${jobId}`);
  const seen: string[] = [];
  let last = "";
  let detail = "";
  try {
    for (let i = 0; i < 360; i++) {
      const job = await jobs.get(jobId);
      const state = job.status?.state ?? "STATE_UNSPECIFIED";
      if (state !== last) {
        last = state;
        seen.push(`${state}@${secs()}`);
        out(`[${secs()}] state ${state}`);
      }
      const d = job.status?.stateDetails;
      detail = [d?.code, d?.message].filter(Boolean).join(": ");
      if (isTerminalState(state)) break;
      await new Promise((r) => setTimeout(r, 5000));
    }
    try {
      const logs = await run(NEBIUS_CLI, ["--profile", "hackathon-jobs-sa", "ai", "job", "logs", jobId], { maxBuffer: 8 * 1024 * 1024, timeout: 60_000 });
      out("----- job logs -----");
      out(logs.stdout.trimEnd());
      out("----- end logs -----");
    } catch (e) {
      out(`logs not readable: ${(e as Error).message.split("\n")[0].slice(0, 200)}`);
    }
  } finally {
    const del = await jobs.delete(jobId);
    out(`[${secs()}] delete requested, operation=${del.id ?? "?"}`);
  }
  out(`states: ${seen.join(" -> ")}`);
  out(`detail: ${detail || "(none)"}`);
  out(`wall: ${secs()}`);
}

main().catch((e) => {
  out(`FAILED: ${isNebiusError(e) ? JSON.stringify(e.toErrorBody()) : e instanceof Error ? e.message.slice(0, 300) : "unknown"}`);
  process.exit(1);
});
