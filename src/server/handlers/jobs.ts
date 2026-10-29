import { z } from "zod";
import { routes } from "@/contract";
import { serverEnv } from "@/lib/env";
import { HttpError } from "../http/errors";
import { withRoute } from "../http/api";
import { verifySignature } from "../jobs/hmac";
import { startMondayJob } from "../jobs/monday";
import { getGuardrailsProbe } from "../jobs/ports";
import { getJobPorts } from "../jobs/wiring-agent";
import { providerStatus } from "../jobs/status";
import { getRepo } from "../store";

/** Optional signed extras. The route's zod body strips them; the signature covers them. */
const JobExtras = z.object({
  trigger: z.enum(["cron", "manual"]).default("cron"),
  nebiusJobId: z.string().min(1).max(120).nullable().optional(),
  /** Epoch seconds when the request was signed; checked for freshness when present. */
  ts: z.number().int().optional(),
});
export const SIGNATURE_MAX_AGE_SECONDS = 600;

export const runMondayJob = withRoute(routes.runMondayJob, async ({ headers, body }, { rawBody }) => {
  const secret = serverEnv().LE_JOB_SECRET;
  if (!secret) throw new HttpError(503, "job_secret_missing", "Weekly jobs are not configured on this server.");
  const raw = rawBody ?? "";
  if (!(await verifySignature(secret, raw, headers["x-le-signature"]))) {
    throw new HttpError(401, "bad_signature", "The request signature is not valid.");
  }
  const extras = JobExtras.safeParse(JSON.parse(raw.trim() === "" ? "{}" : raw));
  if (!extras.success) throw new HttpError(400, "invalid_input", "trigger, nebiusJobId or ts is malformed.");
  const { ts } = extras.data;
  if (ts !== undefined && Math.abs(Date.now() / 1000 - ts) > SIGNATURE_MAX_AGE_SECONDS) {
    throw new HttpError(401, "stale_signature", "The signed request is too old. Sign it again.");
  }
  return startMondayJob({
    repo: await getRepo(),
    ports: await getJobPorts(),
    trigger: extras.data.trigger,
    storeIds: body.storeIds,
    nebiusJobId: extras.data.nebiusJobId ?? null,
  });
});

export const getLatestJob = withRoute(routes.getLatestJob, async () => (await getRepo()).latestJobRun());

export const getStatus = withRoute(routes.getStatus, async () => providerStatus(getGuardrailsProbe()));
