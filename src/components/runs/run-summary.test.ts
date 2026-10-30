import { describe, expect, it } from "vitest";
import type { RunListItem } from "@/contract";
import { fromServer, mergeRuns, type RunSummary } from "./run-summary";

const server = (id: string, over: Partial<RunListItem> = {}): RunListItem => ({
  id, status: "done", total: 8, done: 8, startedAt: "2026-10-30T02:00:00.000Z", updatedAt: "2026-10-30T02:04:00.000Z", usd: 0.0412, ...over,
});

describe("the runs page merges the server's run log with this tab's traces", () => {
  it("a run only the server knows shows status, stores, cost and time, with the trace-only columns empty", () => {
    const s = fromServer(server("run_a", { status: "done_with_skips", done: 6 }));
    expect(s).toMatchObject({ runId: "run_a", state: "partial", done: 6, total: 8, usd: 0.0412, toolCalls: null, tokens: null, models: [] });
    expect(s.startedAt).toBe(Date.parse("2026-10-30T02:00:00.000Z"));
    expect(fromServer(server("run_b", { status: "failed" })).state).toBe("failed");
    expect(fromServer(server("run_c", { status: "running" })).state).toBe("live");
  });

  it("lists newest first across both sources, and the tab's richer copy wins where both know a run", () => {
    const tab: RunSummary = { runId: "run_a", state: "live", done: 5, total: 8, toolCalls: 40, tokens: 9000, usd: 0.03, models: ["nvidia/Nemotron-3.5-Super-VL"], startedAt: Date.parse("2026-10-30T02:00:00.000Z") };
    const onlyHere: RunSummary = { runId: "run_dev", state: "finished", done: 1, total: 1, toolCalls: 3, tokens: 100, usd: 0, models: [], startedAt: Date.parse("2026-10-30T09:00:00.000Z") };
    const merged = mergeRuns([tab, onlyHere], [server("run_a"), server("run_z", { startedAt: "2026-10-29T02:00:00.000Z" })]);
    expect(merged.map((r) => r.runId)).toEqual(["run_dev", "run_a", "run_z"]);
    const a = merged.find((r) => r.runId === "run_a")!;
    expect(a).toMatchObject({ toolCalls: 40, tokens: 9000, state: "finished" }); // the server's status outlives the stream
  });

  it("an empty server log and an empty tab merge to an empty list", () => {
    expect(mergeRuns([], [])).toEqual([]);
  });
});
