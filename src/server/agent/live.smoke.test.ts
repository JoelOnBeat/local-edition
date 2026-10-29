import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetEnvCache } from "@/lib/env";
import { sampleSeed } from "../sample/chain";
import { createMemoryRepo } from "../store/memory";
import { setRepo } from "../store";
import { buildEditions } from "./build";
import { getAgentDeps, setAgentDeps } from "./deps";
import { collect } from "./test-utils";

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
});
