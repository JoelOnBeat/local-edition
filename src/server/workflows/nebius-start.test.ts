import { beforeAll, describe, expect, it, vi } from "vitest";
import { createMemoryRepo } from "../store/memory";
import { deriveJobSecret } from "../jobs/hmac";
import { checkWeeklyJob, deleteWeeklyJob, JobStartRetryable, startWeeklyJob, type StartJobInput } from "./nebius-start";
import { pemArmor } from "../nebius/test-utils";

let credentials = "";
const SECRET = "j".repeat(40);
const NOW = new Date("2026-11-02T00:00:05.000Z");

beforeAll(async () => {
  const pair = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  const der = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  const pem = pemArmor("PRIVATE KEY", btoa(String.fromCharCode(...der)));
  credentials = JSON.stringify({ "subject-credentials": { type: "JWT", alg: "RS256", "private-key": pem, kid: "publickey-test", iss: "serviceaccount-test", sub: "serviceaccount-test" } });
});

const env = () => ({ NEBIUS_SA_CREDENTIALS: credentials, APP_URL: "https://localedition.pages.dev", LE_JOB_SECRET: SECRET, NEBIUS_API_KEY: "tf-key-for-lightning" });
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** Routes the token exchange and the jobs API; `create` decides what POST /ai/v1/jobs answers. */
function fakeNebius(create: (body: Record<string, unknown>) => Response) {
  const calls: Array<{ url: string; method: string; body: string }> = [];
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, method: init?.method ?? "GET", body: String(init?.body ?? "") });
    if (u.includes("/oauth2/token/exchange")) return json(200, { access_token: "iam-token-".padEnd(40, "x"), expires_in: 43200, token_type: "Bearer" });
    if (u.includes("/ai/v1/jobs/get-by-name")) return json(200, { metadata: { id: "aijob-existing", name: "n" } });
    if (u.endsWith("/ai/v1/jobs")) return create(JSON.parse(String(init?.body)));
    return json(404, { code: 5, message: "not found" });
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls };
}

const input = (fetchImpl: typeof fetch, over: Partial<StartJobInput> = {}): StartJobInput => ({ env: env(), repo: createMemoryRepo(), now: NOW, fetchImpl, ...over });

