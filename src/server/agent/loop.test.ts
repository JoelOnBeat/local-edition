import { describe, expect, it } from "vitest";
import { UpstreamError } from "../http/errors";
import { runStoreAgent } from "./loop";
import { ToolMemory } from "./memory";
import { FALLBACK_SEQUENCE } from "./fallback";
import { call, collect, harness, text, toolNames, turn, WEEK_OF } from "./test-utils";
import type { ChatRequest } from "./ports";

async function run(opts: Parameters<typeof harness>[0] = {}, extra: Partial<Parameters<typeof runStoreAgent>[0]> = {}) {
  const h = await harness({ storeCount: 1, ...opts });
  const chain = (await h.repo.getChain((await h.repo.getWorkspace(h.workspaceId))!.chainId))!;
  const store = (await h.repo.getStore(h.storeIds[0]))!;
  const menu = await h.repo.listMenu(chain.id);
  const events: Awaited<ReturnType<typeof collect>> = [];
  const gen = runStoreAgent({ sc: { chain, store, menu, weekOf: WEEK_OF }, deps: h.deps, ...extra });
  let result;
  for (;;) {
    const n = await gen.next();
    if (n.done) { result = n.value; break; }
    events.push(n.value);
  }
  return { h, events: events as import("@/contract").AgentEvent[], result };
}

