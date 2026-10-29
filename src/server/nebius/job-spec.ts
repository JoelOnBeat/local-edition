import { NebiusError } from "./errors";
import type { CreateJobRequest, JobSpecInput } from "./schemas";

/**
 * Builds the Nebius job for Local Edition's batch work (`jobs/certify.py`: certify, eval, import).
 *
 * How the code gets into the container without a custom image (chosen from what the OpenAPI supports):
 * `spec.injectedFiles` writes up to 64 KiB per file, read-only, before the process starts. We inject
 * the script, its stdlib helper, requirements.txt, the rails config and a small `run.sh` under /opt/le.
 * `run.sh` pip-installs `nemoguardrails` on the stock `python:3.12-slim` image (the 29 Oct spike took
 * 253 s end to end including pip) and runs certify.py. Nothing is pulled from GitHub or GHCR.
 *
 * Secrets: injected files are returned only by `GET /ai/v1/jobs/{id}?view=SECRET`, so by default the
 * secret values are injected as files under /opt/le-secrets/ (file name = env var name) and `run.sh`
 * exports them. Plain `environmentVariables` would be readable by anyone who can read the job.
 * Choose `secretDelivery: "env"` to put them in environmentVariables instead.
 */

export const LOCAL_EDITION_PROJECT_ID = "project-e04yk83jbc00bwhyv60mbp"; // eu-west2, CPU jobs
export const LOCAL_EDITION_IMAGE = "python:3.12-slim";
export const LOCAL_EDITION_PLATFORM = "cpu-d3";
export const LOCAL_EDITION_PRESET = "2vcpu-8gb";
export const DISK_BYTES = 20 * 1024 ** 3; // 20 GiB, the docs' minimum for CPU workloads
export const JOB_TIMEOUT = "3600s"; // the platform minimum is 1 h; billing stops when the job ends
export const WORK_DIR = "/opt/le";
export const SECRETS_DIR = "/opt/le-secrets";
export const MAX_INJECTED_FILE_BYTES = 64 * 1024;
export const MAX_INJECTED_FILES = 32;

export type LocalEditionJobMode = "certify" | "eval" | "import";

export const JOB_MODES: readonly LocalEditionJobMode[] = ["certify", "eval", "import"];

/** Path relative to /opt/le -> file text (`JOB_BUNDLE` from src/server/jobs/job-bundle.generated.ts). */
export type JobBundle = Record<string, string>;

export const RUN_SH = `#!/usr/bin/env bash
set -euo pipefail
cd ${WORK_DIR}
if [ -d ${SECRETS_DIR} ]; then
  for f in ${SECRETS_DIR}/*; do
    [ -f "$f" ] && export "$(basename "$f")=$(cat "$f")"
  done
fi
pip install --quiet --no-cache-dir --disable-pip-version-check -r requirements.txt
# One pip install serves every mode. Each mode runs even if an earlier one failed; the job fails if any did.
status=0
for mode in "$@"; do
  python certify.py --mode "$mode" || status=$?
done
exit $status
`;

const encoder = new TextEncoder();
const ENV_NAME = /^[A-Z][A-Z0-9_]{0,63}$/;

function toBase64(text: string): { b64: string; bytes: number } {
  const bytes = encoder.encode(text);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { b64: btoa(binary), bytes: bytes.length };
}

