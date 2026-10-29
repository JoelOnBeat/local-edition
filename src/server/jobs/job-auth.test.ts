import { beforeEach, describe, expect, it } from "vitest";
import { getPendingJobs, postJobResults } from "../handlers/job-batch";
import { runMondayJob } from "../handlers/jobs";
import { createD1Repo } from "../store/d1";
import { openTestD1 } from "../store/d1-test-utils";
import { deriveJobSecret, signRequest, type RequestScope } from "./hmac";
import { jobNameTime, jobSecretLive, requireFreshAndOnce, JOB_SECRET_WINDOW_MS } from "./job-auth";
import type { Repo } from "../store";
import { ensureDemoWorkspace } from "../session";
import { fakePorts, freshApp, req } from "../../../tests/e/helpers";

const SECRET = "job-secret-test-0123456789abcdef-xyz";
const NAME = "local-edition-certify-eval-202611020000";
const AT = Date.UTC(2026, 10, 2, 0, 0);
const nowSec = () => Math.floor(Date.now() / 1000);
let repo: Repo;
let tick = 0;

beforeEach(async () => {
  repo = freshApp({ LE_JOB_SECRET: SECRET }, fakePorts());
  await ensureDemoWorkspace(repo);
  tick = 0;
});

const sendGet = async (o: { secret?: string; jobId?: string; path?: string; method?: string; scope?: Partial<RequestScope> } = {}) => {
  const ts = String(nowSec() + ++tick);
  const sig = await signRequest(o.secret ?? SECRET, { method: "GET", path: "/api/jobs/pending", ts, jobId: o.jobId, ...o.scope });
  return getPendingJobs(req(o.path ?? "/api/jobs/pending", { method: o.method ?? "GET", headers: { "x-le-timestamp": ts, "x-le-signature": sig, ...(o.jobId ? { "x-le-job-id": o.jobId } : {}) } }));
};

describe("M3: the signature covers method and path, and a replay is refused atomically", () => {
  it("matches the Python client's bytes (a fixed vector computed by jobs/le_http.py)", async () => {
    expect(await signRequest(SECRET, { method: "POST", path: "/api/jobs/results", jobId: NAME }, '{"ts":1,"results":[]}')).toBe("cfc13ab585413804c8b0b6f9a1b84c0686f513d8bc544bf49fadf6d8b203fbf0");
    expect(await signRequest(SECRET, { method: "GET", path: "/api/jobs/pending", ts: "1793577600", jobId: NAME })).toBe("97af2d03077b24c6f969103a3f49e031bf5afbb8d6a0e1003a7fd029c43d7c36");
    expect(await deriveJobSecret(SECRET, NAME)).toBe("d62adc900d8e4d4a503c5cd715e0231db2205a735711f57f9049873f159b08b6");
  });

  it("refuses a MAC captured on another path (scheme 1) or another path/method (scheme 2)", async () => {
    const raw = JSON.stringify({ ts: nowSec(), results: [] });
    const onEval = await signRequest(SECRET, { method: "POST", path: "/api/jobs/eval" }, raw);
    const res = await postJobResults(req("/api/jobs/results", { method: "POST", headers: { "content-type": "application/json", "x-le-signature": onEval }, body: raw }));
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "bad_signature" });
    expect((await sendGet({ scope: { path: "/api/jobs/results" } })).status).toBe(401);
    expect((await sendGet({ scope: { method: "POST" } })).status).toBe(401);
    expect((await sendGet()).status).toBe(200);
  });

  it("refuses a MAC for a different job name than the header carries", async () => {
    const ts = String(nowSec() + 1);
    const sig = await signRequest(SECRET, { method: "GET", path: "/api/jobs/pending", ts, jobId: "someone-else" });
    const res = await getPendingJobs(req("/api/jobs/pending", { headers: { "x-le-timestamp": ts, "x-le-signature": sig, "x-le-job-id": NAME } }));
    expect(res.status).toBe(401);
  });

  it("takes the replay guard from the repo's atomic lock: 50 concurrent copies of one signature, exactly one wins", async () => {
    const { db, dispose } = await openTestD1();
    const d1 = createD1Repo(async () => db);
    const outcomes = await Promise.all(
      Array.from({ length: 50 }, () => requireFreshAndOnce(d1, nowSec(), "ab".repeat(32)).then(() => "ok", (e: { code?: string }) => e.code)),
    );
    expect(outcomes.filter((o) => o === "ok")).toHaveLength(1);
    expect(outcomes.filter((o) => o === "replayed_signature")).toHaveLength(49);
    const rows = (await db.prepare("SELECT name FROM locks").all<{ name: string }>()).results!;
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toMatch(/^jobsig:[0-9a-f]{64}$/); // only a digest, never the signature
    await dispose();
  });

  it("goes through acquireLock with the jobsig: prefix and a TTL longer than the freshness window", async () => {
    const seen: Array<[string, number]> = [];
    const spy = { ...repo, acquireLock: async (n: string, t: number) => { seen.push([n, t]); return "tok"; } } as unknown as Repo;
    await requireFreshAndOnce(spy, nowSec(), "cd".repeat(32));
    expect(seen[0][0]).toMatch(/^jobsig:/);
    expect(seen[0][1]).toBeGreaterThan(600);
  });
});