describe("runStoreAgent", () => {
  it("lets the model choose among candidates and resolves evidence from the tool results", async () => {
    const { result, events } = await run();
    expect(result.usedFallback).toBe(false);
    expect(result.steps).toBe(4);
    expect(Object.keys(result.set).sort()).toEqual(["event", "partner", "sound", "special"]);
    expect(result.set.sound?.artists).toHaveLength(9);
    expect(result.set.partner?.place.entity.name).toBe("Greenlight Bookstore");
    expect(result.set.partner?.angle).toBe("books and slow afternoons");
    expect(result.set.event).toMatchObject({ day: "Fri", time: "18:00", tieIn: { title: "Brooklyn Record Fair", source: "tavily" } });
    for (const c of Object.values(result.set)) {
      expect(c.evidenceIds.length).toBeGreaterThan(0);
      for (const id of c.evidenceIds) expect(result.mem.hasEvidence(id)).toBe(true);
    }
    expect(events.filter((e) => e.type === "tool_call")).toHaveLength(6);
  });

  it("recovers from invalid tool arguments: reports the failure, the model retries, no fallback", async () => {
    const { events, result, h } = await run({
      agent: [
        turn(call("places_near", { limit: "lots" }), call("block_profile")),
        turn(call("places_near", "{not json")),
        turn(call("places_near", { limit: 3 }), call("menu_match"), call("artists_local"), call("events_this_week")),
        turn(call("submit_candidates", { special: { pairRef: "s1" }, partner: { placeRef: "p1" }, sound: {}, event: { eventRef: null, day: "Sat", time: "20:00" } })),
      ],
    });
    const failed = events.filter((e) => e.type === "tool_result" && !e.ok);
    expect(failed.map((e) => e.type === "tool_result" && e.summary)).toEqual([expect.stringContaining("invalid arguments: limit"), expect.stringContaining("invalid arguments")]);
    expect(result.usedFallback).toBe(false);
    expect(result.set.partner).toBeDefined();
    expect(result.set.event).toMatchObject({ day: "Sat", time: "20:00", tieIn: null });
    // The model saw the validation error as the tool message.
    const last = h.chat.requests.at(-1)!;
    const toolMsgs = last.messages.filter((m) => m.role === "tool").map((m) => (m.role === "tool" ? m.content : ""));
    expect(toolMsgs.some((c) => c.includes("invalid arguments"))).toBe(true);
  });

  it("corrects an unknown ref instead of trusting it", async () => {
    const { result, h } = await run({
      agent: [
        turn(call("block_profile")),
        turn(call("menu_match")),
        turn(call("submit_candidates", { special: { pairRef: "s99" } })),
        turn(call("submit_candidates", { special: { pairRef: "s1" } })),
      ],
    });
    expect(result.usedFallback).toBe(false);
    expect(result.set.special).toBeDefined();
    const fix = h.chat.requests[3].messages.at(-1);
    expect(fix?.role === "tool" && fix.content).toContain("s99");
  });

  it("stops at the step cap and hands over to the deterministic plan", async () => {
    const { result, events, h } = await run({ agent: () => turn(call("block_profile")), limits: { maxInvalidCalls: 99 } });
    expect(h.chat.agentCalls).toBe(10);
    expect(result).toMatchObject({ usedFallback: true, fallbackReason: "step_cap", steps: 10 });
    // block_profile ran once in the loop and is not repeated; the rest follow the fixed order.
    const tools = toolNames(events);
    expect(tools.filter((t) => t === "block_profile")).toHaveLength(10);
    expect(tools.slice(-5)).toEqual(FALLBACK_SEQUENCE.slice(1));
    expect(Object.keys(result.set)).toHaveLength(4);
  });

  it("falls back after repeated invalid calls", async () => {
    const { result } = await run({ agent: () => turn(call("nope"), call("places_near", { limit: 0 })) });
    expect(result).toMatchObject({ usedFallback: true, fallbackReason: "too_many_invalid_calls" });
    expect(Object.keys(result.set)).toHaveLength(4);
  });

  it("uses the fixed sequence when the model errors, picking the top-ranked candidates", async () => {
    const { result, events } = await run({ agent: [new UpstreamError("upstream_5xx", "tokenfactory", "down")] });
    expect(result).toMatchObject({ usedFallback: true, fallbackReason: "upstream_5xx", steps: 1 });
    expect(toolNames(events)).toEqual([...FALLBACK_SEQUENCE]);
    expect(result.set.partner?.place.entity.name).toBe("Greenlight Bookstore"); // best rerank score
    expect(result.set.sound?.artists).toHaveLength(12);
    expect(result.set.event?.tieIn?.title).toBe("Brooklyn Record Fair");
  });

  it("accepts a submit sent as plain JSON text once the refs resolve, and nudges a silent model once", async () => {
    const submit = JSON.stringify({ special: { pairRef: "s1" } });
    const { result, h } = await run({ agent: [turn(call("block_profile"), call("menu_match")), text("Let me think."), text(submit)] });
    expect(result.usedFallback).toBe(false);
    expect(result.set.special).toBeDefined();
    const nudge = h.chat.requests[2].messages.at(-1);
    expect(nudge?.role === "user" && nudge.content).toContain("submit_candidates");
  });

  it("falls back when the model stays silent after the nudge", async () => {
    const { result } = await run({ agent: [text("hm"), text("hm")] });
    expect(result).toMatchObject({ usedFallback: true, fallbackReason: "no_tool_calls" });
  });

  it("survives a failing tool: the model sees the failure and the run continues", async () => {
    const h = await harness({ storeCount: 1, agent: [turn(call("places_near")), turn(call("submit_candidates", { partner: { placeRef: "p1" } }))] });
    h.deps.qloo.placesNear = async () => { throw new UpstreamError("upstream_5xx", "qloo", "Qloo is unavailable (HTTP 503)."); };
    const chain = (await h.repo.getChain((await h.repo.getWorkspace(h.workspaceId))!.chainId))!;
    const store = (await h.repo.getStore(h.storeIds[0]))!;
    const events = [];
    const gen = runStoreAgent({ sc: { chain, store, menu: [], weekOf: WEEK_OF }, deps: h.deps });
    for (;;) { const n = await gen.next(); if (n.done) break; events.push(n.value); }
    expect(events).toContainEqual(expect.objectContaining({ type: "tool_result", tool: "places_near", ok: false, summary: expect.stringContaining("503") }));
  });

  it("regeneration focus: submits one kind and refuses to repeat the current choice", async () => {
    const mem = new ToolMemory();
    const { result, h } = await run(
      { agent: [turn(call("places_near")), turn(call("submit_candidates", { partner: { placeRef: "p1" } })), turn(call("submit_candidates", { partner: { placeRef: "p2" } }))] },
      { mem, focus: "partner", hint: "somewhere louder", exclude: { placeIds: [] } },
    );
    expect(Object.keys(result.set)).toEqual(["partner"]);
    const first = h.chat.requests[0].messages[1];
    expect(first.role === "user" && first.content).toContain("somewhere louder");

    const again = await run(
      { agent: [turn(call("places_near")), turn(call("submit_candidates", { partner: { placeRef: "p1" } })), turn(call("submit_candidates", { partner: { placeRef: "p2" } }))] },
      { focus: "partner", exclude: { placeIds: [result.set.partner!.place.entity.entityId] } },
    );
    // p1 is the same place as before (same store), so the first submit is refused and p2 wins.
    expect(again.result.set.partner?.place.entity.name).toBe("Vinyl Haven Records");
    const req: ChatRequest = again.h.chat.requests.at(-1)!;
    expect(JSON.stringify(req.messages)).toContain("repeats the current place");
  });
});
