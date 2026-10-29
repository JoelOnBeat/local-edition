import { describe, expect, it } from "vitest";
import { buildEditions } from "./build";
import { getOrCreateCard } from "./card";
import { regenerateItem } from "./regenerate";
import { call, collect, harness, turn, WEEK_OF, type Harness } from "./test-utils";
import { HttpError } from "../http/errors";
import { VersionConflictError } from "../store/repo";
import type { Edition } from "@/contract";

async function built(opts: Parameters<typeof harness>[0] = {}): Promise<{ h: Harness; ed: Edition }> {
  const h = await harness({ storeCount: 1, ...opts });
  const events = await collect(buildEditions({ workspaceId: h.workspaceId, weekOf: WEEK_OF }, h.deps));
  const done = events.at(-1);
  return { h, ed: (await h.repo.getEdition(done?.type === "run_done" ? done.editionIds[0] : "none"))! };
}

/** After the first build, the model picks the second place, then submits. */
const pickSecondPlace = [turn(call("places_near")), turn(call("submit_candidates", { partner: { placeRef: "p2" } }))];

describe("regenerateItem", () => {
  it("replaces one item in place, keeps its id, bumps the version and guards the new copy", async () => {
    const { h, ed } = await built();
    const partner = ed.items.find((i) => i.kind === "partner")!;
    const others = ed.items.filter((i) => i.id !== partner.id);
    h.chat.requests.length = 0;
    h.deps.chat = (await import("./test-utils")).scriptedChat({ agent: pickSecondPlace });
    const events = await collect(regenerateItem({ workspaceId: h.workspaceId, editionId: ed.id, itemId: partner.id, hint: "somewhere quieter" }, h.deps));

    expect(events.filter((e) => e.type !== "step_metrics").map((e) => e.type)).toEqual(["run_started", "store_started", "tool_call", "tool_result", "item_drafted", "guardrail", "store_done", "run_done"]);
    // One step per model call: the agent turn that picked the tool, the submit turn, and the copy.
    expect(events.filter((e) => e.type === "step_metrics").map((e) => (e.type === "step_metrics" ? e.role : ""))).toEqual(["agent", "agent", "copy"]);
    const after = (await h.repo.getEdition(ed.id))!;
    const next = after.items.find((i) => i.id === partner.id)!;
    expect(next.version).toBe(partner.version + 1);
    expect(next.kind === "partner" && next.place.name).toBe("Vinyl Haven Records");
    expect(after.items.filter((i) => i.id !== partner.id)).toEqual(others);
    expect(after.items.map((i) => i.id)).toEqual(ed.items.map((i) => i.id));
    expect(next.guardrail.status).toBe("passed");
    // New evidence joined the edition.
    expect(next.evidenceIds.every((id) => after.evidence.some((e) => e.id === id))).toBe(true);
    expect(after.status).toBe("draft");
  });

  it("does not hand back the same place the item already shows", async () => {
    const { h, ed } = await built();
    const partner = ed.items.find((i) => i.kind === "partner")!;
    h.deps.chat = (await import("./test-utils")).scriptedChat({
      agent: [turn(call("places_near")), turn(call("submit_candidates", { partner: { placeRef: "p1" } })), turn(call("submit_candidates", { partner: { placeRef: "p3" } }))],
    });
    await collect(regenerateItem({ workspaceId: h.workspaceId, editionId: ed.id, itemId: partner.id }, h.deps));
    const after = (await h.repo.getEdition(ed.id))!.items.find((i) => i.id === partner.id)!;
    expect(after.kind === "partner" && after.place.name).toBe("Paper Plane Gallery");
  });

  it("reports errors as events: unknown item, nothing new, version conflict", async () => {
    const { h, ed } = await built();
    const missing = await collect(regenerateItem({ workspaceId: h.workspaceId, editionId: ed.id, itemId: "it_nope" }, h.deps));
    expect(missing).toEqual([expect.objectContaining({ type: "error", code: "item_not_found" })]);

    const partner = ed.items.find((i) => i.kind === "partner")!;
    h.deps.qloo.placesNear = async () => ({ items: [], evidence: [] });
    const none = await collect(regenerateItem({ workspaceId: h.workspaceId, editionId: ed.id, itemId: partner.id }, h.deps));
    expect(none.at(-1)).toMatchObject({ type: "error", code: "no_alternative" });

    h.deps.qloo.placesNear = (await import("./test-utils")).fakeQloo().placesNear;
    h.deps.chat = (await import("./test-utils")).scriptedChat({ agent: pickSecondPlace });
    const real = h.deps.repo.updateEditionItem.bind(h.deps.repo);
    h.deps.repo.updateEditionItem = async (id, item, v) => { await real(id, item, v); throw new VersionConflictError(item.id, v, v + 1); };
    const conflict = await collect(regenerateItem({ workspaceId: h.workspaceId, editionId: ed.id, itemId: partner.id }, h.deps));
    expect(conflict.at(-1)).toMatchObject({ type: "error", code: "version_conflict" });
  });

  it("refuses an edition from another workspace", async () => {
    const { h, ed } = await built();
    const events = await collect(regenerateItem({ workspaceId: "ws_other", editionId: ed.id, itemId: ed.items[0].id }, h.deps));
    expect(events).toEqual([expect.objectContaining({ type: "error", code: "workspace_not_found" })]);
  });

  it("blanks an existing staff card so it is rewritten, keeping the share token", async () => {
    const { h, ed } = await built();
    const card = await getOrCreateCard(h.deps, h.workspaceId, ed.id);
    h.deps.chat = (await import("./test-utils")).scriptedChat({ agent: pickSecondPlace });
    await collect(regenerateItem({ workspaceId: h.workspaceId, editionId: ed.id, itemId: ed.items.find((i) => i.kind === "partner")!.id }, h.deps));
    expect((await h.repo.getStaffCardByEdition(ed.id))!.lines).toEqual([]);
    const fresh = await getOrCreateCard(h.deps, h.workspaceId, ed.id);
    expect(fresh.token).toBe(card.token);
    expect(fresh.lines.length).toBeGreaterThan(0);
  });
});

