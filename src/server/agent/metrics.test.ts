import { describe, expect, it } from "vitest";
import { AgentEvent } from "@/contract";
import { buildEditions } from "./build";
import { getOrCreateCard } from "./card";
import { LOOP_MAX_TOKENS } from "./loop";
import { stepUsd } from "./metrics";
import { AGENT_MODEL, COPY_MODEL } from "./ports";
import { readMetricsTotals } from "./stats";
import { WEEK_OF, collect, harness } from "./test-utils";

type Step = Extract<AgentEvent, { type: "step_metrics" }>;
const stepsOf = (events: AgentEvent[]) => events.filter((e): e is Step => e.type === "step_metrics");

describe("step_metrics", () => {
  it("prices cached prompt tokens at the cached rate", () => {
    // 400 fresh x $0.30 + 600 cached x $0.06 + 100 out x $0.90 per million.
    expect(stepUsd(AGENT_MODEL, 1000, 600, 100)).toBeCloseTo(0.000246, 7);
    // Lightning: cached at $0.03.
    expect(stepUsd(COPY_MODEL, 1000, 500, 0)).toBeCloseTo((500 * 0.06 + 500 * 0.03) / 1e6, 8);
    // Cached tokens can never exceed the prompt.
    expect(stepUsd(AGENT_MODEL, 100, 900, 0)).toBeCloseTo((100 * 0.06) / 1e6, 8);
  });

  it("emits one valid step for every model call of a build: agent turns, copy and embeddings", async () => {
    const h = await harness({ storeCount: 1 });
    const events = await collect(buildEditions({ workspaceId: h.workspaceId, weekOf: WEEK_OF }, h.deps));
    const steps = stepsOf(events);
    for (const s of steps) expect(AgentEvent.safeParse(s).success).toBe(true);
    const byRole = (r: string) => steps.filter((s) => s.role === r);
    expect(byRole("agent")).toHaveLength(h.chat.agentCalls);
    expect(byRole("copy")).toHaveLength(h.chat.copyCalls);
    expect(byRole("embed").map((s) => s.tool).sort()).toEqual(["menu_match", "partners_rank"]);
    // The agent's turns are named by the tools they called; copy calls by what they wrote.
    expect(byRole("agent")[0].tool).toBe("block_profile");
    expect(byRole("agent")[1].tool).toBe("menu_match+places_near+artists_local+events_this_week");
    expect(byRole("agent").at(-1)!.tool).toBe("submit_candidates");
    expect(byRole("copy").every((s) => s.tool === "write_copy" && s.model === COPY_MODEL)).toBe(true);
    expect(steps.every((s) => s.storeId === h.storeIds[0] && s.ms >= 0 && s.usd >= 0 && s.promptTokens > 0)).toBe(true);
    // A step is never reported before the model call it belongs to has finished: store_done comes last.
    expect(events.at(-2)).toMatchObject({ type: "store_done" });
  });

  it("surfaces the provider's cached tokens and prices them", async () => {
    const h = await harness({ storeCount: 1, usage: { promptTokens: 5000, cachedTokens: 4000, completionTokens: 200 } });
    const steps = stepsOf(await collect(buildEditions({ workspaceId: h.workspaceId, weekOf: WEEK_OF }, h.deps)));
    const agent = steps.find((s) => s.role === "agent")!;
    expect(agent).toMatchObject({ promptTokens: 5000, cachedTokens: 4000, completionTokens: 200 });
    expect(agent.usd).toBeCloseTo(stepUsd(AGENT_MODEL, 5000, 4000, 200), 7);
    expect(agent.usd).toBeLessThan(stepUsd(AGENT_MODEL, 5000, 0, 200));
  });

  it("tallies every run in the metrics ledger for /api/proof", async () => {
    const h = await harness({ storeCount: 2 });
    const steps = stepsOf(await collect(buildEditions({ workspaceId: h.workspaceId, weekOf: WEEK_OF }, h.deps)));
    const totals = await readMetricsTotals(h.repo);
    expect(totals.calls).toBe(steps.length);
    expect(totals.editions).toBe(2);
    expect(totals.usd).toBeCloseTo(steps.reduce((a, s) => a + s.usd, 0), 6);
    expect(Object.keys(totals.byRole).sort()).toEqual(["agent", "copy", "embed"]);
  });
});

describe("card metrics", () => {
  it("tallies the card's model calls in the ledger, since the card route cannot stream them", async () => {
    const h = await harness({ storeCount: 1 });
    const events = await collect(buildEditions({ workspaceId: h.workspaceId, weekOf: WEEK_OF }, h.deps));
    const before = (await readMetricsTotals(h.repo)).byRole.copy.calls;
    await getOrCreateCard(h.deps, h.workspaceId, (events.at(-1) as { editionIds: string[] }).editionIds[0]);
    const after = await readMetricsTotals(h.repo);
    expect(after.byRole.copy.calls).toBeGreaterThan(before);
    expect(after.editions).toBe(1);
  });
});

describe("model settings and prompt order", () => {
  it("runs the tool loop with 3000 tokens and provider thinking, copy and JSON with thinking off", async () => {
    const h = await harness({ storeCount: 1 });
    await collect(buildEditions({ workspaceId: h.workspaceId, weekOf: WEEK_OF }, h.deps));
    const agent = h.chat.requests.filter((r) => r.model === AGENT_MODEL);
    expect(LOOP_MAX_TOKENS).toBe(3000);
    expect(agent.length).toBeGreaterThan(0);
    expect(agent.every((r) => r.maxTokens === 3000 && r.reasoning === "default" && r.role === "agent")).toBe(true);
    const copy = h.chat.requests.filter((r) => r.model === COPY_MODEL);
    expect(copy.length).toBeGreaterThan(0);
    expect(copy.every((r) => r.reasoning === "off")).toBe(true);
  });

  it("puts brand voice, then rules, then the chain-wide menu in the system prompt and the store last, identical across stores", async () => {
    const h = await harness({ storeCount: 2 });
    await collect(buildEditions({ workspaceId: h.workspaceId, weekOf: WEEK_OF }, h.deps));
    const firsts = h.chat.requests.filter((r) => r.model === AGENT_MODEL && r.messages.filter((m) => m.role === "assistant").length === 0);
    expect(firsts).toHaveLength(2);
    const [a, b] = firsts.map((r) => r.messages);
    const system = String(a[0].content);
    expect(system.startsWith("Brand voice:")).toBe(true);
    expect(system.indexOf("Brand voice:")).toBeLessThan(system.indexOf("Rules:"));
    expect(system.indexOf("Rules:")).toBeLessThan(system.indexOf("Menu:"));
    // Nothing about the store may sit in the cacheable head.
    const stores = await h.repo.listStores((await h.repo.getWorkspace(h.workspaceId))!.chainId);
    for (const s of stores) expect(system).not.toContain(s.name);
    expect(String(b[0].content)).toBe(system);
    expect(String(a[1].content)).toContain(stores[0].name);
    expect(String(b[1].content)).toContain(stores[1].name);
    // The copy prompts share a head too: brand voice first.
    const copy = h.chat.requests.find((r) => r.model === COPY_MODEL)!;
    expect(String(copy.messages[0].content).startsWith("Brand voice:")).toBe(true);
  });
});
