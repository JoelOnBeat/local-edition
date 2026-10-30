import { afterEach, describe, expect, it } from "vitest";
import { POST } from "@/app/api/editions/build/route";
import { GET } from "@/app/api/runs/route";
import { RunsResponse } from "@/contract";
import { setPlatformEnv, type PlatformEnv } from "../platform/env";
import { freshLog } from "./test-utils";
import { listRuns } from "./run-list";
import { RUN_STALE_MS, type RunLog } from "./run-log";

const disposers: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(disposers.splice(0).map((d) => d()));
  setPlatformEnv(undefined);
  delete process.env.BUILD_MODE;
});

const metrics = (usd: number, storeId = "s1") => ({ type: "step_metrics" as const, storeId, role: "agent" as const, model: "nvidia/Nemotron-3.5-Super-VL", ms: 900, promptTokens: 1000, cachedTokens: 0, completionTokens: 200, usd });

async function seed(runLog: RunLog, ws: string, id: string, usds: number[], status: "done" | "failed" | "done_with_skips" | "running") {
  await runLog.start(id, ws, 8);
  for (const u of usds) await runLog.append(id, ws, metrics(u));
  await runLog.append(id, ws, { type: "progress", runId: id, done: 3, total: 8 });
  await runLog.setProgress(id, 3);
  if (status !== "running") await runLog.finish(id, status);
}

describe("listRuns (the server's run log for the runs page)", () => {
  it("lists only this workspace's runs, newest first, with status, stores and summed model cost", async () => {
    let t = 1_800_000_000_000;
    const { db, runLog, dispose } = await freshLog(() => (t += 1000));
    disposers.push(dispose);
    await seed(runLog, "ws_a", "run_old", [0.004, 0.003], "done");
    await seed(runLog, "ws_b", "run_other", [9], "done");
    await seed(runLog, "ws_a", "run_new", [0.01], "done_with_skips");
    const runs = await listRuns(db, "ws_a", t + 5000);
    expect(runs.map((r) => r.id)).toEqual(["run_new", "run_old"]);
    expect(runs[0]).toMatchObject({ status: "done_with_skips", total: 8, done: 3 });
    expect(runs[0].usd).toBeCloseTo(0.01, 6);
    expect(runs[1].usd).toBeCloseTo(0.007, 6);
    expect(Date.parse(runs[0].startedAt)).toBeGreaterThan(Date.parse(runs[1].startedAt));
    expect(RunsResponse.safeParse({ runs }).success).toBe(true);
  });

  it("counts a retried store once (superseded attempts are not billed twice), and reads a quiet running run as failed", async () => {
    const t = 1_800_000_000_000;
    const { db, runLog, dispose } = await freshLog(() => t);
    disposers.push(dispose);
    await runLog.start("run_r", "ws_a", 1);
    await runLog.append("run_r", "ws_a", metrics(0.5), { scope: "s1", attempt: 1 });
    await runLog.append("run_r", "ws_a", metrics(0.002), { scope: "s1", attempt: 2 });
    expect((await listRuns(db, "ws_a", t))[0]).toMatchObject({ status: "running" });
    expect((await listRuns(db, "ws_a", t))[0].usd).toBeCloseTo(0.002, 6);
    expect((await listRuns(db, "ws_a", t + RUN_STALE_MS + 1))[0].status).toBe("failed");
  });

  it("answers an empty list for a workspace with no runs", async () => {
    const { db, dispose } = await freshLog();
    disposers.push(dispose);
    expect(await listRuns(db, "ws_none")).toEqual([]);
  });
});

describe("GET /api/runs and the replay of one named run", () => {
  async function platform() {
    const log = await freshLog();
    disposers.push(log.dispose);
    setPlatformEnv({ LE_DB: log.db, EDITION_BUILD: { create: async () => ({ id: "x" }) } } as unknown as PlatformEnv);
    process.env.BUILD_MODE = "workflow";
    return log;
  }
  const get = (cookie = "") => GET(new Request("http://localhost/api/runs", { headers: { "cf-connecting-ip": "10.8.8.8", ...(cookie ? { cookie } : {}) } }));
  const replay = (runId: string, cookie: string) =>
    POST(new Request("http://localhost/api/editions/build", { method: "POST", body: "{}", headers: { "content-type": "application/json", "cf-connecting-ip": "10.8.8.8", cookie, "last-event-id": "0", "x-le-run-id": runId } }));
  const cookieOf = (res: Response) => (res.headers.get("set-cookie") ?? "").split(";")[0];

  it("a visitor sees their own runs; another visitor's run id is a 404, not a replay", async () => {
    const { runLog } = await platform();
    const first = await get();
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ runs: [] });
    const cookie = cookieOf(first);
    const ws = decodeURIComponent(cookie.split("=")[1] ?? "");
    await runLog.start("run_mine", ws, 2);
    await runLog.append("run_mine", ws, { type: "run_started", runId: "run_mine", storeIds: ["a", "b"] });
    await runLog.append("run_mine", ws, metrics(0.02));
    await runLog.append("run_mine", ws, { type: "run_done", runId: "run_mine", editionIds: [] });
    await runLog.finish("run_mine", "done");
    await runLog.start("run_theirs", "ws_somebody_else", 1);

    const listed = (await (await get(cookie)).json()) as RunsResponse;
    expect(listed.runs.map((r) => r.id)).toEqual(["run_mine"]);

    const mine = await replay("run_mine", cookie);
    expect(mine.status).toBe(200);
    const text = await mine.text();
    expect(text).toContain('"type":"run_started"');
    expect(text).toContain('"type":"run_done"');
    const theirs = await replay("run_theirs", cookie);
    expect(theirs.status).toBe(404);
    expect(await theirs.json()).toMatchObject({ code: "run_not_found" });
    expect((await replay("run_nope", cookie)).status).toBe(404);
  });

  it("without a Workflow (dev, tests) the list is empty and a named replay never starts a build", async () => {
    setPlatformEnv(undefined);
    const res = await get();
    expect(await res.json()).toEqual({ runs: [] });
    const out = await replay("run_x", cookieOf(res));
    expect(out.status).toBe(404);
  });
});