describe("M4: a per-job secret works for its job name only, on the job endpoints, within an hour of the name's timestamp", () => {
  it("reads the time out of a job name and rejects other shapes", () => {
    expect(jobNameTime(NAME)).toBe(AT);
    expect(jobNameTime("local-edition-eval-202611020000")).toBe(AT);
    for (const bad of ["local-edition-spike-1", "local-edition-certify-202613020000", "other-certify-202611020000", `${NAME}x`, ""]) expect(jobNameTime(bad), bad).toBeNull();
    expect(jobSecretLive(NAME, AT + 59 * 60_000)).toBe(true);
    expect(jobSecretLive(NAME, AT + JOB_SECRET_WINDOW_MS + 6 * 60_000)).toBe(false);
    expect(jobSecretLive(NAME, AT - 6 * 60_000)).toBe(false);
  });

  async function atTime(ms: number, run: () => Promise<void>) {
    const real = Date.now;
    Date.now = () => ms;
    try { await run(); } finally { Date.now = real; }
  }

  it("accepts the derived secret inside the window", async () => {
    await atTime(AT + 20 * 60_000, async () => {
      const derived = await deriveJobSecret(SECRET, NAME);
      expect((await sendGet({ secret: derived, jobId: NAME })).status).toBe(200);
    });
  });

  it("refuses it after an hour (+ skew) and before the job could exist", async () => {
    const derived = await deriveJobSecret(SECRET, NAME);
    await atTime(AT + 66 * 60_000, async () => expect((await sendGet({ secret: derived, jobId: NAME })).status).toBe(401));
    await atTime(AT - 10 * 60_000, async () => expect((await sendGet({ secret: derived, jobId: NAME })).status).toBe(401));
  });

  it("refuses it for another job name, for a name with a forged newer stamp, and with no job name at all", async () => {
    const derived = await deriveJobSecret(SECRET, NAME);
    await atTime(AT + 10 * 60_000, async () => {
      expect((await sendGet({ secret: derived, jobId: "local-edition-certify-eval-202611020005" })).status).toBe(401);
      expect((await sendGet({ secret: derived, jobId: "local-edition-eval-202611020000" })).status).toBe(401);
      expect((await sendGet({ secret: derived })).status).toBe(401);
    });
  });

  it("does not accept it on /api/jobs/monday, which starts a build", async () => {
    const derived = await deriveJobSecret(SECRET, NAME);
    await atTime(AT + 10 * 60_000, async () => {
      const raw = JSON.stringify({ ts: nowSec() });
      const sig = await signRequest(derived, { method: "POST", path: "/api/jobs/monday", jobId: NAME }, raw);
      const res = await runMondayJob(req("/api/jobs/monday", { method: "POST", headers: { "content-type": "application/json", "x-le-signature": sig, "x-le-job-id": NAME }, body: raw }));
      expect(res.status).toBe(401);
    });
  });

  it("still accepts the shared secret, and a derived secret cannot be used as the shared one on another job", async () => {
    expect((await sendGet()).status).toBe(200);
    const derived = await deriveJobSecret(SECRET, NAME);
    expect((await sendGet({ secret: derived })).status).toBe(401);
  });
});
