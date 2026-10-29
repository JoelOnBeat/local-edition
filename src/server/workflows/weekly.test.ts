import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryRepo } from "../store/memory";
import { DEMO_WORKSPACE_ID, ensureDemoWorkspace } from "../session";
import { JobStartRetryable } from "./nebius-start";
import { handleScheduled, weeklyRunId } from "./cron";
import { FakeStep, freshLog, okStore, params, scriptedPorts } from "./test-utils";
import { runWeeklyRebuild, type WeeklyPorts } from "./weekly";
import type { PlatformEnv } from "../platform/env";

const disposers: Array<() => Promise<void>> = [];
afterEach(async () => { await Promise.all(disposers.splice(0).map((d) => d())); });

async function weeklyPorts(startJob: WeeklyPorts["startJob"], over: { repo?: ReturnType<typeof createMemoryRepo> } = {}) {
  const repo = over.repo ?? createMemoryRepo();
  const demo = await ensureDemoWorkspace(repo);
  const ids = (await repo.listStores(demo.chainId)).map((s) => s.id);
  const log = await freshLog();
  disposers.push(log.dispose);
  const base = scriptedPorts(log.runLog, ids, okStore);
  return { ports: { ...base, repo, startJob, now: () => new Date("2026-11-02T00:00:05.000Z") } satisfies WeeklyPorts, ids, runLog: log.runLog, repo };
}

describe("WeeklyRebuild", () => {
  it("builds every demo store, records a JobRun with the Nebius job id, and says so in the note", async () => {
    const startJob = vi.fn(async () => ({ status: "started" as const, name: "local-edition-certify-eval-202611020000", jobId: "aijob-e04abc123", existing: false }));
    const { ports, ids, repo, runLog } = await weeklyPorts(startJob);
    const out = await runWeeklyRebuild(new FakeStep(), ports, params({ runId: "weekly-2026-11-02", workspaceId: DEMO_WORKSPACE_ID, trigger: "cron" }));
    expect(out.build).toMatchObject({ status: "done" });
    expect(out.build?.editionIds).toHaveLength(ids.length);
    expect(startJob).toHaveBeenCalledTimes(1);
    // The job name is fixed by the run's first step, so a retry cannot start a second job.
    const named = (startJob.mock.calls[0] as unknown as [Date])[0];
    expect(named.toISOString()).toBe((await repo.latestJobRun())?.startedAt);
    const job = await repo.latestJobRun();
    expect(job).toMatchObject({ trigger: "cron", mode: "rebuild", status: "done", nebiusJobId: "aijob-e04abc123" });
    expect(job?.note).toContain("Nebius job local-edition-certify-eval-202611020000 started (certify, then eval).");
    expect((await runLog.get("weekly-2026-11-02"))?.status).toBe("done");
  });

  it("still completes and records why when the Nebius job is skipped, refused or keeps failing", async () => {
    for (const [result, text] of [
      [{ status: "skipped", reason: "no_credentials" }, "not started (no credentials)"],
      [{ status: "failed", code: "nebius_bad_request" }, "not started (nebius_bad_request)"],
    ] as const) {
      const { ports, repo } = await weeklyPorts(async () => result);
      await runWeeklyRebuild(new FakeStep(), ports, params({ runId: "weekly-x", workspaceId: DEMO_WORKSPACE_ID, trigger: "cron" }));
      expect((await repo.latestJobRun())?.note).toContain(text);
    }
    const { ports, repo } = await weeklyPorts(async () => { throw new JobStartRetryable("nebius_unavailable"); });
    const step = new FakeStep();
    await runWeeklyRebuild(step, ports, params({ runId: "weekly-y", workspaceId: DEMO_WORKSPACE_ID, trigger: "cron" }));
    expect(step.attempts.get("certify")).toBe(3);
    expect((await repo.latestJobRun())).toMatchObject({ status: "done" });
  });

  it("does nothing when another job is already running", async () => {
    const repo = createMemoryRepo();
    await ensureDemoWorkspace(repo);
    await repo.putJobRun({ id: "job_live", trigger: "manual", startedAt: "2026-11-02T00:00:00.000Z", finishedAt: null, storeIds: [], status: "running", nebiusJobId: null, note: "" });
    const startJob = vi.fn();
    const { ports } = await weeklyPorts(startJob as never, { repo });
    const out = await runWeeklyRebuild(new FakeStep(), ports, params({ runId: "weekly-z", workspaceId: DEMO_WORKSPACE_ID }));
    expect(out).toEqual({ job: null, build: null, nebius: null });
    expect(startJob).not.toHaveBeenCalled();
  });
});

describe("cron handler", () => {
  const monday = Date.UTC(2026, 10, 2, 0, 0, 0);

  it("starts WeeklyRebuild under one id per trigger day and treats a duplicate trigger as already started", async () => {
    const create = vi.fn(async () => ({ id: "x", status: async () => ({ status: "queued" }) }));
    const env = { WEEKLY_REBUILD: { create, get: vi.fn() } } as unknown as PlatformEnv;
    expect(weeklyRunId(monday)).toBe("weekly-2026-11-02");
    expect(await handleScheduled(env, monday)).toEqual({ started: true, purged: 0 });
    expect(create).toHaveBeenCalledWith({ id: "weekly-2026-11-02", params: { runId: "weekly-2026-11-02", workspaceId: "demo", trigger: "cron" } });
    create.mockRejectedValueOnce(new Error("instance.already_exists"));
    expect((await handleScheduled(env, monday)).started).toBe(true);
  });

  it("reports a failure to start without throwing, and runs without the Workflow bound", async () => {
    const create = vi.fn(async () => { throw new Error("quota"); });
    expect((await handleScheduled({ WEEKLY_REBUILD: { create, get: vi.fn() } } as unknown as PlatformEnv, monday)).started).toBe(false);
    expect((await handleScheduled({} as PlatformEnv, monday)).started).toBe(false);
  });
});
