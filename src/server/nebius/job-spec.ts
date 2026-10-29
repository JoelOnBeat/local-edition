import { NebiusError } from "./errors";
import type { CreateJobRequest, JobSpecInput } from "./schemas";

/**
 * Builds the Nebius job for Local Edition's batch work (`jobs/certify.py`: certify, eval, import).
 *
 * How the code gets into the container without a custom image (chosen from what the OpenAPI supports):
 * `spec.injectedFiles` writes up to 64 KiB per file, read-only, before the process starts. We inject
 * the script, its stdlib helper, requirements.txt, the rails config and a small `run.sh` under /opt/le.
 * `run.sh` installs the pinned wheels of `nemoguardrails` on the stock `python:3.12-slim` image (the 29 Oct spike took
 * 253 s end to end including pip) and runs certify.py. Nothing is pulled from GitHub or GHCR.
 *
 * Install first, secrets second: `pip install` runs from binary wheels only (`--only-binary :all:`, so no sdist build hook
 * runs) pinned by hash (`--require-hashes`; jobs/requirements.txt), before `run.sh` has read any secret.
 *
 * Secrets: injected files are returned only by `GET /ai/v1/jobs/{id}?view=SECRET`, so by default the
 * secret values are injected as files under /opt/le-secrets/ (file name = env var name) and `run.sh`
 * exports them AFTER the install. Plain `environmentVariables` would be readable by anyone who can read the job.
 * `secretDelivery: "env"` puts them in environmentVariables instead (before pip; not used by the Worker).
 * `LE_JOB_SECRET` inside the job is the per-job secret HMAC(shared secret, job name), never the shared one: the app accepts
 * it only for this job's name, only on the job endpoints and only within an hour of the timestamp in the name. The Workflow
 * deletes the job when it ends, so the secrets do not stay in the job record.
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
/**
 * Nebius rejects a create request whose injected files add up to more than 64 KiB (`plaintext must not exceed 65536 bytes`,
 * 30 Oct 2026; a dry run does not check it; the base64 text counts). The loose files are about 74 KB in base64, so the Worker sends one gzipped
 * pack instead (`pack`), which `run.sh` unpacks. This is the ceiling a request is checked against before it is sent.
 */
export const MAX_INJECTED_TOTAL_BYTES = 64 * 1024;
export const PACK_FILE = "bundle.json.gz";

export type LocalEditionJobMode = "certify" | "eval" | "import";

export const JOB_MODES: readonly LocalEditionJobMode[] = ["certify", "eval", "import"];

/** Path relative to /opt/le -> file text (`JOB_BUNDLE` from src/server/jobs/job-bundle.generated.ts). */
export type JobBundle = Record<string, string>;

export const RUN_SH = `#!/usr/bin/env bash
set -euo pipefail
cd ${WORK_DIR}
# 0. Unpack the job's files when they came as one gzipped JSON object (path -> text), written under /opt/le.
if [ -f ${PACK_FILE} ]; then
  python3 -c 'import gzip, json, os
for path, text in json.load(gzip.open("${PACK_FILE}", "rt", encoding="utf-8")).items():
    assert not path.startswith("/") and ".." not in path.split("/"), path
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    open(path, "w", encoding="utf-8").write(text)'
fi
# 1. Dependencies first: pinned binary wheels only, hashes required, while no secret is exported.
pip install --quiet --no-cache-dir --disable-pip-version-check --only-binary :all: --require-hashes --no-deps -r requirements.txt
# 2. Only now read the injected secret files.
if [ -d ${SECRETS_DIR} ]; then
  for f in ${SECRETS_DIR}/*; do
    [ -f "$f" ] && export "$(basename "$f")=$(cat "$f")"
  done
fi
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

/** An already-base64 binary file (the gzipped pack). */
function injectPack(containerPath: string, b64: string): { containerPath: string; content: string } {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) throw new NebiusError("nebius_bad_request", "The job pack is not base64.");
  const bytes = Math.floor((b64.length * 3) / 4);
  if (bytes < 1 || bytes > MAX_INJECTED_FILE_BYTES) throw new NebiusError("nebius_bad_request", `The job pack must be 1 byte to 64 KiB (got about ${bytes}).`);
  return { containerPath, content: b64 };
}

/** `local-edition-<modes joined by ->-<yyyymmddhhmm UTC>`: the job's name, which the app also checks a per-job secret against. */
export function localEditionJobName(modes: readonly LocalEditionJobMode[], now: Date): string {
  return `local-edition-${modes.join("-")}-${timestamp(now)}`;
}

/** UTC `yyyymmddhhmm`. */
export function timestamp(now: Date): string {
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(now.getUTCFullYear(), 4)}${p(now.getUTCMonth() + 1)}${p(now.getUTCDate())}${p(now.getUTCHours())}${p(now.getUTCMinutes())}`;
}

