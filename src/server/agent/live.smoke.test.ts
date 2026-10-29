import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetEnvCache } from "@/lib/env";
import { sampleSeed } from "../sample/chain";
import { createMemoryRepo } from "../store/memory";
import { setRepo } from "../store";
import { buildEditions } from "./build";
import { getAgentDeps, setAgentDeps } from "./deps";
import { readVerifierCounts } from "./stats";
import { call, collect, scriptedChat, turn } from "./test-utils";

/** T3: the real wiring with no keys. Qloo, Tavily and Token Factory answer from fixtures; guardrails run locally. */
describe("live wiring in fixture mode (no keys)", () => {
  const saved = { ...process.env };
  beforeAll(() => {
    Object.assign(process.env, { QLOO_MODE: "fixture", TF_MODE: "fixture", TAVILY_MODE: "fixture", STORE_DRIVER: "memory", GUARDRAILS_URL: "http://127.0.0.1:9" });
    delete process.env.NEBIUS_API_KEY;
    delete process.env.QLOO_API_KEY;
    delete process.env.TAVILY_API_KEY;
    resetEnvCache();
    setAgentDeps(undefined);
  });
  afterAll(() => {
    process.env = saved;
    resetEnvCache();
    setRepo(undefined);
  });

  it("builds an edition for one store using the deterministic plan, with every item evidenced", async () => {
    const repo = createMemoryRepo();
    setRepo(repo);
    const seed = sampleSeed();
    seed.stores = seed.stores.slice(0, 1);
    const ws = await repo.createWorkspace(seed);
    const deps = await getAgentDeps();
    const events = await collect(buildEditions({ workspaceId: ws.id, weekOf: "2026-10-26" }, deps));
    expect(events.at(-1)?.type).toBe("run_done");
    const done = events.at(-1);
    const ed = (await repo.getEdition(done?.type === "run_done" ? done.editionIds[0] : "x"))!;
    expect(ed.items.length).toBeGreaterThanOrEqual(1);
    for (const item of ed.items) {
      expect(item.evidenceIds.length).toBeGreaterThan(0);
      // Guardrails are unreachable here, so nothing is claimed as checked.
      expect(["unchecked", "blocked", "passed", "rewritten"]).toContain(item.guardrail.status);
    }
    expect(events.filter((e) => e.type === "error").map((e) => (e.type === "error" ? e.code : ""))).toEqual(expect.not.arrayContaining(["store_failed"]));
  });

  it("the evidence verifier recomputes the real block lifts from the cached baseline, and the fixture-mode seeded item is caught", async () => {
    const repo = createMemoryRepo();
    setRepo(repo);
    const seed = sampleSeed();
    seed.stores = seed.stores.slice(0, 2);
    const ws = await repo.createWorkspace(seed);
    const deps = await getAgentDeps();
    expect(deps.seedBadItem).toBe(true);
    const events = await collect(buildEditions({ workspaceId: ws.id, weekOf: "2026-10-26" }, deps));
    // No real item fails: the qloo module's own lifts are what the verifier recomputes.
    expect(events.filter((e) => e.type === "error" && e.code === "item_dropped")).toEqual([]);
    expect(events.filter((e) => e.type === "error" && e.code === "seeded_test_dropped")).toHaveLength(1);
    const done = events.at(-1);
    for (const id of done?.type === "run_done" ? done.editionIds : []) {
      const ed = (await repo.getEdition(id))!;
      const special = ed.items.find((i) => i.kind === "special");
      expect(special?.verification).toEqual({ lift: "recomputed", entities: "found" });
    }
    expect(events.some((e) => e.type === "step_metrics" && e.role === "embed")).toBe(true);
    const counts = await readVerifierCounts(repo);
    expect(counts).toMatchObject({ liftMismatch: 0, entityMissing: 0, seededCaught: 1 });
  });

  it("a model-chosen genre no longer starves the sound item: the real fixture Qloo returns at least 8 artists", async () => {
    const repo = createMemoryRepo();
    setRepo(repo);
    const seed = sampleSeed();
    seed.stores = seed.stores.slice(0, 1);
    const ws = await repo.createWorkspace(seed);
    const real = await getAgentDeps();
    const refs = Array.from({ length: 9 }, (_, i) => `a${i + 1}`);
    const chat = scriptedChat({
      agent: [
        turn(call("block_profile")),
        turn(call("artists_local", { genres: ["reggae", "soul"] }), call("menu_match"), call("places_near"), call("events_this_week")),
        turn(call("submit_candidates", { special: { pairRef: "s1" }, sound: { artistRefs: refs }, partner: { placeRef: "p1" }, event: { eventRef: null } })),
      ],
    });
    const events = await collect(buildEditions({ workspaceId: ws.id, weekOf: "2026-10-26" }, { ...real, chat }));
    expect(events.filter((e) => e.type === "tool_result" && e.tool === "artists_local" && !e.ok)).toEqual([]);
    const done = events.at(-1);
    const ed = (await repo.getEdition(done?.type === "run_done" ? done.editionIds[0] : "x"))!;
    const sound = ed.items.find((i) => i.kind === "sound");
    expect(sound?.kind === "sound" && sound.artists.length).toBeGreaterThanOrEqual(8);
  });
});
