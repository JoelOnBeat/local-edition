import { describe, expect, it } from "vitest";
import { createNebiusRest } from "./index";
import { createJobsClient } from "./jobs";
import { buildLocalEditionJob } from "./job-spec";
import { isTerminalState, summarizeJob } from "./schemas";
import { createMemoryTokenCache } from "./token";
import { FAKE_TOKEN, scriptedFetch, testKeys } from "./test-utils";

const PROJECT = "project-e04yk83jbc00bwhyv60mbp";
const tokens = { getToken: async (o?: { forceRefresh?: boolean }) => (o?.forceRefresh ? `${FAKE_TOKEN}-fresh` : FAKE_TOKEN) };
const noSleep = async () => {};
const client = (...replies: Parameters<typeof scriptedFetch>) => {
  const f = scriptedFetch(...replies);
  return { ...f, jobs: createJobsClient({ tokens, fetchImpl: f.fetchImpl, sleep: noSleep }) };
};
const bundle = { "certify.py": "print('x')\n", "le_http.py": "# h\n", "requirements.txt": "nemoguardrails==0.24.1\n" };
const request = () => buildLocalEditionJob({ modes: ["certify"], appUrl: "https://localedition.pages.dev", jobSecret: "s".repeat(32), bundle, now: new Date("2026-10-29T14:05:00Z") }).request;

describe("create", () => {
  it("POSTs /ai/v1/jobs with a bearer token and the OpenAPI field names; the job id is operation.resourceId", async () => {
    const c = client({ body: { id: "operation-1", resourceId: "job-abc123", description: "Create job" } });
    const res = await c.jobs.create(request());
    expect(res.jobId).toBe("job-abc123");
    const [call] = c.calls;
    expect(call.method).toBe("POST");
    expect(call.url).toBe("https://api.nebius.cloud/ai/v1/jobs");
    expect(call.headers.authorization).toBe(`Bearer ${FAKE_TOKEN}`);
    expect(call.headers["content-type"]).toBe("application/json");
    const body = JSON.parse(call.body ?? "{}");
    expect(Object.keys(body).sort()).toEqual(["metadata", "spec"]);
    expect(body.metadata).toMatchObject({ parentId: PROJECT, name: "local-edition-certify-202610291405" });
    expect(body.spec).toMatchObject({
      image: "python:3.12-slim",
      platform: "cpu-d3",
      preset: "2vcpu-8gb",
      timeout: "3600s",
      restartAttempts: "0",
      disk: { type: "NETWORK_SSD", sizeBytes: "21474836480" },
      containerCommand: "bash",
    });
    expect(body.dryRun).toBeUndefined();
  });

  it("validate() sends dryRun: true and tolerates an operation without a job id", async () => {
    const c = client({ body: { id: "dry-run", description: "dry run" } });
    await c.jobs.validate(request());
    expect(JSON.parse(c.calls[0].body ?? "{}").dryRun).toBe(true);
  });

  it("is never retried on a 503 (a retry could start two jobs)", async () => {
    const c = client({ status: 503, body: { code: 14, message: "unavailable" } }, { body: { resourceId: "job-x" } });
    await expect(c.jobs.create(request())).rejects.toMatchObject({ code: "nebius_unavailable", status: 503 });
    expect(c.calls).toHaveLength(1);
  });

  it("treats an operation that finished with a non-zero gRPC status as a failure", async () => {
    const c = client({ body: { id: "op", resourceId: "job-1", status: { code: 8, message: "Quota exceeded" } } });
    await expect(c.jobs.create(request())).rejects.toMatchObject({ code: "nebius_quota" });
  });

  it("refreshes the token once on a 401 and retries with the new token", async () => {
    const c = client({ status: 401, body: { code: 16, message: "unauthenticated" } }, { body: { resourceId: "job-ok" } });
    expect((await c.jobs.create(request())).jobId).toBe("job-ok");
    expect(c.calls.map((x) => x.headers.authorization)).toEqual([`Bearer ${FAKE_TOKEN}`, `Bearer ${FAKE_TOKEN}-fresh`]);
  });

  it("gives up with nebius_auth when the refreshed token is also rejected", async () => {
    const c = client({ status: 401, body: { code: 16, message: "unauthenticated" } });
    await expect(c.jobs.create(request())).rejects.toMatchObject({ code: "nebius_auth", status: 401 });
    expect(c.calls).toHaveLength(2);
  });
});

