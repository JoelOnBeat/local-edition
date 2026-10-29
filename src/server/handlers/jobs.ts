import { z } from "zod";
import { routes } from "@/contract";
import { MIN_JOB_SECRET_LENGTH, serverEnv } from "@/lib/env";
import { HttpError } from "../http/errors";
import { withRoute } from "../http/api";
import { signatureDigest, verifySignature } from "../jobs/hmac";
import { startMondayJob } from "../jobs/monday";
import { getGuardrailsProbe } from "../jobs/ports";
import { getJobPorts } from "../jobs/wiring-agent";
import { providerStatus } from "../jobs/status";
import { getRepo } from "../store";

/** Signed extras. The route's zod body strips them; the signature covers them. `ts` is required. */
const JobExtras = z.object({
  trigger: z.enum(["cron", "manual"]).default("cron"),
  nebiusJobId: z.string().min(1).max(120).nullable().optional(),
  /** Epoch seconds when the request was signed. */
  ts: z.number().int(),
});
export const SIGNATURE_MAX_AGE_SECONDS = 300;
/** A signed job body is a few hundred bytes; anything bigger is refused before it is read. */
export const JOB_BODY_MAX_BYTES = 16 * 1024;
/** Replay entries outlive the freshness window on both sides of "now". */
const REPLAY_TTL_SECONDS = SIGNATURE_MAX_AGE_SECONDS * 2 + 60;

function jobSecret(): string {
  const secret = serverEnv().LE_JOB_SECRET;
  if (!secret) throw new HttpError(503, "job_secret_missing", "Weekly jobs are not configured on this server.");
  if (secret.length < MIN_JOB_SECRET_LENGTH) {
    throw new HttpError(503, "job_secret_weak", `LE_JOB_SECRET must be at least ${MIN_JOB_SECRET_LENGTH} characters.`);
  }
  return secret;
}

/** Runs on the raw bytes before any parsing: no signature, no parse. Verifies over the exact bytes received. */
async function authenticate({ request, bytes }: { request: Request; bytes: Uint8Array }): Promise<void> {
  const secret = jobSecret();
  const signature = request.headers.get("x-le-signature");
  if (!signature) throw new HttpError(400, "invalid_input", "headers.x-le-signature: the signature header is required.");
  if (!(await verifySignature(secret, bytes, signature))) {
    throw new HttpError(401, "bad_signature", "The request signature is not valid.");
  }
}

export const runMondayJob = withRoute(
  routes.runMondayJob,
  async ({ headers, body }, { rawBody }) => {
    const extras = JobExtras.safeParse(JSON.parse((rawBody ?? "").trim() === "" ? "{}" : rawBody!));
    if (!extras.success) throw new HttpError(400, "invalid_input", "trigger, nebiusJobId or ts is missing or malformed (ts is required).");
    const { ts } = extras.data;
    if (Math.abs(Date.now() / 1000 - ts) > SIGNATURE_MAX_AGE_SECONDS) {
      throw new HttpError(401, "stale_signature", "The signed request is too old. Sign it again.");
    }
    // Replay cache: a signature is good once. Only a digest is stored, for the freshness window.
    const repo = await getRepo();
    const seenKey = `jobsig:${await signatureDigest(headers["x-le-signature"])}`;
    if (await repo.cacheGet<number>(seenKey)) {
      throw new HttpError(401, "replayed_signature", "This signed request was already used. Sign a new one.");
    }
    await repo.cachePut<number>(seenKey, 1, REPLAY_TTL_SECONDS);
    return startMondayJob({
      repo,
      ports: await getJobPorts(),
      trigger: extras.data.trigger,
      storeIds: body.storeIds,
      nebiusJobId: extras.data.nebiusJobId ?? null,
    });
  },
  { maxBodyBytes: JOB_BODY_MAX_BYTES, authenticate },
);

export const getLatestJob = withRoute(routes.getLatestJob, async () => (await getRepo()).latestJobRun());

export const getStatus = withRoute(routes.getStatus, async () => providerStatus(getGuardrailsProbe()));
