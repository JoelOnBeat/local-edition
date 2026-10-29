import { MIN_JOB_SECRET_LENGTH, serverEnv } from "@/lib/env";
import { HttpError } from "../http/errors";
import type { Repo } from "../store";
import { signatureDigest, verifySignature } from "./hmac";

/** How long a signed request stays valid, in seconds, either side of "now". */
export const SIGNATURE_MAX_AGE_SECONDS = 300;
/** A signed job body is a few hundred bytes; anything bigger is refused before it is read. */
export const JOB_BODY_MAX_BYTES = 16 * 1024;
/** The certify and eval jobs post one verdict per item, so their bodies may be bigger. */
export const JOB_RESULT_MAX_BYTES = 256 * 1024;
/** Replay entries outlive the freshness window on both sides of "now". */
export const REPLAY_TTL_SECONDS = SIGNATURE_MAX_AGE_SECONDS * 2 + 60;

export function jobSecret(): string {
  const secret = serverEnv().LE_JOB_SECRET;
  if (!secret) throw new HttpError(503, "job_secret_missing", "Weekly jobs are not configured on this server.");
  if (secret.length < MIN_JOB_SECRET_LENGTH) {
    throw new HttpError(503, "job_secret_weak", `LE_JOB_SECRET must be at least ${MIN_JOB_SECRET_LENGTH} characters.`);
  }
  return secret;
}

/** Scheme 1 (JSON body with `ts`): the signature covers the exact bytes received. No signature, no parse. */
export async function authenticate({ request, bytes }: { request: Request; bytes: Uint8Array }): Promise<void> {
  const secret = jobSecret();
  const signature = request.headers.get("x-le-signature");
  if (!signature) throw new HttpError(400, "invalid_input", "headers.x-le-signature: the signature header is required.");
  if (!(await verifySignature(secret, bytes, signature))) {
    throw new HttpError(401, "bad_signature", "The request signature is not valid.");
  }
}

/** Freshness window (`ts` in epoch seconds) and a replay cache: a signature is good once. Only a digest is stored. */
export async function requireFreshAndOnce(repo: Repo, ts: number, signature: string, nowMs = Date.now()): Promise<void> {
  if (Math.abs(nowMs / 1000 - ts) > SIGNATURE_MAX_AGE_SECONDS) {
    throw new HttpError(401, "stale_signature", "The signed request is too old. Sign it again.");
  }
  const seenKey = `jobsig:${await signatureDigest(signature)}`;
  if (await repo.cacheGet<number>(seenKey)) {
    throw new HttpError(401, "replayed_signature", "This signed request was already used. Sign a new one.");
  }
  await repo.cachePut<number>(seenKey, 1, REPLAY_TTL_SECONDS);
}

/**
 * Scheme 2 (header timestamp, for GET and CSV bodies): `x-le-timestamp` is epoch seconds and the signature covers
 * "<ts>." + body, so the timestamp cannot be swapped on a captured request.
 */
export async function authenticateTimestamped(request: Request, bytes: Uint8Array, repo: Repo, nowMs = Date.now()): Promise<void> {
  const secret = jobSecret();
  const signature = request.headers.get("x-le-signature");
  const stamp = request.headers.get("x-le-timestamp");
  if (!signature) throw new HttpError(400, "invalid_input", "headers.x-le-signature: the signature header is required.");
  if (!stamp || !/^\d{1,12}$/.test(stamp)) throw new HttpError(400, "invalid_input", "headers.x-le-timestamp: epoch seconds are required.");
  const prefix = new TextEncoder().encode(`${stamp}.`);
  const signed = new Uint8Array(prefix.length + bytes.length);
  signed.set(prefix, 0);
  signed.set(bytes, prefix.length);
  if (!(await verifySignature(secret, signed, signature))) throw new HttpError(401, "bad_signature", "The request signature is not valid.");
  await requireFreshAndOnce(repo, Number(stamp), signature, nowMs);
}
