import { beforeAll, describe, expect, it, vi } from "vitest";
import { createMemoryRepo } from "../store/memory";
import { JobStartRetryable, startWeeklyJob, type StartJobInput } from "./nebius-start";

let credentials = "";
const SECRET = "j".repeat(40);
const NOW = new Date("2026-11-02T00:00:05.000Z");

beforeAll(async () => {
  const pair = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  const der = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  const pem = `-----BEGIN PRIVATE KEY\u002d\u002d\u002d\u002d\u002d\n${btoa(String.fromCharCode(...der)).replace(/(.{64})/g, "$1\n")}\n-----END PRIVATE KEY-----\n`;
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
    expect(paths).toEqual(expect.arrayContaining(["/opt/le/certify.py", "/opt/le/le_http.py", "/opt/le/requirements.txt", "/opt/le/rails/batch.py", "/opt/le/rails/phrases.json", "/opt/le/run.sh"]));
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