describe("startWeeklyJob", () => {
  it("exchanges a JWT, creates one certify + eval job with the bundle, and returns its id", async () => {
    const { fetchImpl, calls } = fakeNebius(() => json(200, { id: "op1", resourceId: "aijob-e04new" }));
    const res = await startWeeklyJob(input(fetchImpl));
    expect(res).toEqual({ status: "started", name: "local-edition-certify-eval-202611020000", jobId: "aijob-e04new", existing: false });
    expect(calls.map((c) => `${c.method} ${new URL(c.url).pathname}`)).toEqual(["POST /oauth2/token/exchange", "POST /ai/v1/jobs"]);
    const body = JSON.parse(calls[1].body);
    expect(body.spec).toMatchObject({ image: "python:3.12-slim", platform: "cpu-d3", preset: "2vcpu-8gb", args: "/opt/le/run.sh certify eval", timeout: "3600s" });
    const paths = body.spec.injectedFiles.map((f: { containerPath: string }) => f.containerPath);
    // The files travel as one gzipped pack (Nebius refuses more than 64 KiB of injected files in total); run.sh unpacks it.
    expect(paths).toEqual(["/opt/le/run.sh", "/opt/le/bundle.json.gz", "/opt/le-secrets/LE_JOB_SECRET", "/opt/le-secrets/NEBIUS_API_KEY"]);
    expect(body.spec.environmentVariables.find((e: { name: string }) => e.name === "APP_URL").value).toBe("https://localedition.pages.dev");
  });

  it("keeps the secrets out of the plain environment (they ride as injected files)", async () => {
    const { fetchImpl, calls } = fakeNebius(() => json(200, { resourceId: "aijob-x" }));
    await startWeeklyJob(input(fetchImpl));
    const body = JSON.parse(calls[1].body);
    expect(JSON.stringify(body.spec.environmentVariables)).not.toContain(SECRET);
    expect(JSON.stringify(body.spec.environmentVariables)).not.toContain("tf-key-for-lightning");
  });

  it("reuses the cached IAM token on the next start", async () => {
    const repo = createMemoryRepo();
    const a = fakeNebius(() => json(200, { resourceId: "aijob-a" }));
    await startWeeklyJob(input(a.fetchImpl, { repo }));
    const b = fakeNebius(() => json(200, { resourceId: "aijob-b" }));
    await startWeeklyJob(input(b.fetchImpl, { repo, now: new Date("2026-11-09T00:00:00Z") }));
    expect(b.calls.map((c) => new URL(c.url).pathname)).toEqual(["/ai/v1/jobs"]);
  });

  it("a retried step finds the job its first attempt created (409 conflict -> get-by-name)", async () => {
    const { fetchImpl } = fakeNebius(() => json(409, { code: 6, message: "already exists" }));
    expect(await startWeeklyJob(input(fetchImpl))).toEqual({ status: "started", name: "local-edition-certify-eval-202611020000", jobId: "aijob-existing", existing: true });
  });

  it("skips without credentials, an https app url or a long enough job secret, and calls nothing", async () => {
    const fetchImpl = vi.fn();
    const f = fetchImpl as unknown as typeof fetch;
    expect(await startWeeklyJob(input(f, { env: { ...env(), NEBIUS_SA_CREDENTIALS: undefined } }))).toEqual({ status: "skipped", reason: "no_credentials" });
    expect(await startWeeklyJob(input(f, { env: { ...env(), APP_URL: "http://localhost:3000" } }))).toEqual({ status: "skipped", reason: "no_app_url" });
    expect(await startWeeklyJob(input(f, { env: { ...env(), LE_JOB_SECRET: "short" } }))).toEqual({ status: "skipped", reason: "no_job_secret" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("fails without retry for a malformed credentials secret or a refused request, and never echoes secrets", async () => {
    const bad = fakeNebius(() => json(200, {}));
    const r1 = await startWeeklyJob(input(bad.fetchImpl, { env: { ...env(), NEBIUS_SA_CREDENTIALS: "{not json" } }));
    expect(r1).toMatchObject({ status: "failed", code: "nebius_auth" });
    const refused = fakeNebius(() => json(400, { code: 3, message: `bad preset ${SECRET}` }));
    const r2 = await startWeeklyJob(input(refused.fetchImpl));
    expect(r2).toEqual({ status: "failed", code: "nebius_bad_request" });
    expect(JSON.stringify(r2)).not.toContain(SECRET);
  });

  it("throws a retryable error when Nebius is unavailable or out of capacity", async () => {
    const down = fakeNebius(() => json(503, { code: 14, message: "unavailable" }));
    await expect(startWeeklyJob(input(down.fetchImpl))).rejects.toBeInstanceOf(JobStartRetryable);
    const quota = fakeNebius(() => json(429, { code: 8, message: "quota" }));
    await expect(startWeeklyJob(input(quota.fetchImpl))).rejects.toBeInstanceOf(JobStartRetryable);
  });
});

describe("M4: what goes into the job", () => {
  const fileText = (body: { spec: { injectedFiles: Array<{ containerPath: string; content: string }> } }, path: string) => {
    const f = body.spec.injectedFiles.find((x) => x.containerPath === path);
    return f ? atob(f.content) : null;
  };

  it("injects the per-job secret HMAC(shared, job name), never the shared secret itself", async () => {
    const { fetchImpl, calls } = fakeNebius(() => json(200, { resourceId: "aijob-x" }));
    const res = await startWeeklyJob(input(fetchImpl));
    const body = JSON.parse(calls[1].body);
    const name = (res as { name: string }).name;
    expect(fileText(body, "/opt/le-secrets/LE_JOB_SECRET")).toBe(await deriveJobSecret(SECRET, name));
    expect(calls[1].body).not.toContain(SECRET);
    expect(JSON.stringify(body)).not.toContain(btoa(SECRET));
    // The job still gets the model key for the NeMo self check, as a secret file, not an environment variable.
    expect(fileText(body, "/opt/le-secrets/NEBIUS_API_KEY")).toBe("tf-key-for-lightning");
  });

  it("a different run gets a different secret (the name carries the time)", async () => {
    const a = fakeNebius(() => json(200, { resourceId: "aijob-a" }));
    const b = fakeNebius(() => json(200, { resourceId: "aijob-b" }));
    await startWeeklyJob(input(a.fetchImpl));
    await startWeeklyJob(input(b.fetchImpl, { now: new Date("2026-11-09T00:00:00Z") }));
    const secretOf = (calls: Array<{ url: string; body: string }>) => fileText(JSON.parse(calls.find((c) => c.url.endsWith("/ai/v1/jobs"))!.body), "/opt/le-secrets/LE_JOB_SECRET");
    expect(secretOf(a.calls)).toMatch(/^[0-9a-f]{64}$/);
    expect(secretOf(a.calls)).not.toBe(secretOf(b.calls));
  });
});

describe("M4: checking and deleting the finished job", () => {
  const ref = { jobId: "aijob-e04abc", name: "local-edition-certify-eval-202611020000" };
  function jobsApi(handlers: { get?: () => Response; del?: () => Response; byName?: () => Response }) {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = new URL(String(url));
      calls.push(`${init?.method ?? "GET"} ${u.pathname}`);
      if (u.pathname.includes("/oauth2/token/exchange")) return json(200, { access_token: "iam-token-".padEnd(40, "x"), expires_in: 43200, token_type: "Bearer" });
      if (u.pathname.endsWith("get-by-name")) return (handlers.byName ?? (() => json(200, { metadata: { id: "aijob-byname" }, status: { state: "RUNNING" } })))();
      if ((init?.method ?? "GET") === "DELETE") return (handlers.del ?? (() => json(200, { id: "op-del" })))();
      return (handlers.get ?? (() => json(200, { metadata: { id: ref.jobId }, status: { state: "COMPLETED" } })))();
    });
    return { fetchImpl: fetchImpl as unknown as typeof fetch, calls };
  }

  it("reports the state and whether it is terminal", async () => {
    for (const [state, terminal] of [["RUNNING", false], ["PROVISIONING", false], ["COMPLETED", true], ["FAILED", true], ["CANCELLED", true], ["DELETING", true]] as const) {
      const { fetchImpl } = jobsApi({ get: () => json(200, { metadata: { id: ref.jobId }, status: { state } }) });
      expect(await checkWeeklyJob(input(fetchImpl), ref)).toEqual({ state, terminal });
    }
  });

  it("treats a job that is already gone as finished, looks a name up when there is no id, and retries a transient error", async () => {
    expect(await checkWeeklyJob(input(jobsApi({ get: () => json(404, { code: 5, message: "no" }) }).fetchImpl), ref)).toEqual({ state: "DELETED", terminal: true });
    const named = jobsApi({});
    expect(await checkWeeklyJob(input(named.fetchImpl), { jobId: null, name: ref.name })).toEqual({ state: "RUNNING", terminal: false });
    expect(named.calls.some((c) => c.includes("get-by-name"))).toBe(true);
    await expect(checkWeeklyJob(input(jobsApi({ get: () => json(503, { code: 14, message: "down" }) }).fetchImpl), ref)).rejects.toBeInstanceOf(JobStartRetryable);
  });

  it("deletes the job by id, treats not-found as done, and reports a refusal without throwing", async () => {
    const ok = jobsApi({});
    expect(await deleteWeeklyJob(input(ok.fetchImpl), ref)).toEqual({ status: "deleted", state: "COMPLETED" });
    expect(ok.calls).toContain(`DELETE /ai/v1/jobs/${ref.jobId}`);
    expect(await deleteWeeklyJob(input(jobsApi({ del: () => json(404, { code: 5, message: "gone" }) }).fetchImpl), ref)).toEqual({ status: "gone" });
    expect(await deleteWeeklyJob(input(jobsApi({ del: () => json(403, { code: 7, message: "no" }) }).fetchImpl), ref)).toEqual({ status: "failed", code: "nebius_auth" });
    await expect(deleteWeeklyJob(input(jobsApi({ del: () => json(503, { code: 14, message: "down" }) }).fetchImpl), ref)).rejects.toBeInstanceOf(JobStartRetryable);
  });

  it("finds the job by name when only the name is known", async () => {
    const byName = jobsApi({});
    expect(await deleteWeeklyJob(input(byName.fetchImpl), { jobId: null, name: ref.name })).toEqual({ status: "deleted", state: "RUNNING" });
    expect(byName.calls).toContain("DELETE /ai/v1/jobs/aijob-byname");
  });

  it("does nothing without credentials", async () => {
    const f = vi.fn() as unknown as typeof fetch;
    expect(await deleteWeeklyJob(input(f, { env: { ...env(), NEBIUS_SA_CREDENTIALS: undefined } }), ref)).toEqual({ status: "failed", code: "no_credentials" });
    expect(await checkWeeklyJob(input(f, { env: { ...env(), NEBIUS_SA_CREDENTIALS: undefined } }), ref)).toEqual({ state: "UNKNOWN", terminal: true });
    expect(f).not.toHaveBeenCalled();
  });
});
