import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { JobRun } from "@/contract";
import { GET as proofGET } from "@/app/api/proof/route";
import { ProofBody, scriptShaFrom } from "@/server/handlers/proof";
import { LEDGER_KEYS, recordJobRun } from "@/server/handlers/proof-ledger";
import { recordEditions, recordStep } from "./ledger-helpers";
import { mockEval, mockJobRuns, MOCK_CERTIFY_SHA } from "@/mocks/upgrade-data";
import type { Repo } from "@/server/store";
import { ensureDemoWorkspace } from "@/server/session";
import { cleanEdition, freshApp, req } from "../e/helpers";

const GIT = "3f9c2ab71d0e4c5a8b6f1e2d3c4b5a69788796a5";
const saved = { ...process.env };
let repo: Repo;
beforeEach(() => {
  repo = freshApp();
  delete process.env.GIT_SHA;
  delete process.env.JOB_SCRIPT_SHA;
});
afterEach(() => {
  process.env = { ...saved };
});

const get = (ip = "198.51.100.40") => proofGET(req("/api/proof", { ip }));
const body = async (res: Response) => ProofBody.parse(await res.json());

describe("GET /api/proof", () => {
  it("reports nulls and no runs when nothing has been recorded, and mints no cookie", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(await body(res)).toMatchObject({ jobRuns: [], eval: null, scriptSha: null, gitSha: null, spendPerEditionUsd: null, cachedRatio: null, seenModels: [], editionCount: 0, reviews: [] });
  });

  it("returns the newest run of each mode with its job id, newest first", async () => {
    for (const run of mockJobRuns) await recordJobRun(repo, run);
    const { jobRuns } = await body(await get());
    expect(new Set(jobRuns.map((r) => r.mode))).toEqual(new Set(["rebuild", "certify", "eval", "import"]));
    expect(jobRuns.find((r) => r.mode === "certify")?.nebiusJobId).toBe(mockJobRuns[1].nebiusJobId);
    const times = jobRuns.map((r) => r.startedAt);
    expect(times).toEqual([...times].sort().reverse());
  });

  it("a newer run of a mode replaces the older one", async () => {
    await recordJobRun(repo, mockJobRuns[1]);
    await recordJobRun(repo, { ...mockJobRuns[1], id: "job_certify_next", startedAt: "2026-11-02T00:05:00.000Z", nebiusJobId: "nebius-job-new1" });
    const certify = (await body(await get())).jobRuns.filter((r) => r.mode === "certify");
    expect(certify.map((r) => r.id)).toEqual(["job_certify_next"]);
  });

  it("includes the repo's latest run even when it was saved without the ledger", async () => {
    await repo.putJobRun(mockJobRuns[0]);
    expect((await body(await get())).jobRuns.map((r) => r.id)).toEqual([mockJobRuns[0].id]);
  });

  it("serves the stored eval and ignores a row that no longer parses", async () => {
    await repo.cachePut(LEDGER_KEYS.evalLatest, mockEval, 3600);
    expect((await body(await get())).eval?.caught).toBe(mockEval.caught);
    await repo.cachePut(LEDGER_KEYS.evalLatest, { at: "yesterday", cases: "many" }, 3600);
    expect((await body(await get())).eval).toBeNull();
  });

  it("computes spend per edition and the cached ratio from recorded step metrics", async () => {
    await recordStep(repo, 1000, 400, 100, 0.002);
    await recordStep(repo, 3000, 1100, 200, 0.004);
    const beforeEditions = await body(await get());
    expect(beforeEditions.cachedRatio).toBeCloseTo(1500 / 4000, 10);
    expect(beforeEditions.spendPerEditionUsd).toBeNull(); // no finished edition to divide by
    await recordEditions(repo, 2);
    const after = await body(await get());
    expect(after.spendPerEditionUsd).toBeCloseTo(0.003, 10);
  });

  it("returns null for the ratio when no prompt tokens were recorded", async () => {
    await recordEditions(repo, 1);
    const res = await body(await get());
    expect(res.cachedRatio).toBeNull();
    expect(res.spendPerEditionUsd).toBe(0);
  });

  it("reads the git and script SHAs from env, lowercased, and drops values that are not hex", async () => {
    process.env.GIT_SHA = GIT.toUpperCase();
    process.env.JOB_SCRIPT_SHA = MOCK_CERTIFY_SHA;
    const res = await body(await get());
    expect(res.gitSha).toBe(GIT);
    expect(res.scriptSha).toBe(MOCK_CERTIFY_SHA);
    process.env.GIT_SHA = "not a sha; drop table";
    process.env.JOB_SCRIPT_SHA = "xyz";
    const bad = await body(await get());
    expect(bad.gitSha).toBeNull();
    expect(bad.scriptSha).toBeNull();
  });

  it("falls back to the script hash the newest certify run reported", () => {
    const runs = mockJobRuns.map((r) => JobRun.parse(r));
    expect(scriptShaFrom(runs, {})).toBe(MOCK_CERTIFY_SHA);
    expect(scriptShaFrom([], {})).toBeNull();
    expect(scriptShaFrom(runs, { JOB_SCRIPT_SHA: "abcdef1" })).toBe("abcdef1");
  });

  it("answers 429 with { error, code } once an address exhausts its allowance", async () => {
    let last: Response | undefined;
    for (let i = 0; i < 62; i++) last = await get("203.0.113.77");
    expect(last!.status).toBe(429);
    expect(await last!.json()).toMatchObject({ code: "rate_limited" });
    expect((await get("203.0.113.78")).status).toBe(200);
  });

  it("never leaks a secret or a stack: the body holds only the proof fields", async () => {
    process.env.LE_JOB_SECRET = "s".repeat(40);
    process.env.NEBIUS_API_KEY = "nb-secret-value";
    const text = await (await get()).text();
    expect(text).not.toContain("secret");
    expect(Object.keys(JSON.parse(text)).sort()).toEqual(["cachedRatio", "editionCount", "eval", "gitSha", "jobRuns", "reviews", "sample", "scriptSha", "seenModels", "spendPerEditionUsd", "steps"]);
  });

  it("names the model per step from the server's model table", async () => {
    const { steps } = await body(await get());
    expect(steps.find((s) => s.step === "Edition agent")?.model).toBe("nvidia/Nemotron-3.5-Super-VL");
    expect(steps.find((s) => s.step === "Chain review")?.model).toBe("nvidia/Nemotron-3-Ultra-550b-a55b");
    expect(steps.find((s) => s.step === "Copy")?.model).toBe("nvidia/Nemotron-3_5-Lightning");
  });

  it("reads the demo workspace's editions and reviews without creating a workspace or a cookie", async () => {
    const demo = await ensureDemoWorkspace(repo);
    const [store] = await repo.listStores(demo.chainId);
    const e = cleanEdition(store.id, "ed_demo_proof");
    await repo.putEdition({ ...e, storeId: store.id, review: { verdict: "needs_change", reason: "Two stores push the same special.", clashWith: [], hint: "Swap the Astoria special.", reviewedBy: "nvidia/Nemotron-3-Ultra-550b-a55b", at: "2026-10-30T10:00:00.000Z" } });
    const res = await get();
    expect(res.headers.get("set-cookie")).toBeNull();
    const b = await body(res);
    expect(b.editionCount).toBe(1);
    expect(b.reviews).toEqual([expect.objectContaining({ storeId: store.id, storeName: store.name, verdict: "needs_change", hint: "Swap the Astoria special." })]);
    expect(b.seenModels).toContain("nvidia/Nemotron-3-Ultra-550b-a55b");
  });
});
