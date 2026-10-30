import { describe, expect, it } from "vitest";
import type { AgentEvent } from "@/contract";
import { UpstreamError } from "../http/errors";
import { ModelUnavailableError } from "../http/model-unavailable";
import { classifyReply } from "../connectors/mail/classify";
import { buildEditions } from "./build";
import { AGENT_MODEL, COPY_MODEL, REVIEW_MODEL, type ChatClient } from "./ports";
import { reviewEditions } from "./review";
import { regenerateItem } from "./regenerate";
import { readModelSkips } from "./stats";
import { WEEK_OF, collect, harness } from "./test-utils";

/** The three shapes a vanished model takes: a bare 404, a `model_not_found` body, and a model the catalog says is not listed. */
const gone = (model: string): [string, () => Error][] => [
  ["HTTP 404", () => new UpstreamError("upstream_4xx", "tokenfactory", "tokenfactory rejected the request (HTTP 404).", { status: 404 })],
  ["model_not_found", () => new UpstreamError("upstream_4xx", "tokenfactory", "tokenfactory rejected the request (HTTP 400).", { status: 400, hint: "model_not_found" })],
  ["not listed in /v1/models", () => new ModelUnavailableError(model, "not_listed")],
];

const AGENT_NOTE = "Nemotron 3.5 Super VL is unavailable on Token Factory right now; this store will build on the next run.";
const errors = (events: AgentEvent[]) => events.flatMap((e) => (e.type === "error" ? [e] : []));
const doneOf = (events: AgentEvent[]) => (events.at(-1) as { editionIds: string[] }).editionIds;

describe.each(gone(AGENT_MODEL))("agent (Super VL) unavailable: %s", (_name, make) => {
  it("skips only the store whose agent call failed; the other store builds and the run finishes", async () => {
    const h = await harness({ storeCount: 2, agent: undefined });
    const [first] = h.storeIds;
    const firstName = (await h.repo.getStore(first))!.name;
    const real = h.deps.chat;
    // Super VL is gone for the first store only (as if it came back mid-run).
    const chat: ChatClient = { complete: (req) => (req.model === AGENT_MODEL && JSON.stringify(req.messages).includes(firstName) ? Promise.reject(make()) : real.complete(req)) };
    const events = await collect(buildEditions({ workspaceId: h.workspaceId, weekOf: WEEK_OF }, { ...h.deps, chat }));

    expect(errors(events).filter((e) => e.storeId === first)).toEqual([{ type: "error", storeId: first, code: "model_unavailable", message: AGENT_NOTE }]);
    expect(events.some((e) => e.type === "store_done" && e.storeId === first)).toBe(false);
    expect(events.some((e) => e.type === "store_done" && e.storeId === h.storeIds[1])).toBe(true);
    expect(events.at(-1)).toMatchObject({ type: "run_done" });
    expect(doneOf(events)).toHaveLength(1);
    // No half-written edition for the skipped store, and no deterministic stand-in plan either.
    expect(await h.repo.getEditionForWeek(first, WEEK_OF)).toBeNull();
    // Store 2's agent answered after the skip, so the recorded skip is cleared again (/proof shows only what is still down).
    expect((await readModelSkips(h.repo)).agent).toBeUndefined();
  });

  it("with the agent model down for every store, every store is skipped and nothing fails", async () => {
    const h = await harness({ storeCount: 2, agent: () => { throw make(); } });
    const events = await collect(buildEditions({ workspaceId: h.workspaceId, weekOf: WEEK_OF }, h.deps));
    expect(errors(events).map((e) => e.code)).toEqual(["model_unavailable", "model_unavailable"]);
    expect(events.at(-1)).toMatchObject({ type: "run_done", editionIds: [] });
    expect((await readModelSkips(h.repo)).agent?.note).toBe(AGENT_NOTE);
  });
});

describe.each(gone(REVIEW_MODEL))("reviewer (Ultra) unavailable: %s", (_name, make) => {
  it("skips the review with the plain note, saves no verdict, and never hands it to another model", async () => {
    const h = await harness({ storeCount: 2, review: () => make() });
    await collect(buildEditions({ workspaceId: h.workspaceId, weekOf: WEEK_OF }, h.deps));
    const events = await collect(reviewEditions({ workspaceId: h.workspaceId }, h.deps));

    expect(errors(events)).toEqual([{ type: "error", code: "step_skipped", message: "Review skipped: Nemotron 3 Ultra unavailable." }]);
    expect(events.some((e) => e.type === "review")).toBe(false);
    expect(events.at(-1)).toMatchObject({ type: "run_done" });
    expect(h.chat.reviewCalls).toBe(1); // no Super VL fallback call
    for (const ed of await h.repo.listEditions({ storeIds: h.storeIds })) {
      expect(ed.status).toBe("draft"); // the edition still drafts
      expect(ed.review ?? null).toBeNull(); // and reads Not reviewed
    }
    expect((await readModelSkips(h.repo)).review?.note).toBe("Review skipped: Nemotron 3 Ultra unavailable.");
  });
});

