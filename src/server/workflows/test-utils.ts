import type { AgentEvent } from "@/contract";
import { openTestD1 } from "../store/d1-test-utils";
import type { D1Like } from "../platform/types";
import { runEditionBuild, type BuildPorts, type StepConfig, type StepLike } from "./edition-build";
import { RunLog } from "./run-log";
import type { BuildWorkflowParams } from "./types";

/** Thrown by the fake step API to simulate the Workflow engine dying between steps (never retried). */
export class CrashError extends Error {}

/**
 * A Workflow step API in memory. Like the real one it remembers every finished step by name (so a replayed
 * `run()` skips them), retries a failing callback `retries.limit` more times, and then rethrows.
 */
export class FakeStep implements StepLike {
  readonly memo = new Map<string, unknown>();
  readonly attempts = new Map<string, number>();
  readonly order: string[] = [];
  crashAfter: number | null = null;
  private fresh = 0;

  async do<T>(name: string, config: StepConfig, callback: () => Promise<T>): Promise<T> {
    if (this.memo.has(name)) return this.memo.get(name) as T;
    if (this.crashAfter !== null && this.fresh >= this.crashAfter) throw new CrashError("engine restarted");
    const limit = config.retries?.limit ?? 0;
    let last: unknown;
    for (let attempt = 0; attempt <= limit; attempt++) {
      this.attempts.set(name, attempt + 1);
      try {
        const value = await callback();
        this.memo.set(name, value === undefined ? undefined : structuredClone(value));
        this.order.push(name);
        this.fresh++;
        return value;
      } catch (e) {
        last = e;
      }
    }
    throw last;
  }
}

export const params = (over: Partial<BuildWorkflowParams> = {}): BuildWorkflowParams => ({ runId: "run_t1", workspaceId: "ws_t", trigger: "request", ...over });

export type StoreScript = (storeId: string, attempt: number) => AgentEvent[];

/** Ports whose per-store build plays a script, wrapping it in run_started and run_done like the real build does. */
export function scriptedPorts(runLog: RunLog, stores: string[], script: StoreScript, calls: string[] = []): BuildPorts {
  const attempts = new Map<string, number>();
  return {
    runLog,
    planStores: async (p) => (p.workspaceId === "ws_missing" ? null : p.storeIds ?? stores),
    buildStore(storeId, p) {
      calls.push(storeId);
      const attempt = (attempts.get(storeId) ?? 0) + 1;
      attempts.set(storeId, attempt);
      return (async function* () {
        yield { type: "run_started", runId: p.runId, storeIds: [storeId] } as AgentEvent;
        for (const e of script(storeId, attempt)) yield e;
        yield { type: "run_done", runId: p.runId, editionIds: [] } as AgentEvent;
      })();
    },
  };
}

export const okStore: StoreScript = (id) => [
  { type: "store_started", storeId: id },
  { type: "store_done", storeId: id, editionId: `ed_${id}` },
];

export async function freshLog(now: () => number = Date.now): Promise<{ db: D1Like; runLog: RunLog; dispose: () => Promise<void> }> {
  const { db, dispose } = await openTestD1();
  return { db, runLog: new RunLog(db, now), dispose };
}

export async function types(runLog: RunLog, runId = "run_t1"): Promise<string[]> {
  return (await runLog.readFrom(runId, 0)).map((e) => e.event.type);
}

export { runEditionBuild };
