import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentEvent, JobRun } from "@/contract";
import { SIGNATURE_MAX_AGE_SECONDS, getLatestJob, getStatus, runMondayJob } from "@/server/handlers/jobs";
import { signBody, verifySignature } from "@/server/jobs/hmac";
import { STALE_RUN_MS, executeJob, mondayOf, startMondayJob } from "@/server/jobs/monday";
import type { BuildEditions } from "@/server/jobs/ports";
import { getJobPorts as getPorts } from "@/server/jobs/wiring-agent";
import { probeGuardrailsHttp, resetProbeCache } from "@/server/jobs/status";
import { getSpendMeter } from "@/server/http/spend";
import { DEMO_WORKSPACE_ID } from "@/server/session";
import type { Repo } from "@/server/store";
import { fakePorts, freshApp, req } from "./helpers";

const SECRET = "test-secret-not-real-0001-0123456789abcdef";
let repo: Repo;
const bg: Promise<unknown>[] = [];
const drain = () => Promise.all(bg.splice(0));

/** A build that stays 'running' until `release()`, to test calls that arrive mid-run. */
function gatedBuild() {
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const build: BuildEditions = async function* (args) { await gate; yield* goodBuild(args); };
  return { build, release };
}

const goodBuild: BuildEditions = async function* ({ stores, runId }) {
  yield { type: "run_started", runId, storeIds: stores.map((s) => s.id) };
  yield { type: "run_done", runId, editionIds: stores.map((s) => `ed_${s.id}`) };
};

function setup(build: BuildEditions = goodBuild, env: Record<string, string | undefined> = { LE_JOB_SECRET: SECRET }) {
  repo = freshApp(env, fakePorts({ buildEditions: build, background: (p) => { bg.push(p); } }));
}
beforeEach(() => { bg.length = 0; setup(); });

/** Each default-signed body gets a distinct ts so identical bodies are not replays of one signature. */
let tsOffset = 0;
async function post(body: unknown, opts: { secret?: string; signature?: string; raw?: string } = {}) {
  const withTs = body && typeof body === "object" && !("ts" in body) ? { ...body, ts: Math.floor(Date.now() / 1000) - tsOffset++ } : body;
  const raw = opts.raw ?? JSON.stringify(withTs);
  const signature = opts.signature ?? (await signBody(opts.secret ?? SECRET, raw));
  return runMondayJob(req("/api/jobs/monday", { method: "POST", headers: { "content-type": "application/json", "x-le-signature": signature }, body: raw }));
}

describe("T2 HMAC", () => {
  it("accepts the signature of the exact body and rejects any change, key or format", async () => {
    const sig = await signBody("k", '{"a":1}');
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
    expect(await verifySignature("k", '{"a":1}', sig)).toBe(true);
    expect(await verifySignature("k", '{"a":1}', `sha256=${sig.toUpperCase()}`)).toBe(true);
    expect(await verifySignature("k", '{"a":2}', sig)).toBe(false);
    expect(await verifySignature("other", '{"a":1}', sig)).toBe(false);
    for (const bad of ["", "zz", sig.slice(2), `${sig}00`, "0".repeat(64), "not hex at all".padEnd(64, "x")]) {
      expect(await verifySignature("k", '{"a":1}', bad)).toBe(false);
    }
  });

  it("verifies through crypto.subtle.verify (constant-time MAC compare), never string equality", async () => {
    const spy = vi.spyOn(crypto.subtle, "verify");
    await verifySignature("k", "body", await signBody("k", "body"));
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
    const src = await import("node:fs/promises").then((fs) => fs.readFile("src/server/jobs/hmac.ts", "utf8"));
    expect(src).not.toMatch(/===\s*(sig|signature|expected)/);
  });
});

