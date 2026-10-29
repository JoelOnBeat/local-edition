import { z } from "zod";
import { routes } from "@/contract";
import { HttpError } from "../http/errors";
import { withRoute } from "../http/api";
import { JOB_BODY_MAX_BYTES, SIGNATURE_MAX_AGE_SECONDS, authenticate, requireFreshAndOnce } from "../jobs/job-auth";
import { startMondayJob } from "../jobs/monday";
import { getGuardrailsProbe } from "../jobs/ports";
import { getJobPorts } from "../jobs/wiring-agent";
import { providerStatus } from "../jobs/status";
import { getRepo } from "../store";

export { JOB_BODY_MAX_BYTES, SIGNATURE_MAX_AGE_SECONDS };

/** Signed extras. The route's zod body strips them; the signature covers them. `ts` is required. */
const JobExtras = z.object({
  trigger: z.enum(["cron", "manual"]).default("cron"),
  nebiusJobId: z.string().min(1).max(120).nullable().optional(),
  /** Epoch seconds when the request was signed. */
  ts: z.number().int(),
});
export const runMondayJob = withRoute(
  routes.runMondayJob,
  async ({ headers, body }, { rawBody }) => {
    const extras = JobExtras.safeParse(JSON.parse((rawBody ?? "").trim() === "" ? "{}" : rawBody!));
    if (!extras.success) throw new HttpError(400, "invalid_input", "trigger, nebiusJobId or ts is missing or malformed (ts is required).");
    const repo = await getRepo();
    await requireFreshAndOnce(repo, extras.data.ts, headers["x-le-signature"]);
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
