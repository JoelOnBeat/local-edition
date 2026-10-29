import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryRepo } from "../store/memory";
import { DEMO_WORKSPACE_ID, ensureDemoWorkspace } from "../session";
import { handleScheduled, weeklyRunId } from "./cron";
import { FakeStep, freshLog, okStore, params, scriptedPorts } from "./test-utils";
import { CERTIFY_ON_DEMAND_NOTE, runWeeklyRebuild, type WeeklyPorts } from "./weekly";
import type { PlatformEnv } from "../platform/env";

const disposers: Array<() => Promise<void>> = [];
afterEach(async () => { await Promise.all(disposers.splice(0).map((d) => d())); });

async function weeklyPorts(over: { repo?: ReturnType<typeof createMemoryRepo> } = {}) {
  const repo = over.repo ?? createMemoryRepo();
  const demo = await ensureDemoWorkspace(repo);
  const ids = (await repo.listStores(demo.chainId)).map((s) => s.id);
  const log = await freshLog();
  disposers.push(log.dispose);
  const base = scriptedPorts(log.runLog, ids, okStore);
  return { ports: { ...base, repo, now: () => new Date("2026-11-02T00:00:05.000Z") } satisfies WeeklyPorts, ids, runLog: log.runLog, repo };
}

describe("WeeklyRebuild", () => {
  it("builds every demo store with no Nebius ports at all, and records the on-demand certification note", async () => {
    const { ports, ids, repo, runLog } = await weeklyPorts();
    // The ports are exactly the build ports plus a repo and a clock: nothing in them can reach Nebius.
    expect(Object.keys(ports).sort()).toEqual(["buildStore", "now", "planStores", "repo", "runLog"]);
    const step = new FakeStep();
    const out = await runWeeklyRebuild(step, ports, params({ runId: "weekly-2026-11-02", workspaceId: DEMO_WORKSPACE_ID, trigger: "cron" }));
    expect(out.build).toMatchObject({ status: "done" });
    expect(out.build?.editionIds).toHaveLength(ids.length);
    const job = await repo.latestJobRun();
    expect(job).toMatchObject({ trigger: "cron", mode: "rebuild", status: "done", nebiusJobId: null });
    expect(job?.note).toContain(`Built ${ids.length} of ${ids.length} editions.`);
    expect(job?.note).toContain(CERTIFY_ON_DEMAND_NOTE);
    expect(CERTIFY_ON_DEMAND_NOTE).toMatch(/pending.*on demand from the CLI/);
    expect(step.order.some((n) => /certif|nebius|reap|job-outcome/i.test(n))).toBe(false);
    expect((await runLog.get("weekly-2026-11-02"))?.status).toBe("done");
  });

  it("counts a store that could not be built and still names the on-demand certification", async () => {
    const repo = createMemoryRepo();
    const demo = await ensureDemoWorkspace(repo);
    const ids = (await repo.listStores(demo.chainId)).map((s) => s.id);
    const log = await freshLog();
    disposers.push(log.dispose);
    const base = scriptedPorts(log.runLog, ids, (id) => (id === ids[0] ? [{ type: "error", storeId: id, code: "store_failed", message: "no" } as never] : okStore(id, 1)));
    const out = await runWeeklyRebuild(new FakeStep(), { ...base, repo, now: () => new Date("2026-11-02T00:00:05.000Z") }, params({ runId: "weekly-bad", workspaceId: DEMO_WORKSPACE_ID, trigger: "cron" }));
    const job = await repo.latestJobRun();
    expect(out.build?.failedStoreIds).toEqual([ids[0]]);
    expect(job?.note).toContain(`Built ${ids.length - 1} of ${ids.length} editions; 1 store(s) failed.`);
    expect(job?.note).toContain(CERTIFY_ON_DEMAND_NOTE);
  });

  it("does nothing when another job is already running", async () => {
    const repo = createMemoryRepo();
    await ensureDemoWorkspace(repo);
    await repo.putJobRun({ id: "job_live", trigger: "manual", startedAt: "2026-11-02T00:00:00.000Z", finishedAt: null, storeIds: [], status: "running", nebiusJobId: null, note: "" });
    const { ports } = await weeklyPorts({ repo });
    const out = await runWeeklyRebuild(new FakeStep(), ports, params({ runId: "weekly-z", workspaceId: DEMO_WORKSPACE_ID }));
    expect(out).toEqual({ job: null, build: null });
  });
});

describe("WeeklyRebuild: L1, retried job-start", () => {
  it("a retry of job-start after its record was written still builds (it finds its own job, not a rival)", async () => {
    const { ports, repo, ids } = await weeklyPorts();
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
    const { ports, runLog } = await weeklyPorts();
    await runLog.start("weekly-done", DEMO_WORKSPACE_ID, 1);
    await runLog.finish("weekly-done", "done");
    const out = await runWeeklyRebuild(new FakeStep(), ports, params({ runId: "weekly-done", workspaceId: DEMO_WORKSPACE_ID, trigger: "cron" }));
    expect(out.job).toBeNull();
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