export interface LocalEditionJobInput {
  /** One or more modes, run in order inside ONE job (the 4 minute pip install is paid once). */
  modes: readonly LocalEditionJobMode[];
  /** Public base URL of the deployed app, e.g. https://localedition.pages.dev. Not needed (and not set) with `printOnly`. */
  appUrl?: string;
  /**
   * The job's own secret: `deriveJobSecret(LE_JOB_SECRET, <this job's name from localEditionJobName>)`, never the shared
   * secret itself. Not needed with `printOnly`.
   */
  jobSecret?: string;
  /**
   * A job that never calls the app: `eval` only, no APP_URL, no job secret. The eval table is printed to the job's output
   * (`EVAL_PRINT=1`) instead of being posted. For checking the job path on its own.
   */
  printOnly?: boolean;
  /** Files to ship; must contain `certify.py`, `le_http.py` and `requirements.txt`. */
  bundle: JobBundle;
  /**
   * The same files as one gzipped JSON object, base64 (`JOB_PACK_B64`). When given, only this is injected (as
   * /opt/le/bundle.json.gz) and run.sh unpacks it; `bundle` is then used for validation only. Needed in production
   * because the loose files exceed Nebius's 64 KiB total for injected files.
   */
  pack?: string;
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
  const printOnly = input.printOnly === true;
  if (printOnly && (input.modes.length !== 1 || input.modes[0] !== "eval")) throw new NebiusError("nebius_bad_request", "printOnly runs the eval mode alone.");
  if (!printOnly && !/^https:\/\//.test(input.appUrl ?? "")) throw new NebiusError("nebius_bad_request", "appUrl must be an https URL.");
  if (!printOnly && (input.jobSecret ?? "").length < 16) throw new NebiusError("nebius_bad_request", "jobSecret must be at least 16 characters.");
  for (const f of ["certify.py", "le_http.py", "requirements.txt"]) {
    if (!input.bundle[f]) throw new NebiusError("nebius_bad_request", `The job bundle is missing ${f}.`);
  }
  if (input.modes.length === 0 || input.modes.some((m) => !JOB_MODES.includes(m)) || new Set(input.modes).size !== input.modes.length) {
    throw new NebiusError("nebius_bad_request", `modes must be a non-empty list of distinct values from ${JOB_MODES.join(", ")}.`);
  }
  const name = localEditionJobName(input.modes, input.now ?? new Date());
  const secrets: Record<string, string> = { ...(printOnly ? {} : { LE_JOB_SECRET: input.jobSecret! }), ...input.secrets };
  for (const k of Object.keys(secrets)) {
    if (!ENV_NAME.test(k)) throw new NebiusError("nebius_bad_request", `Invalid secret name ${k}.`);
  }
  const bundlePaths = input.pack ? [] : Object.keys(input.bundle);
  if (bundlePaths.length + Object.keys(secrets).length + 2 > MAX_INJECTED_FILES) {
    throw new NebiusError("nebius_bad_request", `Too many injected files (limit ${MAX_INJECTED_FILES}).`);
  }

  const injectedFiles = [
    inject(`${WORK_DIR}/run.sh`, RUN_SH),
    ...(input.pack ? [injectPack(`${WORK_DIR}/${PACK_FILE}`, input.pack)] : []),
    ...bundlePaths.map((rel) => inject(`${WORK_DIR}/${rel}`, input.bundle[rel])),
  ];
  const delivery = input.secretDelivery ?? "file";
  if (delivery === "file") {
    for (const [k, v] of Object.entries(secrets)) injectedFiles.push(inject(`${SECRETS_DIR}/${k}`, v));
  }

  const environmentVariables: Array<{ name: string; value: string }> = [
    ...(printOnly ? [{ name: "EVAL_PRINT", value: "1" }] : [{ name: "APP_URL", value: input.appUrl!.replace(/\/+$/, "") }]),
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

  const total = injectedFiles.reduce((sum, f) => sum + f.content.length + f.containerPath.length, 0);
  if (total > MAX_INJECTED_TOTAL_BYTES) {
    throw new NebiusError("nebius_bad_request", `The injected files add up to ${total} bytes; Nebius accepts at most ${MAX_INJECTED_TOTAL_BYTES} in one request. Ship the pack.`);
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