describe("get, list, cancel, delete", () => {
  it("GET /ai/v1/jobs/{id} parses state and summarizes it", async () => {
    const c = client({ body: { metadata: { id: "job-1", name: "local-edition-certify-1" }, status: { state: "FAILED", stateDetails: { code: "Exit", message: "exit 3" } } } });
    const job = await c.jobs.get("job-1");
    expect(c.calls[0]).toMatchObject({ method: "GET", url: "https://api.nebius.cloud/ai/v1/jobs/job-1" });
    expect(summarizeJob(job)).toMatchObject({ id: "job-1", state: "FAILED", terminal: true, detail: "Exit: exit 3" });
  });

  it("encodes the id and getByName uses parentId and name query parameters", async () => {
    const c = client({ body: { metadata: { id: "job-2" } } });
    await c.jobs.getByName(PROJECT, "local-edition-eval-1");
    expect(c.calls[0].url).toBe(`https://api.nebius.cloud/ai/v1/jobs/get-by-name?parentId=${PROJECT}&name=local-edition-eval-1`);
    const d = client({ body: {} });
    await d.jobs.get("a/b");
    expect(d.calls[0].url).toBe("https://api.nebius.cloud/ai/v1/jobs/a%2Fb");
  });

  it("lists by parentId with paging parameters and follows nextPageToken in listAll", async () => {
    const c = client(
      { body: { items: [{ metadata: { id: "job-1" } }], nextPageToken: "t2" } },
      { body: { items: [{ metadata: { id: "job-2" } }] } },
    );
    const all = await c.jobs.listAll(PROJECT, { pageSize: 1 });
    expect(all.map((j) => j.metadata.id)).toEqual(["job-1", "job-2"]);
    expect(c.calls[0].url).toBe(`https://api.nebius.cloud/ai/v1/jobs?parentId=${PROJECT}&pageSize=1`);
    expect(c.calls[1].url).toBe(`https://api.nebius.cloud/ai/v1/jobs?parentId=${PROJECT}&pageSize=1&pageToken=t2`);
  });

  it("an empty project lists as an empty array", async () => {
    expect(await client({ body: {} }).jobs.listAll(PROJECT)).toEqual([]);
  });

  it("cancel POSTs {id} to /ai/v1/jobs/cancel; delete DELETEs /ai/v1/jobs/{id}", async () => {
    const c = client({ body: { id: "op" } });
    await c.jobs.cancel("job-9");
    await c.jobs.delete("job-9");
    expect(c.calls[0]).toMatchObject({ method: "POST", url: "https://api.nebius.cloud/ai/v1/jobs/cancel", body: JSON.stringify({ id: "job-9" }) });
    expect(c.calls[1]).toMatchObject({ method: "DELETE", url: "https://api.nebius.cloud/ai/v1/jobs/job-9", body: undefined });
    expect(c.calls[1].headers["content-type"]).toBeUndefined();
  });

  it("retries a GET on 5xx and on network errors, then succeeds", async () => {
    const c = client({ status: 502, text: "<html>bad gateway</html>" }, new Error("ECONNRESET"), { body: { metadata: { id: "job-1" } } });
    expect((await c.jobs.get("job-1")).metadata.id).toBe("job-1");
    expect(c.calls).toHaveLength(3);
  });

  it("stops retrying a GET after the configured attempts", async () => {
    const c = client({ status: 503, body: { code: 14, message: "down" } });
    await expect(c.jobs.get("job-1")).rejects.toMatchObject({ code: "nebius_unavailable" });
    expect(c.calls).toHaveLength(3);
  });

  it("terminal states", () => {
    for (const s of ["COMPLETED", "FAILED", "CANCELLED", "ERROR"]) expect(isTerminalState(s)).toBe(true);
    for (const s of ["PROVISIONING", "STARTING", "IMAGE_PULLING", "RUNNING", "CANCELLING", "DELETING", undefined]) expect(isTerminalState(s)).toBe(false);
  });
});

