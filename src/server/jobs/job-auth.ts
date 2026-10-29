import { MIN_JOB_SECRET_LENGTH, serverEnv } from "@/lib/env";
import { HttpError } from "../http/errors";
import type { Repo } from "../store";
import { deriveJobSecret, signatureDigest, signedBytes, verifySignature, type RequestScope } from "./hmac";

/** How long a signed request stays valid, in seconds, either side of "now". */
export const SIGNATURE_MAX_AGE_SECONDS = 300;
/** A signed job body is a few hundred bytes; anything bigger is refused before it is read. */
export const JOB_BODY_MAX_BYTES = 16 * 1024;
/** The certify and eval jobs post one verdict per item, so their bodies may be bigger. */
export const JOB_RESULT_MAX_BYTES = 256 * 1024;
/** Replay entries outlive the freshness window on both sides of "now". */
export const REPLAY_TTL_SECONDS = SIGNATURE_MAX_AGE_SECONDS * 2 + 60;

/** A derived per-job secret works for this long after the timestamp in the job's name (plus the clock skew allowed either side). */
export const JOB_SECRET_WINDOW_MS = 60 * 60 * 1000;
const JOB_SECRET_SKEW_MS = SIGNATURE_MAX_AGE_SECONDS * 1000;
/** Only the endpoints a job calls accept a derived secret; `/api/jobs/monday` (starts a build) needs the shared secret. */
export const JOB_SECRET_PATHS: ReadonlySet<string> = new Set(["/api/jobs/pending", "/api/jobs/results", "/api/jobs/eval", "/api/stores/import"]);
/** `local-edition-<modes>-<yyyymmddhhmm UTC>`, the name `buildLocalEditionJob` gives a job. */
const JOB_NAME = /^local-edition-(?:certify|eval|import)(?:-(?:certify|eval|import))*-(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})$/;

export function jobSecret(): string {
  const secret = serverEnv().LE_JOB_SECRET;
  if (!secret) throw new HttpError(503, "job_secret_missing", "Weekly jobs are not configured on this server.");
  if (secret.length < MIN_JOB_SECRET_LENGTH) {
    throw new HttpError(503, "job_secret_weak", `LE_JOB_SECRET must be at least ${MIN_JOB_SECRET_LENGTH} characters.`);
  }
  return secret;
}

/** The start time encoded in a job's name, or null when the name is not one of ours. */
export function jobNameTime(name: string): number | null {
  const m = JOB_NAME.exec(name);
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const at = Date.UTC(y, mo - 1, d, h, mi);
  return new Date(at).getUTCMonth() === mo - 1 ? at : null;
}

/** True when `now` is inside the job's validity window: from a little before its stamp to one hour after it. */
export function jobSecretLive(name: string, nowMs: number): boolean {
  const at = jobNameTime(name);
  return at !== null && nowMs >= at - JOB_SECRET_SKEW_MS && nowMs <= at + JOB_SECRET_WINDOW_MS + JOB_SECRET_SKEW_MS;
}

/** What the signature covers for this request: method, path, the job name header and (scheme 2) the timestamp header. */
function scopeOf(request: Request, ts?: string): RequestScope {
  return { method: request.method, path: new URL(request.url).pathname, ts, jobId: request.headers.get("x-le-job-id")?.trim() ?? "" };
}

/**
 * True when `signature` verifies over the request's signed bytes with the shared secret or, for a job endpoint and
 * a live job name, with that job's derived secret. Both checks run for a job request, so the answer does not depend on
 * which key was tried first.
 */
async function verifyRequest(request: Request, scope: RequestScope, body: Uint8Array, signature: string, nowMs: number): Promise<boolean> {
  const secret = jobSecret();
  const signed = signedBytes(scope, body);
  const master = await verifySignature(secret, signed, signature);
  let derived = false;
  if (scope.jobId && JOB_SECRET_PATHS.has(scope.path) && jobSecretLive(scope.jobId, nowMs)) {
    derived = await verifySignature(await deriveJobSecret(secret, scope.jobId), signed, signature);
  }
  return master || derived;
}

/** Scheme 1 (JSON body with `ts`): the signature covers method, path, job name and the exact bytes received. No signature, no parse. */
export async function authenticate({ request, bytes }: { request: Request; bytes: Uint8Array }, nowMs = Date.now()): Promise<void> {
  jobSecret();
  const signature = request.headers.get("x-le-signature");
  if (!signature) throw new HttpError(400, "invalid_input", "headers.x-le-signature: the signature header is required.");
  if (!(await verifyRequest(request, scopeOf(request), bytes, signature, nowMs))) {
    throw new HttpError(401, "bad_signature", "The request signature is not valid.");
  }
}

/**
 * Freshness window (`ts` in epoch seconds) and a replay guard: a signature is good once. The guard is the repo's atomic
 * lock (one conditional upsert in D1, so two isolates or colos cannot both win), keyed by a digest of the signature.
 */
export async function requireFreshAndOnce(repo: Repo, ts: number, signature: string, nowMs = Date.now()): Promise<void> {
  if (Math.abs(nowMs / 1000 - ts) > SIGNATURE_MAX_AGE_SECONDS) {
    throw new HttpError(401, "stale_signature", "The signed request is too old. Sign it again.");
  }
  const first = await repo.acquireLock(`jobsig:${await signatureDigest(signature)}`, REPLAY_TTL_SECONDS);
  if (!first) throw new HttpError(401, "replayed_signature", "This signed request was already used. Sign a new one.");
}

/**
 * Scheme 2 (header timestamp, for GET and CSV bodies): `x-le-timestamp` is epoch seconds and the signature covers the
 * timestamp, method, path, job name and body, so none of them can be swapped on a captured request.
 */
export async function authenticateTimestamped(request: Request, bytes: Uint8Array, repo: Repo, nowMs = Date.now()): Promise<void> {
  jobSecret();
  const signature = request.headers.get("x-le-signature");
  const stamp = request.headers.get("x-le-timestamp");
  if (!signature) throw new HttpError(400, "invalid_input", "headers.x-le-signature: the signature header is required.");
  if (!stamp || !/^\d{1,12}$/.test(stamp)) throw new HttpError(400, "invalid_input", "headers.x-le-timestamp: epoch seconds are required.");
  if (!(await verifyRequest(request, scopeOf(request, stamp), bytes, signature, nowMs))) throw new HttpError(401, "bad_signature", "The request signature is not valid.");
  await requireFreshAndOnce(repo, Number(stamp), signature, nowMs);
}
