import { afterEach, describe, expect, it } from "vitest";
import { acquireBuildLock, ownedBuildLock, releaseBuildLock, WORKFLOW_LOCK_TTL_SECONDS } from "../agent/build-lock";
import { buildEditions } from "../agent/build";
import { setPlatformEnv, type PlatformEnv } from "../platform/env";
import { BuildLockCore } from "../platform/lock-core";
import type { BuildLockStub } from "../platform/stubs";
import { setRepo } from "../store";
import { openTestD1 } from "../store/d1-test-utils";
import { createMemoryRepo } from "../store/memory";
import type { RunLock } from "./edition-build";
import { CrashError, FakeStep, freshLog, okStore, params, runEditionBuild, scriptedPorts, types, type StoreScript } from "./test-utils";
import { realBuildPorts } from "./wiring";

const disposers: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(disposers.splice(0).map((d) => d()));
  setPlatformEnv(undefined);
});

function storage() {
  const m = new Map<string, unknown>();
  return { get: async <T,>(k: string) => m.get(k) as T | undefined, put: async (k: string, v: unknown) => void m.set(k, v), delete: async (k: string) => m.delete(k) };
}

/** A workspace lock the way production holds it: one BuildLockCore per workspace behind the RunLock port. */
function lockPort(now: () => number = Date.now) {
  const cores = new Map<string, BuildLockCore>();
  const core = (ws: string) => cores.get(ws) ?? (cores.set(ws, new BuildLockCore(storage(), now)), cores.get(ws)!);
  const log: string[] = [];
  const port: RunLock = {
    async acquire(ws, owner, ttl) {
      const token = await core(ws).acquire(ttl, `owner:${owner}`);
      log.push(`acquire:${owner}:${token ? "ok" : "busy"}`);
      return token !== null;
    },
    async release(ws, owner) { log.push(`release:${owner}`); await core(ws).release(`owner:${owner}`); },
  };
  return { port, core, log };
}

const setup = async (runId = "run_t1", total = 3) => {
  const log = await freshLog();
  disposers.push(log.dispose);
  await log.runLog.start(runId, "ws_t", total);
  return log.runLog;
};

