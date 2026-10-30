import { describe, expect, it } from "vitest";
import type { AgentEvent, MenuItem } from "@/contract";
import { deriveRun, menuSourceOf, toolInfo } from "./run-model";

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