describe("T2 POST /api/jobs/monday", () => {
  it("rejects a bad or missing signature with 401/400 and starts nothing", async () => {
    const forged = await post({}, { secret: "wrong-secret" });
    expect(forged.status).toBe(401);
    expect(await forged.json()).toEqual({ error: "The request signature is not valid.", code: "bad_signature" });
    const tampered = await post({}, { signature: await signBody(SECRET, '{"storeIds":["store_harlem"]}'), raw: "{}" });
    expect(tampered.status).toBe(401);
    const missing = await runMondayJob(req("/api/jobs/monday", { method: "POST", body: "{}" }));
    expect(missing.status).toBe(400);
    expect(await missing.json()).toMatchObject({ code: "invalid_input" });
    expect(await repo.latestJobRun()).toBeNull();
  });

  it("refuses everything (503) when the server has no LE_JOB_SECRET, even an 'empty key' signature", async () => {
    setup(goodBuild, {});
    const res = await post({}, { secret: "x" });
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: "job_secret_missing" });
  });

  it("starts a run for the demo workspace, returns it running, and finishes in the background", async () => {
    const res = await post({ trigger: "manual", nebiusJobId: "job-abc123" });
    expect(res.status).toBe(200);
    const run = (await res.json()) as JobRun;
    expect(run).toMatchObject({ status: "running", trigger: "manual", nebiusJobId: "job-abc123", finishedAt: null });
    expect(run.storeIds).toHaveLength(8);
    expect((await repo.getWorkspace(DEMO_WORKSPACE_ID))?.chainId).toBe("chain_kettle_kiln");

    await drain();
    const latest = (await (await getLatestJob(req("/api/jobs/latest"))).json()) as JobRun;
    expect(latest).toMatchObject({ id: run.id, status: "done", note: expect.stringContaining("Built 8 of 8") });
    expect(latest.finishedAt).not.toBeNull();
  });

  it("builds only the stores asked for, and 400s on a store that is not in the demo workspace", async () => {
    const ok = (await (await post({ storeIds: ["store_harlem", "store_astoria"] })).json()) as JobRun;
    expect(ok.storeIds.sort()).toEqual(["store_astoria", "store_harlem"]);
    await drain();
    setup();
    const res = await post({ storeIds: ["store_atlantis"] });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "unknown_store" });
  });

  it("returns the in-flight run instead of starting a second build when called again (replay-safe)", async () => {
    const gated = gatedBuild();
    setup(gated.build);
    const first = (await (await post({})).json()) as JobRun;
    const second = (await (await post({})).json()) as JobRun;
    expect(second.id).toBe(first.id);
    expect(bg).toHaveLength(1);
    gated.release();
    await drain();
    expect((await repo.getJobRun(first.id))?.status).toBe("done");
  });

  it("replaces a run that has been 'running' longer than the stale window", async () => {
    const gated = gatedBuild();
    setup(gated.build);
    let now = Date.parse("2026-11-02T00:00:00Z");
    const ports = await getPorts();
    const first = await startMondayJob({ repo, ports, trigger: "cron", now: () => new Date(now) });
    now += STALE_RUN_MS + 1000;
    const second = await startMondayJob({ repo, ports, trigger: "cron", now: () => new Date(now) });
    expect(second.id).not.toBe(first.id);
    expect((await repo.getJobRun(first.id))?.status).toBe("failed");
    gated.release();
    await drain();
  });

  it("enforces signed timestamps when present: fresh passes, stale is 401", async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    expect((await post({ ts: nowSec })).status).toBe(200);
    await drain();
    setup();
    const stale = await post({ ts: nowSec - SIGNATURE_MAX_AGE_SECONDS - 5 });
    expect(stale.status).toBe(401);
    expect(await stale.json()).toMatchObject({ code: "stale_signature" });
    expect((await post({ trigger: "weekly" })).status).toBe(400);
  });
});