describe("error mapping to { error, code }", () => {
  const cases: Array<[string, number, unknown, string]> = [
    ["401 unauthenticated", 401, { code: 16, message: "unauthenticated" }, "nebius_auth"],
    ["403 permission denied", 403, { code: 7, message: "permission denied", details: [{ serviceError: { code: "PermissionDenied" } }] }, "nebius_auth"],
    ["429 rate limit", 429, { code: 8, message: "slow down" }, "nebius_quota"],
    ["gRPC 8 on a 400", 400, { code: 8, message: "Quota exceeded for gpus" }, "nebius_quota"],
    ["400 mentioning quota", 400, { code: 9, message: "Not enough quota: gpus in eu-west2" }, "nebius_quota"],
    ["not enough resources", 500, { code: 9, message: "x", details: [{ serviceError: { notEnoughResources: {} } }] }, "nebius_quota"],
    ["500", 500, { code: 13, message: "internal" }, "nebius_unavailable"],
    ["504 gateway page", 504, "<html>timeout</html>", "nebius_unavailable"],
    ["400 validation", 400, { code: 3, message: "validation errors:\n - metadata: value is required" }, "nebius_bad_request"],
    ["404", 404, { code: 5, message: "not found" }, "nebius_not_found"],
    ["409 duplicate name", 409, { code: 6, message: "already exists" }, "nebius_conflict"],
  ];
  it.each(cases)("%s -> %s", async (_label, status, body, code) => {
    const c = client({ status, ...(typeof body === "string" ? { text: body } : { body }) });
    const err = await c.jobs.create(request()).catch((e) => e);
    expect(err).toMatchObject({ code, status });
    expect(err.toErrorBody()).toEqual({ error: err.message, code });
    expect(err.message).not.toContain(FAKE_TOKEN);
  });

  it("maps a timeout and a connection failure to nebius_unavailable", async () => {
    const timeout = Object.assign(new Error("t"), { name: "TimeoutError" });
    for (const e of [timeout, new Error("ECONNREFUSED")]) {
      const c = client(e);
      await expect(c.jobs.create(request())).rejects.toMatchObject({ code: "nebius_unavailable" });
    }
  });

  it("flags quota and unavailable as retryable, auth and bad requests as not", async () => {
    const flag = async (status: number, body: unknown) => (await client({ status, body }).jobs.create(request()).catch((e) => e)).retryable;
    expect(await flag(429, { code: 8 })).toBe(true);
    expect(await flag(500, { code: 13 })).toBe(true);
    expect(await flag(401, { code: 16 })).toBe(false);
    expect(await flag(400, { code: 3, message: "bad" })).toBe(false);
  });

  it("rejects an unexpected success shape as nebius_unavailable", async () => {
    await expect(client({ text: "not json" }).jobs.get("job-1")).rejects.toMatchObject({ code: "nebius_unavailable" });
  });
});

describe("createNebiusRest", () => {
  it("wires credentials, token exchange and the client end to end", async () => {
    const { credentialsFileJson } = testKeys();
    const exchange = { body: { access_token: FAKE_TOKEN, expires_in: 43200 } };
    const f = scriptedFetch(exchange, { body: { items: [] } });
    const rest = createNebiusRest({ credentialsJson: credentialsFileJson, cache: createMemoryTokenCache(), fetchImpl: f.fetchImpl });
    await rest.jobs.list(PROJECT);
    expect(f.calls.map((c) => c.url)).toEqual(["https://auth.eu.nebius.com:443/oauth2/token/exchange", `https://api.nebius.cloud/ai/v1/jobs?parentId=${PROJECT}`]);
    expect(f.calls[1].headers.authorization).toBe(`Bearer ${FAKE_TOKEN}`);
  });

  it("throws nebius_auth when the secret is missing", () => {
    expect(() => createNebiusRest({ credentialsJson: undefined, cache: createMemoryTokenCache() })).toThrowError(expect.objectContaining({ code: "nebius_auth" }));
  });
});
