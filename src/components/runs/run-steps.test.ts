import { describe, expect, it } from "vitest";
import type { AgentEvent } from "@/contract";
import { deriveRun } from "./run-model";
import { deriveSteps } from "./run-steps";

const base: AgentEvent[] = [
  { type: "run_started", runId: "run_1", storeIds: ["s1"] },
  { type: "store_started", storeId: "s1" },
  { type: "tool_call", storeId: "s1", tool: "menu_match", args: {} },
  { type: "tool_result", storeId: "s1", tool: "menu_match", ok: true, summary: "1 item" } as AgentEvent,
  { type: "tool_call", storeId: "s1", tool: "block_profile", args: { radiusM: 800 } },
];
const steps = (events: AgentEvent[]) => deriveSteps(deriveRun(events).lanes[0]).map((s) => s.state);

describe("deriveSteps", () => {
  it("marks steps before the current one done and the current one active", () => {
    expect(steps(base)).toEqual(["done", "active", "idle", "idle", "idle", "idle", "idle"]);
  });
  it("puts a places call under the edition agent", () => {
    const more = [...base, { type: "tool_call", storeId: "s1", tool: "places_near", args: {} } as AgentEvent];
    expect(steps(more).slice(0, 3)).toEqual(["done", "done", "active"]);
  });
  it("finishes every step and leaves approval ready once the store is done", () => {
    const done = [...base, { type: "store_done", storeId: "s1", editionId: "e1" } as AgentEvent];
    expect(steps(done)).toEqual(["done", "done", "done", "done", "done", "done", "ready"]);
  });
  it("keeps every step idle while the store is queued", () => {
    expect(steps([base[0]!])).toEqual(Array(7).fill("idle"));
  });
});
