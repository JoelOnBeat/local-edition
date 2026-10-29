import { MIN_JOB_SECRET_LENGTH } from "../../src/lib/env";
import { deriveJobSecret } from "../../src/server/jobs/hmac";
import { JOB_BUNDLE, JOB_PACK_B64 } from "./job-bundle.generated";
import { buildLocalEditionJob, JOB_MODES, localEditionJobName, type BuiltJob, type LocalEditionJobMode } from "./job-spec";
import type { CreateJobRequest } from "./schemas";

/**
 * Pure parts of the session runner (scripts/nebius-job.ts): argument parsing, the create request, a secret-free summary.
 * SESSION-ONLY: nothing under src/ or worker/ may import this (the Nebius control plane answers Cloudflare egress with a 522).
 */

export const DEFAULT_APP_URL = "https://localedition.pages.dev";
export const USAGE = "usage: npx tsx scripts/nebius-job.ts <certify|eval|import>... [--app-url https://...] [--csv-url https://...] [--dry-run]";

export interface RunnerArgs {
  modes: LocalEditionJobMode[];
  appUrl: string;
  csvUrl?: string;
  dryRun: boolean;
}

export class UsageError extends Error {}

/** An https URL with a host, no credentials, no path, query or fragment: the app's origin. */
export function httpsOrigin(value: string, what: string): string {
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    throw new UsageError(`${what} is not a URL.`);
  }
  if (u.protocol !== "https:") throw new UsageError(`${what} must be https.`);
  if (u.username || u.password) throw new UsageError(`${what} must not carry credentials.`);
  return u.origin;
}

export function parseArgs(argv: readonly string[]): RunnerArgs {
  const modes: LocalEditionJobMode[] = [];
  let appUrl = DEFAULT_APP_URL;
  let csvUrl: string | undefined;
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") dryRun = true;
    else if (a === "--app-url" || a === "--csv-url") {
      const v = argv[++i];
      if (!v) throw new UsageError(`${a} needs a value.`);
      if (a === "--app-url") {
        appUrl = httpsOrigin(v, "--app-url");
        if (new URL(v).pathname !== "/") throw new UsageError("--app-url must be the app's origin, with no path.");
      } else {
        httpsOrigin(v, "--csv-url");
        csvUrl = v;
      }
    } else if (a.startsWith("--")) throw new UsageError(`Unknown option ${a}.`);
    else if ((JOB_MODES as readonly string[]).includes(a)) {
      if (modes.includes(a as LocalEditionJobMode)) throw new UsageError(`Mode ${a} is given twice.`);
      modes.push(a as LocalEditionJobMode);
    } else throw new UsageError(`Unknown mode ${a} (use ${JOB_MODES.join(", ")}).`);
  }
  if (!modes.length) throw new UsageError("Give at least one mode.");
  if (modes.includes("import") && !csvUrl) throw new UsageError("import mode needs --csv-url (an https URL of a CSV: name,address,lat,lon).");
  if (csvUrl && !modes.includes("import")) throw new UsageError("--csv-url is only for import mode.");
  return { modes, appUrl, csvUrl, dryRun };
}

export interface RunnerEnv {
  LE_JOB_SECRET?: string;
  NEBIUS_API_KEY?: string;
}

/**
 * The create request. `LE_JOB_SECRET` inside the job is the per-job secret HMAC(shared secret, job name), derived by the
 * same `deriveJobSecret` the app verifies with, and injected as a secret file. Neither it nor `NEBIUS_API_KEY` is ever an
 * environment variable of the job (the job record shows environment variables to anyone who can read it).
 */
export async function buildRunnerJob(args: RunnerArgs, env: RunnerEnv, now: Date = new Date()): Promise<BuiltJob> {
  const shared = env.LE_JOB_SECRET?.trim() ?? "";
  if (shared.length < MIN_JOB_SECRET_LENGTH) throw new UsageError(`LE_JOB_SECRET must be set in the environment (at least ${MIN_JOB_SECRET_LENGTH} characters).`);
  const apiKey = env.NEBIUS_API_KEY?.trim() ?? "";
  if (!apiKey && args.modes.some((m) => m !== "import")) throw new UsageError("NEBIUS_API_KEY must be set in the environment (certify and eval call Token Factory).");
  const name = localEditionJobName(args.modes, now);
  return buildLocalEditionJob({
    modes: args.modes,
    appUrl: args.appUrl,
    jobSecret: await deriveJobSecret(shared, name),
    secrets: apiKey ? { NEBIUS_API_KEY: apiKey } : undefined,
    env: args.csvUrl ? { IMPORT_CSV_URL: args.csvUrl } : undefined,
    bundle: JOB_BUNDLE,
    pack: JOB_PACK_B64,
    trigger: "manual",
    now,
  });
}

/** What a dry run prints: names and sizes, never a secret value. */
export function summarize(request: CreateJobRequest): string[] {
  const { metadata, spec } = request;
  const files = spec.injectedFiles ?? [];
  const bytes = files.reduce((n, f) => n + f.content.length, 0);
  return [
    `job: ${metadata.name} in ${metadata.parentId}`,
    `run: ${spec.containerCommand} ${spec.args} on ${spec.image}, ${spec.platform} ${spec.preset}, timeout ${spec.timeout}`,
    `env: ${(spec.environmentVariables ?? []).map((e) => `${e.name}=${e.name === "IMPORT_CSV_URL" ? `${new URL(e.value).origin}/...` : e.value}`).join(" ")}`,
    `injected files (${files.length}, ${bytes} base64 bytes): ${files.map((f) => f.containerPath).join(", ")}`,
    `secret files hold: ${files.filter((f) => f.containerPath.startsWith("/opt/le-secrets/")).map((f) => f.containerPath.split("/").pop()).join(", ") || "none"} (values not shown)`,
  ];
}

/** Replaces every occurrence of a secret value in text that came back from the job's logs or an error. */
export function redact(text: string, secrets: ReadonlyArray<string | undefined>): string {
  return secrets.reduce<string>((t, s) => (s && s.length >= 8 ? t.split(s).join("[redacted]") : t), text);
}