describe("M6: the Workflow owns the workspace lock for the whole run", () => {
  it("takes the lock in plan, extends it at every store, and releases it in finish, before the run row says done", async () => {
    const runLog = await setup();
    const { port, core, log } = lockPort();
    const ports = { ...scriptedPorts(runLog, ["a", "b"], okStore), lock: port };
    const out = await runEditionBuild(new FakeStep(), ports, params());
    expect(out.status).toBe("done");
    expect(log).toEqual(["acquire:run_t1:ok", "acquire:run_t1:ok", "acquire:run_t1:ok", "release:run_t1"]);
    // free again once the run is over
    expect(await core("ws_t").acquire(60)).toBeTruthy();
  });

  it("holds the lock across the stores: another build cannot start in the middle of the run", async () => {
    const runLog = await setup();
    const { port, core } = lockPort();
    const intruders: Array<string | null> = [];
    const script: StoreScript = (id) => okStore(id, 1);
    const base = scriptedPorts(runLog, ["a", "b", "c"], script);
    const ports = {
      ...base,
      lock: port,
      async *buildStore(storeId: string, p: Parameters<typeof base.buildStore>[1]) {
        intruders.push(await core("ws_t").acquire(30)); // a rival (a rebuild, or a regenerate) between and during stores
        yield* base.buildStore(storeId, p);
      },
    };
    await runEditionBuild(new FakeStep(), ports, params());
    expect(intruders).toEqual([null, null, null]);
  });

  it("a retried plan step re-acquires its own lock instead of finding itself locked out", async () => {
    const runLog = await setup();
    const { port, log } = lockPort();
    const step = new FakeStep();
    const realDo = step.do.bind(step);
    let failed = false;
    step.do = (async (name: string, cfg: never, cb: never) =>
      realDo(name, cfg, (async (ctx: never) => {
        const out = await (cb as (c: never) => Promise<unknown>)(ctx);
        if (name === "plan" && !failed) { failed = true; throw new Error("died after taking the lock"); }
        return out;
      }) as never)) as never;
    const out = await runEditionBuild(step, { ...scriptedPorts(runLog, ["a"], okStore), lock: port }, params());
    expect(out.status).toBe("done");
    expect(step.attempts.get("plan")).toBe(2);
    expect(log.filter((l) => l.startsWith("acquire:run_t1:busy"))).toHaveLength(0);
  });

  it("a Workflow that resumes after the engine died takes its own lock back and carries on", async () => {
    const runLog = await setup();
    const { port, log } = lockPort();
    const ports = { ...scriptedPorts(runLog, ["a", "b", "c"], okStore), lock: port };
    const step = new FakeStep();
    step.crashAfter = 3; // plan, store:a, progress:0 done; the engine dies before store:b
    await expect(runEditionBuild(step, ports, params())).rejects.toBeInstanceOf(CrashError);
    step.crashAfter = null;
    const out = await runEditionBuild(step, ports, params());
    expect(out.editionIds).toEqual(["ed_a", "ed_b", "ed_c"]);
    expect(log.some((l) => l.endsWith(":busy"))).toBe(false);
    expect(log.at(-1)).toBe("release:run_t1");
  });

  it("another holder of the lock fails the run with build_running and builds nothing", async () => {
    const runLog = await setup();
    const { port, core } = lockPort();
    await core("ws_t").acquire(600, "owner:someone-else");
    const calls: string[] = [];
    const out = await runEditionBuild(new FakeStep(), { ...scriptedPorts(runLog, ["a"], okStore, calls), lock: port }, params());
    expect(out.status).toBe("failed");
    expect(calls).toEqual([]);
    expect(await types(runLog)).toEqual(["error"]);
    expect((await runLog.readFrom("run_t1", 0))[0].event).toMatchObject({ code: "build_running" });
    expect((await runLog.get("run_t1"))?.status).toBe("failed");
  });

  it("an unreachable lock fails the run (no fallback lock) and the rest of the stores are not built", async () => {
    const runLog = await setup();
    const calls: string[] = [];
    const port: RunLock = { acquire: async () => { throw new Error("Durable Object reset"); }, release: async () => undefined };
    const out = await runEditionBuild(new FakeStep(), { ...scriptedPorts(runLog, ["a", "b"], okStore, calls), lock: port }, params());
    expect(out.status).toBe("failed");
    expect(calls).toEqual([]);
    expect((await runLog.readFrom("run_t1", 0))[0].event).toMatchObject({ code: "lock_unavailable" });
    expect((await runLog.get("run_t1"))?.status).toBe("failed");
  });

  it("a store step that finds the lock gone (it expired and someone took it) fails instead of building under no lock", async () => {
    const runLog = await setup();
    const { port, core } = lockPort();
    const calls: string[] = [];
    const base = scriptedPorts(runLog, ["a", "b"], okStore, calls);
    let n = 0;
    const stolen: RunLock = {
      acquire: async (ws, owner, ttl) => {
        if (++n === 2) { await core(ws).release(`owner:${owner}`); await core(ws).acquire(600, "owner:thief"); }
        return port.acquire(ws, owner, ttl);
      },
      release: port.release,
    };
    const out = await runEditionBuild(new FakeStep(), { ...base, lock: stolen }, params());
    expect(calls).not.toContain("a");
    expect(out.failedStoreIds).toEqual(["a", "b"]);
  });

  it("releases the lock when the run dies on an unexpected error, not at the end of its TTL", async () => {
    const runLog = await setup();
    const { port, core } = lockPort();
    const step = new FakeStep();
    const realDo = step.do.bind(step);
    step.do = (async (name: string, cfg: never, cb: never) => {
      if (name === "finish") throw new Error("finish kept failing");
      return realDo(name, cfg, cb);
    }) as never;
    await expect(runEditionBuild(step, { ...scriptedPorts(runLog, ["a"], okStore), lock: port }, params())).rejects.toThrow("finish kept failing");
    expect(await core("ws_t").acquire(60)).toBeTruthy();
    expect((await runLog.get("run_t1"))?.status).toBe("failed");
  });

  it("holds the lock for 30 minutes at a time, which each store step extends", () => {
    expect(WORKFLOW_LOCK_TTL_SECONDS).toBe(30 * 60);
  });
});