describe("getOrCreateCard", () => {
  it("writes the card once, guards every line and returns the stored one afterwards", async () => {
    const { h, ed } = await built();
    const card = await getOrCreateCard(h.deps, h.workspaceId, ed.id);
    expect(card).toMatchObject({ editionId: ed.id, storeId: ed.storeId, guardrail: { status: "passed" } });
    expect(card.token.length).toBeGreaterThan(10);
    expect(card.lines.length).toBeGreaterThanOrEqual(2);
    const calls = h.chat.copyCalls;
    const again = await getOrCreateCard(h.deps, h.workspaceId, ed.id);
    expect(again).toEqual(card);
    expect(h.chat.copyCalls).toBe(calls);
    expect(await h.repo.getStaffCardByToken(card.token)).toEqual(card);
  });

  it("leaves blocked lines off the card and marks unchecked when guardrails are down", async () => {
    const { h, ed } = await built();
    h.deps.chat = (await import("./test-utils")).scriptedChat({
      copy: () => JSON.stringify({ lines: [{ heading: "Today", body: "Boost your immunity with every cup." }, { heading: "Speakers", body: "Warm soul, low volume." }, { heading: "Door", body: "Greet people by name." }] }),
    });
    const card = await getOrCreateCard(h.deps, h.workspaceId, ed.id);
    expect(card.lines.map((l) => l.heading)).toEqual(["Speakers", "Door"]);
    expect(card.guardrail.reasons.join(" ")).toMatch(/1 line\(s\) were left off/);

    const { h: h2, ed: ed2 } = await built({ guardrails: "down" });
    expect((await getOrCreateCard(h2.deps, h2.workspaceId, ed2.id)).guardrail.status).toBe("unchecked");
  });

  it("uses the template when the copy model fails, and 404s for a foreign workspace", async () => {
    const { h, ed } = await built();
    h.deps.chat = { complete: async () => { throw new Error("down"); }, } as never;
    const card = await getOrCreateCard(h.deps, h.workspaceId, ed.id);
    expect(card.lines.map((l) => l.heading)).toContain("This week's special");
    await expect(getOrCreateCard(h.deps, "ws_other", ed.id)).rejects.toMatchObject({ status: 404 });
    await expect(getOrCreateCard(h.deps, h.workspaceId, "ed_missing")).rejects.toBeInstanceOf(HttpError);
  });

  it("will not write a card for an edition with no usable items", async () => {
    const { h, ed } = await built({ guardrails: "block-all" });
    await expect(getOrCreateCard(h.deps, h.workspaceId, ed.id)).rejects.toMatchObject({ status: 409, code: "edition_not_ready" });
  });
});
