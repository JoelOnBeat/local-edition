import { describe, expect, it } from "vitest";
import type { AgentEvent, MenuItem } from "@/contract";
import { LANE_STATUS } from "./store-lane";
import { SKIP_CODES, deriveRun, laneStatusAfterError, menuSourceOf, toolInfo } from "./run-model";

const started: AgentEvent[] = [
  { type: "run_started", runId: "run_1", storeIds: ["s1"] },
  { type: "store_started", storeId: "s1" },
];
const err = (code: string): AgentEvent => ({ type: "error", storeId: "s1", code, message: "x" });
const status = (events: AgentEvent[]) => deriveRun(events).lanes[0].status;

describe("deriveRun lane status across a retry", () => {
  it("shows Retrying, not Failed, while a retry is pending", () => {
    expect(status([...started, err("store_retrying")])).toBe("retrying");
  });
  it("returns to working when the retry starts, then done", () => {
    const retried = [...started, err("store_retrying"), { type: "store_started", storeId: "s1" } as AgentEvent];
    expect(status(retried)).toBe("working");
    expect(status([...retried, { type: "store_done", storeId: "s1", editionId: "e1" }])).toBe("done");
  });
  it("is Failed only on the final store_failed", () => {
    expect(status([...started, err("store_retrying"), err("store_failed")])).toBe("error");
  });
  it("keeps item-level problems from failing the store", () => {
    expect(status([...started, err("item_dropped")])).toBe("working");
  });
  it("does not count a retrying store as finished", () => {
    expect(deriveRun([...started, err("store_retrying")]).done).toBe(0);
  });
});

describe("menu tool provider badge", () => {
  const item = (source: MenuItem["source"]) => ({ source }) as MenuItem;
  it("badges Square only for a Square menu", () => {
    expect(toolInfo("menu_match", "square").provider).toBe("square");
    expect(toolInfo("menu_match", "vl").provider).toBeNull();
    expect(toolInfo("menu_match").provider).toBeNull();
  });
  it("derives the menu source", () => {
    expect(menuSourceOf([item("vl"), item("square")])).toBe("square");
    expect(menuSourceOf([item("vl")])).toBe("vl");
    expect(menuSourceOf([])).toBeUndefined();
  });
});

const NOTE = "Nemotron 3.5 Super VL is unavailable on Token Factory right now; this store will build on the next run.";

describe("run view: skips read amber, never red", () => {
  it("a model_unavailable store is a skipped lane with its note; a step_skipped note leaves the lane alone", () => {
    expect(laneStatusAfterError("model_unavailable", "working")).toBe("skipped");
    expect(laneStatusAfterError("step_skipped", "working")).toBeNull();
    expect(laneStatusAfterError("store_failed", "working")).toBe("error"); // real failures stay red
    expect(SKIP_CODES.has("model_unavailable") && SKIP_CODES.has("step_skipped") && SKIP_CODES.has("has_approvals")).toBe(true);
    expect(SKIP_CODES.has("store_failed")).toBe(false);
    // The lane chip is amber (warn), the failure chip is red (flag).
    expect(LANE_STATUS.skipped.cls).toContain("warn");
    expect(LANE_STATUS.error.cls).toContain("flag");
  });

  it("derives a mixed run: one drafted, one skipped for the model, one drafted with a skipped step", () => {
    const events: AgentEvent[] = [
      { type: "run_started", runId: "run_1", storeIds: ["a", "b", "c"] },
      { type: "store_started", storeId: "a" }, { type: "store_done", storeId: "a", editionId: "ed_a" },
      { type: "store_started", storeId: "b" }, { type: "error", storeId: "b", code: "model_unavailable", message: NOTE },
      { type: "store_started", storeId: "c" },
      { type: "tool_call", storeId: "c", tool: "menu_match", args: {} },
      { type: "tool_result", storeId: "c", tool: "menu_match", ok: false, summary: "Menu match skipped: Qwen3 Embedding 8B is unavailable on Token Factory right now.", evidenceIds: [] },
      { type: "error", storeId: "c", code: "step_skipped", message: "Menu match skipped: Qwen3 Embedding 8B is unavailable on Token Factory right now." },
      { type: "store_done", storeId: "c", editionId: "ed_c" },
      { type: "progress", runId: "run_1", done: 3, total: 3 },
      { type: "run_done", runId: "run_1", editionIds: ["ed_a", "ed_c"] },
    ];
    const m = deriveRun(events);
    const lane = (id: string) => m.lanes.find((l) => l.storeId === id)!;
    expect(lane("a").status).toBe("done");
    expect(lane("b")).toMatchObject({ status: "skipped", skipKind: "model", skipReason: NOTE });
    expect(lane("c").status).toBe("done");
    const tool = lane("c").entries.find((e) => e.kind === "tool");
    expect(tool && tool.kind === "tool" && tool.skipped).toBe(true);
    expect(m).toMatchObject({ finished: true, done: 3, total: 3 });
  });

  it("a genuine tool failure right before a copy note is not relabelled as a skip", () => {
    const m = deriveRun([
      { type: "run_started", runId: "r", storeIds: ["a"] },
      { type: "store_started", storeId: "a" },
      { type: "tool_call", storeId: "a", tool: "places_near", args: {} },
      { type: "tool_result", storeId: "a", tool: "places_near", ok: false, summary: "Qloo is unavailable (HTTP 503).", evidenceIds: [] },
      { type: "error", storeId: "a", code: "step_skipped", message: "Nemotron 3.5 Lightning is unavailable on Token Factory right now; this copy uses the plain template." },
    ]);
    const tool = m.lanes[0].entries.find((e) => e.kind === "tool");
    expect(tool && tool.kind === "tool" && tool.skipped).toBeUndefined();
  });

  it("a run-level skip (the review step) is a note, not a lane", () => {
    const m = deriveRun([
      { type: "run_started", runId: "r", storeIds: ["a"] },
      { type: "error", code: "step_skipped", message: "Review skipped: Nemotron 3 Ultra unavailable." },
      { type: "run_done", runId: "r", editionIds: ["ed_a"] },
    ]);
    expect(m.runErrors).toEqual([{ code: "step_skipped", message: "Review skipped: Nemotron 3 Ultra unavailable." }]);
    expect(m.finished).toBe(true);
  });
});
