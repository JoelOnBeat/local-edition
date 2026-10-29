import type { z } from "zod";
import { mapHttpError, NebiusError, networkError, safeMessage } from "./errors";
import { jobSchema, listJobsSchema, operationSchema, type CreateJobRequest, type Job, type Operation } from "./schemas";

/** Where a bearer token comes from. The session runner supplies a CLI-issued token (`nebius iam get-access-token`). */
export interface TokenProvider {
  getToken(opts?: { forceRefresh?: boolean }): Promise<string>;
}

/** Session-only: never import this from `src/` or `worker/`. The Cloudflare edge cannot reach the Nebius control plane (docs/NEBIUS-REST.md). */
export const NEBIUS_API_BASE = "https://api.nebius.cloud";
const TIMEOUT_MS = 20_000;
const MAX_ERROR_BODY = 4096;
const MAX_BODY = 1_000_000; // a page of jobs can be large

export interface JobsClientOptions {
  tokens: TokenProvider;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  timeoutMs?: number;
  /** Extra attempts for GET on 5xx or network errors (create and delete are never retried). Default 2. */
  getRetries?: number;
  sleep?: (ms: number) => Promise<void>;
}

export interface CreatedJob {
  jobId: string;
  operation: Operation;
}

export interface JobsClient {
  /** POST /ai/v1/jobs. Returns the new job id (the operation's `resourceId`). Not retried: a retry could start a second job. */
  create(request: CreateJobRequest): Promise<CreatedJob>;
  /** POST /ai/v1/jobs with `dryRun: true`: validates the spec, creates nothing. */
  validate(request: Omit<CreateJobRequest, "dryRun">): Promise<void>;
  /** GET /ai/v1/jobs/{id}. */
  get(id: string): Promise<Job>;
  /** GET /ai/v1/jobs/get-by-name?parentId&name. */
  getByName(parentId: string, name: string): Promise<Job>;
  /** GET /ai/v1/jobs?parentId, one page. */
  list(parentId: string, opts?: { pageSize?: number; pageToken?: string }): Promise<{ items: Job[]; nextPageToken?: string }>;
  /** All pages of GET /ai/v1/jobs?parentId, at most `maxPages` (default 10). */
  listAll(parentId: string, opts?: { pageSize?: number; maxPages?: number }): Promise<Job[]>;
  /** POST /ai/v1/jobs/cancel: stops the VM and deletes its disk; the job record stays listed. */
  cancel(id: string): Promise<Operation>;
  /** DELETE /ai/v1/jobs/{id}: cancels a running job first, then removes the record. */
  delete(id: string): Promise<Operation>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function createJobsClient(opts: JobsClientOptions): JobsClient {
  const doFetch = opts.fetchImpl ?? fetch;
  const base = (opts.baseUrl ?? NEBIUS_API_BASE).replace(/\/+$/, "");
  const sleep = opts.sleep ?? defaultSleep;
  const getRetries = opts.getRetries ?? 2;

  async function attempt(method: string, path: string, body: unknown, what: string, token: string): Promise<{ status: number; text: string }> {
    let res: Response;
    try {
      res = await doFetch(`${base}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          accept: "application/json",
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(opts.timeoutMs ?? TIMEOUT_MS),
      });
    } catch (err) {
      throw networkError(what, err instanceof Error && err.name === "TimeoutError");
    }
    const text = (await res.text()).slice(0, MAX_BODY);
    if (!res.ok) throw mapHttpError(res.status, text.slice(0, MAX_ERROR_BODY), what);
    return { status: res.status, text };
  }

  /** One logical request: a 401 refreshes the token once; GETs retry on 5xx and network errors. */
  async function request<T>(method: string, path: string, body: unknown, schema: z.ZodType<T>, what: string): Promise<T> {
    const idempotent = method === "GET";
    let token = await opts.tokens.getToken();
    let refreshed = false;
    for (let tries = 0; ; tries++) {
      try {
        const { text, status } = await attempt(method, path, body, what, token);
        let json: unknown;
        try {
          json = text ? JSON.parse(text) : {};
        } catch {
          throw new NebiusError("nebius_unavailable", `Nebius returned a non-JSON body for ${what}.`, { status });
        }
        const parsed = schema.safeParse(json);
        if (!parsed.success) throw new NebiusError("nebius_unavailable", `Nebius returned an unexpected response shape for ${what}.`, { status });
        return parsed.data;
      } catch (err) {
        if (!(err instanceof NebiusError)) throw err;
        if (err.status === 401 && !refreshed) {
          refreshed = true;
          token = await opts.tokens.getToken({ forceRefresh: true });
          continue;
        }
        if (idempotent && err.code === "nebius_unavailable" && tries < getRetries) {
          await sleep(300 * 2 ** tries);
          continue;
        }
        throw err;
      }
    }
  }

  /** An Operation that already finished with a non-zero gRPC status is a failed call, not a success. */
  function assertOperationOk(op: Operation, what: string): Operation {
    const code = op.status?.code;
    if (code && code !== 0) {
      throw mapHttpError(code === 8 ? 429 : 400, JSON.stringify({ code, message: safeMessage(op.status?.message) }), what);
    }
    return op;
  }

  function list(parentId: string, o: { pageSize?: number; pageToken?: string } = {}) {
    const q = new URLSearchParams({ parentId });
    if (o.pageSize) q.set("pageSize", String(o.pageSize));
    if (o.pageToken) q.set("pageToken", o.pageToken);
    return request("GET", `/ai/v1/jobs?${q}`, undefined, listJobsSchema, "job list");
  }

  return {
    async create(req) {
      const what = "job create";
      const op = assertOperationOk(await request("POST", "/ai/v1/jobs", req, operationSchema, what), what);
      if (!op.resourceId && !req.dryRun) throw new NebiusError("nebius_unavailable", "Job create returned no job id.");
      return { jobId: op.resourceId ?? "", operation: op };
    },
    async validate(req) {
      await request("POST", "/ai/v1/jobs", { ...req, dryRun: true }, operationSchema, "job validate");
    },
    get: (id) => request("GET", `/ai/v1/jobs/${encodeURIComponent(id)}`, undefined, jobSchema, "job get"),
    getByName: (parentId, name) =>
      request("GET", `/ai/v1/jobs/get-by-name?${new URLSearchParams({ parentId, name })}`, undefined, jobSchema, "job get-by-name"),
    list,
    async listAll(parentId, o = {}) {
      const items: Job[] = [];
      let pageToken: string | undefined;
      for (let page = 0; page < (o.maxPages ?? 10); page++) {
        const res = await list(parentId, { pageSize: o.pageSize, pageToken });
        items.push(...res.items);
        pageToken = res.nextPageToken || undefined;
        if (!pageToken) break;
      }
      return items;
    },
    async cancel(id) {
      return assertOperationOk(await request("POST", "/ai/v1/jobs/cancel", { id }, operationSchema, "job cancel"), "job cancel");
    },
    async delete(id) {
      return assertOperationOk(await request("DELETE", `/ai/v1/jobs/${encodeURIComponent(id)}`, undefined, operationSchema, "job delete"), "job delete");
    },
  };
}
