import { describe, expect, it } from "vitest";
import { ProofResponse } from "@/contract";
import { readModelSkips, recordModelSkip, recordSteps } from "../agent/stats";
import { createMemoryRepo } from "../store/memory";
import { PROOF_STEPS, stepsWithSkips } from "./proof-steps";

const at = new Date("2026-10-30T09:00:00Z");

describe("/proof step list: skipped steps", () => {
  it("marks only the step whose role was skipped, with the plain note, and the body still validates", async () => {
    const repo = createMemoryRepo();
    await recordModelSkip(repo, "review", "Review skipped: Nemotron 3 Ultra unavailable.", at);
    const steps = stepsWithSkips(await readModelSkips(repo));
    expect(steps.filter((s) => s.skipped).map((s) => s.step)).toEqual(["Chain review"]);
    expect(steps.find((s) => s.step === "Chain review")?.skipped).toEqual({ at: at.toISOString(), note: "Review skipped: Nemotron 3 Ultra unavailable." });
    expect(ProofResponse.shape.steps.parse(steps)).toHaveLength(PROOF_STEPS.length);
  });

  it("the agent and the menu read share a model but are separate rows", async () => {
    const repo = createMemoryRepo();
    await recordModelSkip(repo, "vision", "x is unavailable.", at);
    expect(stepsWithSkips(await readModelSkips(repo)).filter((s) => s.skipped).map((s) => s.step)).toEqual(["Menu photo read"]);
  });

  it("a role that answers again clears its skip; other roles keep theirs", async () => {
    const repo = createMemoryRepo();
    await recordModelSkip(repo, "review", "Review skipped: Nemotron 3 Ultra unavailable.", at);
    await recordModelSkip(repo, "embed", "Menu match skipped: Qwen3 Embedding 8B is unavailable on Token Factory right now.", at);
    await recordSteps(repo, [{ type: "step_metrics", role: "review", model: "nvidia/Nemotron-3-Ultra-550b-a55b", ms: 900, promptTokens: 100, cachedTokens: 0, completionTokens: 20, usd: 0.001 }], 0, at);
    expect(Object.keys(await readModelSkips(repo))).toEqual(["embed"]);
  });
});