describe("T4 job failure paths", () => {
  const run = (): JobRun => ({ id: "job_t", trigger: "cron", startedAt: "2026-11-02T00:00:00.000Z", finishedAt: null, storeIds: ["store_harlem"], status: "running", nebiusJobId: null, note: "" });
  const exec = async (build: BuildEditions) => {
    setup(build);
    return executeJob(run(), { repo, ports: await getPorts(), now: () => new Date("2026-11-02T00:05:00Z") });
  };

  it("fails with a code, not upstream text, when the build throws", async () => {
    const out = await exec(() => { throw new Error("sk-live-SECRET connect ECONNRESET"); });
    expect(out).toMatchObject({ status: "failed", note: "Build failed (internal)." });
    expect(JSON.stringify(out)).not.toContain("SECRET");
    expect((await repo.latestJobRun())?.status).toBe("failed");
  });

  it("fails when the stream ends without run_done, and keeps going past per-store errors", async () => {
    const noDone: BuildEditions = async function* () { yield { type: "error", storeId: "store_harlem", code: "spend_cap", message: "cap" } as AgentEvent; };
    expect(await exec(noDone)).toMatchObject({ status: "failed", note: "Build failed (spend_cap)." });
    const partial: BuildEditions = async function* ({ runId }) {
      yield { type: "error", storeId: "store_x", code: "timeout", message: "slow" };
      yield { type: "run_done", runId, editionIds: ["ed_1"] };
    };
    expect(await exec(partial)).toMatchObject({ status: "done", note: expect.stringContaining("1 error(s): timeout") });
  });

  it("reports failed when the build is not wired at all", async () => {
    setup(undefined, { LE_JOB_SECRET: SECRET });
    const out = await executeJob(run(), { repo, ports: { ...(await getPorts()), buildEditions: () => { throw new Error("not wired"); } }, now: () => new Date() });
    expect(out.status).toBe("failed");
  });
});

describe("T2 mondayOf", () => {
  it("returns the UTC Monday of the week", () => {
    expect(mondayOf(new Date("2026-11-02T00:00:00Z"))).toBe("2026-11-02");
    expect(mondayOf(new Date("2026-11-08T23:59:59Z"))).toBe("2026-11-02");
    expect(mondayOf(new Date("2026-10-29T10:00:00Z"))).toBe("2026-10-26");
  });
});

describe("T2 GET /api/jobs/latest and /api/status", () => {
  it("returns null before any run", async () => {
    const res = await getLatestJob(req("/api/jobs/latest"));
    expect(res.status).toBe(200);
    expect(await res.json()).toBeNull();
  });

  it("reports provider modes from env, missing keys in live mode, spend, and the guardrails probe", async () => {
    setup(goodBuild, { QLOO_MODE: "live", TF_MODE: "live", NEBIUS_API_KEY: "nb-test", TAVILY_MODE: "fixture", SPEND_CAP_USD: "7" });
    getSpendMeter(7).record("nvidia/nemotron-3-super-120b-a12b", 1_000_000, 0);
    const status = await (await getStatus(req("/api/status"))).json();
    expect(status).toMatchObject({ qloo: "missing-key", tokenfactory: "live", tavily: "fixture", guardrails: "up" });
    expect(status.spend.capUsd).toBe(7);
    expect(status.spend.usd).toBeGreaterThan(0);
    expect(JSON.stringify(status)).not.toContain("nb-test");
  });

  it("defaults to replay with no keys at all", async () => {
    setup(goodBuild, {});
    expect(await (await getStatus(req("/api/status"))).json()).toMatchObject({ qloo: "replay", tokenfactory: "replay", tavily: "replay" });
  });

  it("probes /v1/health with a timeout: up on 200, down on error status, timeout or network failure; caches briefly", async () => {
    const ok = vi.fn(async () => new Response("{}", { status: 200 }));
    expect(await probeGuardrailsHttp("http://g.test:8000", ok as unknown as typeof fetch, 1000)).toBe("up");
    expect(String((ok.mock.calls[0] as unknown[])[0])).toBe("http://g.test:8000/v1/health");
    expect(await probeGuardrailsHttp("http://g.test:8000", vi.fn() as unknown as typeof fetch, 5000)).toBe("up"); // cached, fetch unused
    resetProbeCache();
    expect(await probeGuardrailsHttp("http://g.test:8000", (async () => new Response("no", { status: 503 })) as unknown as typeof fetch)).toBe("down");
    resetProbeCache();
    expect(await probeGuardrailsHttp("http://g.test:8000", (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch)).toBe("down");
  });
});

describe("T2 background runner", () => {
  it("falls back to a plain running promise when there is no Cloudflare context (node)", async () => {
    const { runInBackground } = await import("@/server/jobs/background");
    let ran = false;
    runInBackground(Promise.resolve().then(() => { ran = true; }));
    runInBackground(Promise.reject(new Error("boom")));
    await new Promise((r) => setTimeout(r, 10));
    expect(ran).toBe(true);
  });
});
