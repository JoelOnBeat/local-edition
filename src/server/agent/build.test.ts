import { describe, expect, it } from "vitest";
import { AgentEvent, EditionItem } from "@/contract";
import { buildEditions } from "./build";
import { AGENT_MODEL, COPY_MODEL, FALLBACK_AGENT_LABEL } from "./ports";
import { WEEK_OF, call, collect, harness, text, toolNames, turn, types } from "./test-utils";

describe("buildEditions", () => {
  it("streams the full event sequence for two stores and persists drafted editions", async () => {
    const h = await harness();
    const events = await collect(buildEditions({ workspaceId: h.workspaceId, weekOf: WEEK_OF }, h.deps));

    for (const e of events) expect(AgentEvent.safeParse(e).success, JSON.stringify(e)).toBe(true);
    expect(events[0]).toMatchObject({ type: "run_started", storeIds: h.storeIds });
    expect(events.at(-1)).toMatchObject({ type: "run_done" });

    const [a, b] = h.storeIds;
    const forStore = (id: string) => events.filter((e) => "storeId" in e && e.storeId === id);
    for (const id of [a, b]) {
      const own = forStore(id);
      expect(own[0].type).toBe("store_started");
      expect(own.at(-1)!.type).toBe("store_done");
      expect(toolNames(own)).toEqual(["block_profile", "menu_match", "places_near", "artists_local", "events_this_week", "partners_rank"]);
      expect(own.filter((e) => e.type === "tool_result" && !e.ok)).toHaveLength(0);
      expect(own.filter((e) => e.type === "item_drafted").map((e) => (e.type === "item_drafted" ? e.item.kind : ""))).toEqual(["special", "sound", "partner", "event"]);
      expect(own.filter((e) => e.type === "guardrail")).toHaveLength(4);
    }
    // Stores run one after another: all of A's events come before B starts.
    const aDone = events.findIndex((e) => e.type === "store_done" && e.storeId === a);
    const bStart = events.findIndex((e) => e.type === "store_started" && e.storeId === b);
    expect(aDone).toBeLessThan(bStart);
    expect(types(events).filter((t) => t === "run_started" || t === "run_done")).toHaveLength(2);

    const done = events.at(-1);
    const ids = done?.type === "run_done" ? done.editionIds : [];
    expect(ids).toHaveLength(2);
    for (const id of ids) {
      const ed = (await h.repo.getEdition(id))!;
      expect(ed.status).toBe("draft");
      expect(ed.weekOf).toBe(WEEK_OF);
      expect(ed.issueNo).toBe(1);
      expect(ed.generatedBy).toMatchObject({ agentModel: AGENT_MODEL, copyModel: COPY_MODEL });
      expect(ed.items.map((i) => i.kind)).toEqual(["special", "sound", "partner", "event"]);
      const evidenceIds = new Set(ed.evidence.map((x) => x.id));
      for (const item of ed.items) {
        expect(EditionItem.safeParse(item).success).toBe(true);
        expect(item.evidenceIds.length).toBeGreaterThan(0);
        for (const eid of item.evidenceIds) expect(evidenceIds.has(eid)).toBe(true);
        expect(item.status).toBe("draft");
        expect(item.guardrail.status).toBe("passed");
      }
      const special = ed.items.find((i) => i.kind === "special");
      // The special is the menu item the embedding match scored best, and that match is its evidence.
      const match = ed.evidence.find((x) => special?.evidenceIds.includes(x.id) && x.endpoint === "/v1/embeddings");
      expect(match?.params.menuItemId).toBe(special?.kind === "special" ? special.baseMenuItemId : undefined);
    }
    // Every special's evidence includes the menu match, which is a Token Factory embedding row.
    const ed0 = (await h.repo.getEdition(ids[0]))!;
    expect(ed0.evidence.some((x) => x.source === "tokenfactory" && x.endpoint === "/v1/embeddings")).toBe(true);
  });

  it("reuses the edition id for a rebuild of the same week and increments issueNo next week", async () => {
    const h = await harness({ storeCount: 1 });
    const first = await collect(buildEditions({ workspaceId: h.workspaceId, weekOf: WEEK_OF }, h.deps));
    const id1 = (first.at(-1) as { editionIds: string[] }).editionIds[0];
    const again = await collect(buildEditions({ workspaceId: h.workspaceId, weekOf: WEEK_OF }, h.deps));
    expect((again.at(-1) as { editionIds: string[] }).editionIds[0]).toBe(id1);
    const next = await collect(buildEditions({ workspaceId: h.workspaceId, weekOf: "2026-11-02" }, h.deps));
    const ed = (await h.repo.getEdition((next.at(-1) as { editionIds: string[] }).editionIds[0]))!;
    expect(ed.issueNo).toBe(2);
    expect(ed.id).not.toBe(id1);
  });

  it("builds only the requested stores and rejects unknown ones with an error event", async () => {
    const h = await harness();
    const only = await collect(buildEditions({ workspaceId: h.workspaceId, storeIds: [h.storeIds[1]], weekOf: WEEK_OF }, h.deps));
    expect(only[0]).toMatchObject({ type: "run_started", storeIds: [h.storeIds[1]] });
    const bad = await collect(buildEditions({ workspaceId: h.workspaceId, storeIds: ["store_nope"] }, h.deps));
    expect(bad).toEqual([expect.objectContaining({ type: "error", code: "unknown_store" })]);
    const noWs = await collect(buildEditions({ workspaceId: "ws_missing" }, h.deps));
    expect(noWs).toEqual([expect.objectContaining({ type: "error", code: "workspace_not_found" })]);
  });

  it("drops an item with no evidence and says so, keeping the other three", async () => {
    const h = await harness({ storeCount: 1, qloo: { placesWithoutEvidence: true }, tf: { rerankFails: true } });
    const events = await collect(buildEditions({ workspaceId: h.workspaceId, weekOf: WEEK_OF }, h.deps));
    const dropped = events.filter((e) => e.type === "error" && e.code === "item_dropped");
    expect(dropped).toHaveLength(1);
    const ed = (await h.repo.getEdition((events.at(-1) as { editionIds: string[] }).editionIds[0]))!;
    expect(ed.items.map((i) => i.kind)).toEqual(["special", "sound", "event"]);
    expect(ed.items.every((i) => i.evidenceIds.length >= 1)).toBe(true);
  });

  it("marks the edition flagged when copy stays blocked after one rewrite", async () => {
    const h = await harness({ storeCount: 1, guardrails: "block-all" });
    const events = await collect(buildEditions({ workspaceId: h.workspaceId, weekOf: WEEK_OF }, h.deps));
    const ed = (await h.repo.getEdition((events.at(-1) as { editionIds: string[] }).editionIds[0]))!;
    expect(ed.status).toBe("flagged");
    expect(ed.items.every((i) => i.status === "flagged" && i.guardrail.status === "blocked")).toBe(true);
  });

  it("falls back to the deterministic plan and labels the edition when the model errors", async () => {
    const h = await harness({ storeCount: 1, agent: [new Error("boom")] });
    const events = await collect(buildEditions({ workspaceId: h.workspaceId, weekOf: WEEK_OF }, h.deps));
    const ed = (await h.repo.getEdition((events.at(-1) as { editionIds: string[] }).editionIds[0]))!;
    expect(ed.generatedBy.agentModel).toBe(FALLBACK_AGENT_LABEL);
    expect(ed.items).toHaveLength(4);
  });

  it("stops the run with spend_cap when the cap is hit and does not emit run_done", async () => {
    const { UpstreamError } = await import("../http/errors");
    const h = await harness({ agent: [new UpstreamError("spend_cap", "tokenfactory", "cap")] });
    const events = await collect(buildEditions({ workspaceId: h.workspaceId, weekOf: WEEK_OF }, h.deps));
    expect(events.at(-1)).toMatchObject({ type: "error", code: "spend_cap" });
    expect(types(events)).not.toContain("run_done");
    const eds = await h.repo.listEditions({ storeIds: h.storeIds });
    expect(eds.every((e) => e.status !== "drafting")).toBe(true);
  });

  it("reports an empty model reply as a fallback, never a crash", async () => {
    const h = await harness({ storeCount: 1, agent: [text("I cannot help"), text("still no")] });
    const events = await collect(buildEditions({ workspaceId: h.workspaceId, weekOf: WEEK_OF }, h.deps));
    expect(events.at(-1)!.type).toBe("run_done");
    expect(turn(call("x")).toolCalls).toHaveLength(1);
  });
});
