/**
 * One-off live proof of the REST job path (29 Oct 2026). Not imported by the app.
 *
 *   NEBIUS_LIVE_TOKEN="$(nebius --profile hackathon-jobs-sa iam get-access-token)" \
 *     npx tsx src/server/nebius/live-check.ts
 *
 * Uses a CLI-issued IAM token, so the service-account private key is never read. Creates a tiny CPU job
 * (`python -c "print('local-edition rest ok')"` on cpu-d3 2vcpu-8gb), polls until terminal, then deletes it.
 * Never prints the token or the request secrets (there are none).
 */
import { createJobsClient } from "./jobs";
import { LOCAL_EDITION_PROJECT_ID } from "./job-spec";
import { isTerminalState, type CreateJobRequest } from "./schemas";
import { isNebiusError } from "./errors";

const token = process.env.NEBIUS_LIVE_TOKEN;
if (!token || token.length < 20) {
  process.stderr.write("NEBIUS_LIVE_TOKEN is not set.\n");
  process.exit(2);
}

const out = (line: string) => process.stdout.write(`${line}\n`);
const jobs = createJobsClient({ tokens: { getToken: async () => token } });
const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
const name = `local-edition-rest-check-${stamp}`;

const request: CreateJobRequest = {
  metadata: { parentId: LOCAL_EDITION_PROJECT_ID, name, labels: { app: "local-edition", purpose: "rest-check" } },
  spec: {
    image: "python:3.12-slim",
    containerCommand: "python",
    args: `-c "print('local-edition rest ok')"`,
    platform: "cpu-d3",
    preset: "2vcpu-8gb",
    disk: { type: "NETWORK_SSD", sizeBytes: String(20 * 1024 ** 3) },
    timeout: "3600s",
    restartAttempts: "0",
  },
};

async function main(): Promise<void> {
  const t0 = Date.now();
  const secs = () => `${Math.round((Date.now() - t0) / 1000)}s`;
  out(`request body: ${JSON.stringify(request)}`);
  const { jobId, operation } = await jobs.create(request);
  out(`[${secs()}] created ${name} id=${jobId} operation=${operation.id ?? "?"}`);
  const seen: string[] = [];
  let last = "";
  let detail = "";
  try {
    for (let i = 0; i < 120; i++) {
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
  } finally {
    const del = await jobs.delete(jobId);
    out(`[${secs()}] delete requested, operation=${del.id ?? "?"}`);
  }
  out(`states: ${seen.join(" -> ")}`);
  out(`detail: ${detail || "(none)"}`);
  out(`wall: ${secs()}`);
}

main().catch((e) => {
  out(`FAILED: ${isNebiusError(e) ? JSON.stringify(e.toErrorBody()) : e instanceof Error ? e.message : "unknown"}`);
  process.exit(1);
});
