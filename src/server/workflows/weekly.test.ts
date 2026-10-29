import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryRepo } from "../store/memory";
import { DEMO_WORKSPACE_ID, ensureDemoWorkspace } from "../session";
import { JobStartRetryable } from "./nebius-start";
import { handleScheduled, weeklyRunId } from "./cron";
import { FakeStep, freshLog, okStore, params, scriptedPorts } from "./test-utils";
import { JOB_MAX_POLLS, runWeeklyRebuild, type WeeklyPorts } from "./weekly";
import type { PlatformEnv } from "../platform/env";

const disposers: Array<() => Promise<void>> = [];
afterEach(async () => { await Promise.all(disposers.splice(0).map((d) => d())); });

const ended: WeeklyPorts["checkJob"] = async () => ({ state: "COMPLETED", terminal: true });
const deleted: WeeklyPorts["deleteJob"] = async () => ({ status: "deleted", state: "COMPLETED" });

async function weeklyPorts(startJob: WeeklyPorts["startJob"], over: { repo?: ReturnType<typeof createMemoryRepo>; checkJob?: WeeklyPorts["checkJob"]; deleteJob?: WeeklyPorts["deleteJob"] } = {}) {
  const repo = over.repo ?? createMemoryRepo();
  const demo = await ensureDemoWorkspace(repo);
  const ids = (await repo.listStores(demo.chainId)).map((s) => s.id);
  const log = await freshLog();
  disposers.push(log.dispose);
  const base = scriptedPorts(log.runLog, ids, okStore);
  return { ports: { ...base, repo, startJob, checkJob: over.checkJob ?? ended, deleteJob: over.deleteJob ?? deleted, now: () => new Date("2026-11-02T00:00:05.000Z") } satisfies WeeklyPorts, ids, runLog: log.runLog, repo };
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
    expect(out).toEqual({ job: null, build: null, nebius: null, reaped: null });
    expect(startJob).not.toHaveBeenCalled();
  });
});

describe("WeeklyRebuild: L1, retried job-start", () => {
  it("a retry of job-start after its record was written still builds (it finds its own job, not a rival)", async () => {
    const startJob = vi.fn(async () => ({ status: "skipped" as const, reason: "no_credentials" as const }));
    const { ports, repo, ids } = await weeklyPorts(startJob);
    let first = true;
    const flaky = new FakeStep();
    const realDo = flaky.do.bind(flaky);
    // The step writes the JobRun, then fails once before it can return: the Workflow retries it.
    flaky.do = (async (name: string, config: never, cb: never) => {
      if (name !== "job-start") return realDo(name, config, cb);
      return realDo(name, config, (async (ctx: never) => {
        const out = await (cb as (c: never) => Promise<unknown>)(ctx);
        if (first) { first = false; throw new Error("step timed out after the write"); }
        return out;
      }) as never);
    }) as never;
    const out = await runWeeklyRebuild(flaky, ports, params({ runId: "weekly-retry", workspaceId: DEMO_WORKSPACE_ID, trigger: "cron" }));
    expect(flaky.attempts.get("job-start")).toBe(2);
    expect(out.build?.editionIds).toHaveLength(ids.length);
    expect((await repo.latestJobRun())).toMatchObject({ id: "job-weekly-retry", status: "done" });
  });

  it("does not revive a run that already finished", async () => {
    const { ports, runLog } = await weeklyPorts(vi.fn());
    await runLog.start("weekly-done", DEMO_WORKSPACE_ID, 1);
    await runLog.finish("weekly-done", "done");
    const out = await runWeeklyRebuild(new FakeStep(), ports, params({ runId: "weekly-done", workspaceId: DEMO_WORKSPACE_ID, trigger: "cron" }));
    expect(out.job).toBeNull();
  });
});

describe("WeeklyRebuild: M4, the Nebius job is deleted when it ends", () => {
  const started = { status: "started" as const, name: "local-edition-certify-eval-202611020000", jobId: "aijob-e04abc123", existing: false };

  it("polls until the job is terminal, deletes it, and records how it ended on the JobRun", async () => {
    const states = ["PROVISIONING", "RUNNING", "COMPLETED"];
    const checkJob = vi.fn(async () => { const state = states.shift()!; return { state, terminal: state === "COMPLETED" }; });
    const deleteJob = vi.fn(deleted);
    const { ports, repo } = await weeklyPorts(async () => started, { checkJob, deleteJob });
    const step = new FakeStep();
    const out = await runWeeklyRebuild(step, ports, params({ runId: "weekly-reap", workspaceId: DEMO_WORKSPACE_ID, trigger: "cron" }));
    expect(checkJob).toHaveBeenCalledTimes(3);
    expect(step.sleeps.map(([n]) => n)).toEqual(["certify-wait:0", "certify-wait:1", "certify-wait:2"]);
    expect(deleteJob).toHaveBeenCalledWith({ jobId: "aijob-e04abc123", name: started.name });
    expect(out.reaped).toEqual({ state: "COMPLETED", deleted: true });
    expect((await repo.latestJobRun())?.note).toMatch(/Job ended COMPLETED\. Deleted afterwards\.$/);
  });

  it("deletes a job that is still running after the longest wait (Nebius cancels it first) and says so", async () => {
    const checkJob = vi.fn(async () => ({ state: "RUNNING", terminal: false }));
    const deleteJob = vi.fn(deleted);
    const { ports, repo } = await weeklyPorts(async () => started, { checkJob, deleteJob });
    const out = await runWeeklyRebuild(new FakeStep(), ports, params({ runId: "weekly-stuck", workspaceId: DEMO_WORKSPACE_ID, trigger: "cron" }));
    expect(checkJob).toHaveBeenCalledTimes(JOB_MAX_POLLS);
    expect(deleteJob).toHaveBeenCalledTimes(1);
    expect(out.reaped?.state).toContain("still running after the wait");
    expect((await repo.latestJobRun())?.note).toContain("Deleted afterwards.");
  });

  it("keeps going when polling fails, and records a failed delete so it can be removed by hand", async () => {
    const checkJob = vi.fn(async () => { throw new Error("boom"); });
    const deleteJob = vi.fn(async () => ({ status: "failed" as const, code: "nebius_auth" }));
    const { ports, repo } = await weeklyPorts(async () => started, { checkJob, deleteJob });
    const out = await runWeeklyRebuild(new FakeStep(), ports, params({ runId: "weekly-fail", workspaceId: DEMO_WORKSPACE_ID, trigger: "cron" }));
    expect(out.reaped?.deleted).toBe(false);
    expect((await repo.latestJobRun())?.note).toContain("Not deleted (nebius_auth); delete it by hand.");
  });

  it("starts the job with a name stamped after the build, and never polls or deletes when no job started", async () => {
    const checkJob = vi.fn(ended);
    const deleteJob = vi.fn(deleted);
    const { ports } = await weeklyPorts(async () => ({ status: "skipped" as const, reason: "no_credentials" as const }), { checkJob, deleteJob });
    const out = await runWeeklyRebuild(new FakeStep(), ports, params({ runId: "weekly-none", workspaceId: DEMO_WORKSPACE_ID, trigger: "cron" }));
    expect(out.reaped).toBeNull();
    expect(checkJob).not.toHaveBeenCalled();
    expect(deleteJob).not.toHaveBeenCalled();
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