describe("M6: the lock helpers", () => {
  it("lends the run's lock to buildEditions, which neither takes another nor releases it", async () => {
    const stub: BuildLockStub & { calls: string[] } = Object.assign(new BuildLockCore(storage()), { calls: [] as string[] });
    const env = { BUILD_LOCK: { idFromName: (n: string) => n, get: () => stub } } as unknown as PlatformEnv;
    setPlatformEnv(env);
    const repo = createMemoryRepo();
    const held = await acquireBuildLock(repo, "ws_a", { owner: "run_1", ttlSeconds: 60 });
    expect(held).toMatchObject({ backend: "do" });
    expect(await stub.acquire(60)).toBeNull();
    const borrowed = ownedBuildLock("ws_a", "run_1");
    expect(borrowed).toMatchObject({ token: held.token, borrowed: true });
    // a build that is handed the lock runs (here: reports the workspace missing) and leaves it held
    const events = [];
    for await (const e of buildEditions({ workspaceId: "ws_none", lock: borrowed }, { repo } as never)) events.push(e);
    expect(await stub.acquire(60)).toBeNull();
    await releaseBuildLock(repo, borrowed);
    expect(await stub.acquire(60)).toBeTruthy();
  });

  it("with the Durable Object erroring there is NO fallback to the repo lock: 503 lock_unavailable", async () => {
    const broken: BuildLockStub = { acquire: async () => { throw new Error("object reset"); }, release: async () => undefined };
    setPlatformEnv({ BUILD_LOCK: { idFromName: (n: string) => n, get: () => broken } } as unknown as PlatformEnv);
    const repo = createMemoryRepo();
    await expect(acquireBuildLock(repo, "ws_a")).rejects.toMatchObject({ status: 503, code: "lock_unavailable" });
    expect(await repo.acquireLock("build:ws_a", 5)).toBeTruthy(); // the repo lock was never taken
  });

  it("the Durable Object lock lets the same owner extend, and nobody else in", async () => {
    const core = new BuildLockCore(storage());
    const t = await core.acquire(60, "owner:r1");
    expect(t).toBe("owner:r1");
    expect(await core.acquire(60, "owner:r1")).toBe("owner:r1");
    expect(await core.acquire(60, "owner:r2")).toBeNull();
    expect(await core.acquire(60)).toBeNull();
    await core.release("owner:r2");
    expect(await core.acquire(60, "owner:r2")).toBeNull();
    await core.release("owner:r1");
    expect(await core.acquire(60, "owner:r2")).toBe("owner:r2");
  });

  it("repo-backed owned locks (no object bound) can be taken again by the same owner too", async () => {
    setPlatformEnv(null);
    const repo = createMemoryRepo();
    const a = await acquireBuildLock(repo, "ws_r", { owner: "run_9" });
    const again = await acquireBuildLock(repo, "ws_r", { owner: "run_9" });
    expect(again.token).toBe(a.token);
    await expect(acquireBuildLock(repo, "ws_r", { owner: "other" })).rejects.toMatchObject({ code: "build_running" });
    await releaseBuildLock(repo, ownedBuildLock("ws_r", "run_9"));
    await expect(acquireBuildLock(repo, "ws_r", { owner: "other" })).resolves.toBeTruthy();
  });

  it("realBuildPorts: the RunLock port takes, extends and releases the Durable Object lock by run id", async () => {
    const { db, dispose } = await openTestD1();
    disposers.push(dispose);
    const core = new BuildLockCore(storage());
    setPlatformEnv({ LE_DB: db, BUILD_LOCK: { idFromName: (n: string) => n, get: () => core } } as unknown as PlatformEnv);
    setRepo(createMemoryRepo());
    const { lock } = await realBuildPorts();
    expect(await lock!.acquire("ws_a", "run_1", 60)).toBe(true);
    expect(await lock!.acquire("ws_a", "run_1", 60)).toBe(true);
    expect(await lock!.acquire("ws_a", "run_2", 60)).toBe(false);
    await lock!.release("ws_a", "run_1");
    expect(await lock!.acquire("ws_a", "run_2", 60)).toBe(true);
  });
});
