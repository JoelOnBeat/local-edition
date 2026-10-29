import { z } from "zod";

/**
 * Request and response shapes for the Serverless AI Jobs REST API, taken from the public OpenAPI
 * (https://api.nebius.cloud/openapi.json, fetched 29 Oct 2026): schemas nebius.ai.v1.CreateJobRequest,
 * JobSpec, Job, JobStatus, ListJobsResponse and nebius.common.v1.Operation. int64 fields travel as
 * JSON strings. Responses are parsed loosely: unknown fields pass through, only what we rely on is checked.
 */

export const JOB_STATES = [
  "STATE_UNSPECIFIED", "PROVISIONING", "STARTING", "IMAGE_PULLING", "RUNNING", "COMPLETING",
  "COMPLETED", "CANCELLING", "CANCELLED", "DELETING", "FAILED", "ERROR",
] as const;
export type JobState = (typeof JOB_STATES)[number];

/** Terminal states: the job will not change again. */
export function isTerminalState(state: string | undefined): boolean {
  return state === "COMPLETED" || state === "FAILED" || state === "CANCELLED" || state === "ERROR";
}

/** nebius.ai.v1.JobSpec as we send it (camelCase; every field below exists in the OpenAPI). */
export interface JobSpecInput {
  image: string;
  /** Entrypoint command (`containerCommand`). */
  containerCommand?: string;
  /** Arguments passed to the entrypoint, one string. */
  args?: string;
  environmentVariables?: Array<{ name: string; value: string }>;
  workingDir?: string;
  /** Duration with an `s` suffix. Minimum 3600s, maximum 604800s (docs). */
  timeout?: string;
  /** "0" runs once; "-1" restarts on error. */
  restartAttempts?: string;
  platform?: string;
  preset?: string;
  disk?: { type: "NETWORK_SSD" | "NETWORK_HDD" | "NETWORK_SSD_NON_REPLICATED" | "NETWORK_SSD_IO_M3"; sizeBytes: string };
  /** Read-only files written before the process starts; `content` is base64, 1 byte to 64 KiB each. */
  injectedFiles?: Array<{ containerPath: string; content: string }>;
  registryCredentials?: { username?: string; password?: string };
  subnetId?: string;
  publicIp?: boolean;
  preemptible?: boolean;
  pricingModel?: { onDemand: Record<string, never> };
}

/** nebius.ai.v1.CreateJobRequest. */
export interface CreateJobRequest {
  metadata: { parentId: string; name: string; labels?: Record<string, string> };
  spec: JobSpecInput;
  /** Validate only; nothing is created or billed. */
  dryRun?: boolean;
}

const operationStatusSchema = z.object({ code: z.number().optional(), message: z.string().optional() }).loose();

/** nebius.common.v1.Operation. `resourceId` is the new job's id; `status` is set once the operation has finished. */
export const operationSchema = z
  .object({
    id: z.string().optional(),
    resourceId: z.string().optional(),
    description: z.string().optional(),
    finishedAt: z.string().optional(),
    status: operationStatusSchema.optional(),
  })
  .loose();
export type Operation = z.infer<typeof operationSchema>;

export const jobSchema = z
  .object({
    metadata: z
      .object({
        id: z.string().optional(),
        name: z.string().optional(),
        parentId: z.string().optional(),
        createdAt: z.string().optional(),
        labels: z.record(z.string(), z.string()).optional(),
      })
      .loose()
      .default({}),
    spec: z.object({ image: z.string().optional() }).loose().optional(),
    status: z
      .object({
        state: z.string().optional(),
        stateDetails: z.object({ code: z.string().optional(), message: z.string().optional() }).loose().optional(),
        startedAt: z.string().optional(),
        finishedAt: z.string().optional(),
      })
      .loose()
      .optional(),
  })
  .loose();
export type Job = z.infer<typeof jobSchema>;

export const listJobsSchema = z
  .object({ items: z.array(jobSchema).default([]), nextPageToken: z.string().optional() })
  .loose();

export interface JobSummary {
  id: string;
  name: string;
  state: string;
  terminal: boolean;
  startedAt?: string;
  finishedAt?: string;
  /** Nebius `stateDetails` (for FAILED or ERROR), already length-limited by the client. */
  detail?: string;
}

export function summarizeJob(job: Job): JobSummary {
  const state = job.status?.state ?? "STATE_UNSPECIFIED";
  const d = job.status?.stateDetails;
  const detail = [d?.code, d?.message].filter(Boolean).join(": ");
  return {
    id: job.metadata.id ?? "",
    name: job.metadata.name ?? "",
    state,
    terminal: isTerminalState(state),
    startedAt: job.status?.startedAt,
    finishedAt: job.status?.finishedAt,
    detail: detail ? detail.slice(0, 300) : undefined,
  };
}