describe.each(gone(COPY_MODEL))("copy (Lightning) unavailable: %s", (_name, make) => {
  it("writes every item from the template, says so once per store, and the edition still drafts", async () => {
    const h = await harness({ storeCount: 2, copy: () => make() });
    const events = await collect(buildEditions({ workspaceId: h.workspaceId, weekOf: WEEK_OF }, h.deps));
    const notes = errors(events).filter((e) => e.code === "step_skipped");
    expect(notes.map((n) => n.storeId)).toEqual(h.storeIds);
    expect(notes[0].message).toBe("Nemotron 3.5 Lightning is unavailable on Token Factory right now; this copy uses the plain template.");
    expect(events.filter((e) => e.type === "store_done")).toHaveLength(2);
    expect(events.filter((e) => e.type === "item_drafted")).toHaveLength(8);
    expect(errors(events).filter((e) => e.code !== "step_skipped")).toEqual([]);
  });

  it("a regenerate keeps the item and says the rewrite could not run when the agent is the missing model", async () => {
    const h = await harness({ storeCount: 1 });
    const built = await collect(buildEditions({ workspaceId: h.workspaceId, weekOf: WEEK_OF }, h.deps));
    const ed = (await h.repo.getEdition(doneOf(built)[0]))!;
    const chat: ChatClient = { complete: (req) => (req.model === AGENT_MODEL ? Promise.reject(make()) : h.chat.complete(req)) };
    const events = await collect(regenerateItem({ workspaceId: h.workspaceId, editionId: ed.id, itemId: ed.items[0].id }, { ...h.deps, chat }));
    expect(errors(events)).toEqual([expect.objectContaining({ code: "model_unavailable", storeId: ed.storeId })]);
    expect((await h.repo.getEdition(ed.id))!.items[0].version).toBe(ed.items[0].version);
  });
});

describe.each(gone("Qwen/Qwen3-Embedding-8B"))("embeddings (Qwen3 Embedding 8B) unavailable: %s", (_name, make) => {
  it("skips the matching and ranking steps with a note; the store still builds without them", async () => {
    const h = await harness({ storeCount: 1, tf: { embedError: make() } });
    const events = await collect(buildEditions({ workspaceId: h.workspaceId, weekOf: WEEK_OF }, h.deps));
    const skips = errors(events).filter((e) => e.code === "step_skipped");
    expect(skips.map((s) => s.message)).toEqual([
      "Menu match skipped: Qwen3 Embedding 8B is unavailable on Token Factory right now.",
    ]);
    const matchResult = events.find((e) => e.type === "tool_result" && e.tool === "menu_match");
    expect(matchResult).toMatchObject({ ok: false, summary: skips[0].message });
    expect(events.some((e) => e.type === "store_done")).toBe(true);
    expect(events.at(-1)).toMatchObject({ type: "run_done" });
  });

  it("the rerank-or-embedding step skips the same way when both are gone", async () => {
    const h = await harness({ storeCount: 1, tf: { rerankError: make(), embedError: make() } });
    const events = await collect(buildEditions({ workspaceId: h.workspaceId, weekOf: WEEK_OF }, h.deps));
    expect(errors(events).filter((e) => e.code === "step_skipped").some((e) => e.message.startsWith("Partner ranking skipped:"))).toBe(true);
    expect(events.some((e) => e.type === "store_done")).toBe(true);
    expect((await readModelSkips(h.repo)).embed?.note).toContain("skipped: Qwen3 Embedding 8B");
  });
});

describe.each(gone(COPY_MODEL))("reply classification (Lightning) unavailable: %s", (_name, make) => {
  it("falls back to the keyword classifier after one call, and says so", async () => {
    let calls = 0;
    const chat: ChatClient = { complete: async () => { calls++; throw make(); } };
    const v = await classifyReply(chat, "We sold out of the cardamom bun by 9am, can we make more next week?", { storeName: "Kettle & Kiln Williamsburg", specialName: "Cardamom Morning Bun", eventTitle: null });
    expect(v).toMatchObject({ category: "sold_out", by: "heuristic", skipped: "Nemotron 3.5 Lightning is unavailable; this reply was sorted by keywords." });
    expect(calls).toBe(1);
  });
});