function inject(containerPath: string, text: string): { containerPath: string; content: string } {
  if (!/^\/([A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+$/.test(containerPath) || containerPath.split("/").includes("..")) {
    throw new NebiusError("nebius_bad_request", `Injected file path is not a clean absolute path: ${containerPath}`);
  }
  const { b64, bytes } = toBase64(text);
  if (bytes < 1 || bytes > MAX_INJECTED_FILE_BYTES) {
    throw new NebiusError("nebius_bad_request", `Injected file ${containerPath} must be 1 byte to 64 KiB (got ${bytes}).`);
  }
  return { containerPath, content: b64 };
}

/** UTC `yyyymmddhhmm`. */
export function timestamp(now: Date): string {
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(now.getUTCFullYear(), 4)}${p(now.getUTCMonth() + 1)}${p(now.getUTCDate())}${p(now.getUTCHours())}${p(now.getUTCMinutes())}`;
}

export interface LocalEditionJobInput {
  /** One or more modes, run in order inside ONE job (the 4 minute pip install is paid once). */
  modes: readonly LocalEditionJobMode[];
  /** Public base URL of the deployed app, e.g. https://localedition.pages.dev. */
  appUrl: string;
  /** Shared HMAC secret (LE_JOB_SECRET). */
  jobSecret: string;
  /** Files to ship; must contain `certify.py`, `le_http.py` and `requirements.txt`. */
  bundle: JobBundle;
  /** Optional extra secrets by env var name (certify and eval need NEBIUS_API_KEY for Lightning). */
  secrets?: Record<string, string>;
  secretDelivery?: "file" | "env";
  /** Non-secret env (for import mode: IMPORT_CSV_URL). */
  env?: Record<string, string>;
  trigger?: "cron" | "manual";
  now?: Date;
  parentId?: string;
}

export interface BuiltJob {
  request: CreateJobRequest;
  name: string;
}

/** Pure: no I/O. The returned request is ready for `JobsClient.create` (or `validate`, a dry run). */
export function buildLocalEditionJob(input: LocalEditionJobInput): BuiltJob {
  if (!/^https:\/\//.test(input.appUrl)) throw new NebiusError("nebius_bad_request", "appUrl must be an https URL.");
  if (input.jobSecret.length < 16) throw new NebiusError("nebius_bad_request", "jobSecret must be at least 16 characters.");
  for (const f of ["certify.py", "le_http.py", "requirements.txt"]) {
    if (!input.bundle[f]) throw new NebiusError("nebius_bad_request", `The job bundle is missing ${f}.`);
  }
  if (input.modes.length === 0 || input.modes.some((m) => !JOB_MODES.includes(m)) || new Set(input.modes).size !== input.modes.length) {
    throw new NebiusError("nebius_bad_request", `modes must be a non-empty list of distinct values from ${JOB_MODES.join(", ")}.`);
  }
  const name = `local-edition-${input.modes.join("-")}-${timestamp(input.now ?? new Date())}`;
  const secrets: Record<string, string> = { LE_JOB_SECRET: input.jobSecret, ...input.secrets };
  for (const k of Object.keys(secrets)) {
    if (!ENV_NAME.test(k)) throw new NebiusError("nebius_bad_request", `Invalid secret name ${k}.`);
  }
  const bundlePaths = Object.keys(input.bundle);
  if (bundlePaths.length + Object.keys(secrets).length + 1 > MAX_INJECTED_FILES) {
    throw new NebiusError("nebius_bad_request", `Too many injected files (limit ${MAX_INJECTED_FILES}).`);
  }

  const injectedFiles = [
    inject(`${WORK_DIR}/run.sh`, RUN_SH),
    ...bundlePaths.map((rel) => inject(`${WORK_DIR}/${rel}`, input.bundle[rel])),
  ];
  const delivery = input.secretDelivery ?? "file";
  if (delivery === "file") {
    for (const [k, v] of Object.entries(secrets)) injectedFiles.push(inject(`${SECRETS_DIR}/${k}`, v));
  }

  const environmentVariables: Array<{ name: string; value: string }> = [
    { name: "APP_URL", value: input.appUrl.replace(/\/+$/, "") },
    { name: "TRIGGER", value: input.trigger ?? "cron" },
    { name: "JOB_NAME", value: name },
    { name: "PIP_ROOT_USER_ACTION", value: "ignore" },
    { name: "PYTHONUNBUFFERED", value: "1" },
    ...Object.entries(input.env ?? {}).map(([n, value]) => ({ name: n, value })),
  ];
  if (delivery === "env") environmentVariables.push(...Object.entries(secrets).map(([n, value]) => ({ name: n, value })));
  for (const e of environmentVariables) {
    if (!ENV_NAME.test(e.name)) throw new NebiusError("nebius_bad_request", `Invalid environment variable name ${e.name}.`);
  }

  const spec: JobSpecInput = {
    image: LOCAL_EDITION_IMAGE,
    containerCommand: "bash",
    args: `${WORK_DIR}/run.sh ${input.modes.join(" ")}`,
    workingDir: WORK_DIR,
    environmentVariables,
    injectedFiles,
    platform: LOCAL_EDITION_PLATFORM,
    preset: LOCAL_EDITION_PRESET,
    disk: { type: "NETWORK_SSD", sizeBytes: String(DISK_BYTES) },
    timeout: JOB_TIMEOUT,
    restartAttempts: "0",
  };
  return {
    name,
    request: {
      metadata: { parentId: input.parentId ?? LOCAL_EDITION_PROJECT_ID, name, labels: { app: "local-edition", modes: input.modes.join("_") } },
      spec,
    },
  };
}
