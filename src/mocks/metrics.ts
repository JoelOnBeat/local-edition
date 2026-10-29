import type { AgentEvent, ModelRole } from "@/contract";
import { fakeEntityId } from "./helpers";

/** Plausible per-call metrics for the mock run, priced from the Token Factory catalog (USD per million tokens). */

export const MOCK_MODEL_IDS = {
  agent: "nvidia/Nemotron-3.5-Super-VL",
  vision: "nvidia/Nemotron-3.5-Super-VL",
  copy: "nvidia/Nemotron-3_5-Lightning",
  check: "nvidia/Nemotron-3_5-Lightning",
  review: "nvidia/Nemotron-3-Ultra-550b-a55b",
  embed: "Qwen/Qwen3-Embedding-8B",
} as const satisfies Record<ModelRole, string>;

const PRICE: Record<ModelRole, { inPerM: number; outPerM: number }> = {
  agent: { inPerM: 0.3, outPerM: 0.9 },
  vision: { inPerM: 0.3, outPerM: 0.9 },
  copy: { inPerM: 0.06, outPerM: 0.24 },
  check: { inPerM: 0.06, outPerM: 0.24 },
  review: { inPerM: 0.8, outPerM: 2.4 },
  embed: { inPerM: 0.01, outPerM: 0 },
};
/** Cached prompt tokens are billed at a quarter of the input rate. */
const CACHED_DISCOUNT = 0.25;

type StepMetrics = Extract<AgentEvent, { type: "step_metrics" }>;

/** Deterministic integer in [lo, hi] from a seed, so every run of the mock shows the same numbers. */
function spread(seed: string, lo: number, hi: number): number {
  return lo + (parseInt(fakeEntityId(seed).slice(0, 8), 16) % (hi - lo + 1));
}

export function stepUsd(role: ModelRole, promptTokens: number, cachedTokens: number, completionTokens: number): number {
  const p = PRICE[role];
  const fresh = promptTokens - cachedTokens;
  const usd = (fresh * p.inPerM + cachedTokens * p.inPerM * CACHED_DISCOUNT + completionTokens * p.outPerM) / 1_000_000;
  return Math.round(usd * 1e6) / 1e6;
}

interface StepShape {
  prompt: [number, number];
  completion: [number, number];
  msBase: number;
  msPerCompletionToken: number;
  /** Share of the prompt a warm prefix cache serves on every call after the first of its role. */
  cachedShare: number;
}
const SHAPE: Record<ModelRole, StepShape> = {
  agent: { prompt: [4800, 8200], completion: [180, 520], msBase: 900, msPerCompletionToken: 6, cachedShare: 0.55 },
  vision: { prompt: [1800, 2600], completion: [600, 1100], msBase: 1500, msPerCompletionToken: 5, cachedShare: 0 },
  copy: { prompt: [820, 1300], completion: [110, 210], msBase: 260, msPerCompletionToken: 3, cachedShare: 0.62 },
  check: { prompt: [480, 760], completion: [2, 4], msBase: 190, msPerCompletionToken: 12, cachedShare: 0.7 },
  review: { prompt: [6200, 9400], completion: [260, 520], msBase: 2600, msPerCompletionToken: 9, cachedShare: 0.35 },
  embed: { prompt: [1500, 2300], completion: [0, 0], msBase: 140, msPerCompletionToken: 0, cachedShare: 0 },
};

/** One `step_metrics` event. `warm` says whether the provider's prefix cache is already primed for this call. */
export function mockStep(role: ModelRole, seed: string, opts: { storeId?: string; tool?: string; warm?: boolean } = {}): StepMetrics {
  const s = SHAPE[role];
  const promptTokens = spread(`${seed}:p`, ...s.prompt);
  const completionTokens = s.completion[1] === 0 ? 0 : spread(`${seed}:c`, ...s.completion);
  const cachedTokens = opts.warm ? Math.round(promptTokens * s.cachedShare * (0.9 + spread(`${seed}:k`, 0, 10) / 50)) : 0;
  const ms = s.msBase + completionTokens * s.msPerCompletionToken + spread(`${seed}:m`, 0, 240);
  return {
    type: "step_metrics",
    ...(opts.storeId ? { storeId: opts.storeId } : {}),
    role,
    model: MOCK_MODEL_IDS[role],
    ...(opts.tool ? { tool: opts.tool } : {}),
    ms,
    promptTokens,
    cachedTokens: Math.min(cachedTokens, promptTokens),
    completionTokens,
    usd: stepUsd(role, promptTokens, Math.min(cachedTokens, promptTokens), completionTokens),
  };
}

/** Every model call of one store's build, in order, keyed by what triggered it. */
export function storeStepPlan(storeId: string) {
  const at = (label: string, role: ModelRole, tool?: string, warm = true) =>
    mockStep(role, `${storeId}:${label}`, { storeId, tool, warm });
  return {
    tools: ["get_block_profile", "find_artists", "find_partner_places", "search_local_events"].map((tool, i) => ({
      tool,
      agent: at(`agent${i}`, "agent", tool, i > 0),
      // Place and artist candidates are ranked with embeddings before the agent picks.
      embed: tool === "find_partner_places" || tool === "find_artists" ? at(`embed${i}`, "embed", tool, false) : null,
    })),
    finalAgent: at("agent-final", "agent", "compose_edition"),
    copy: (kind: string) => at(`copy:${kind}`, "copy", `write_${kind}`),
    check: (kind: string) => at(`check:${kind}`, "check", "self_check_output"),
  };
}

/** Total usd and prompt-cache share over a list of step events. */
export function sumMetrics(steps: StepMetrics[]): { usd: number; cachedRatio: number } {
  const usd = steps.reduce((a, s) => a + s.usd, 0);
  const prompt = steps.reduce((a, s) => a + s.promptTokens, 0);
  const cached = steps.reduce((a, s) => a + s.cachedTokens, 0);
  return { usd: Math.round(usd * 1e4) / 1e4, cachedRatio: prompt === 0 ? 0 : Math.round((cached / prompt) * 1000) / 1000 };
}

const ITEM_KINDS = ["special", "sound", "partner", "event"] as const;

/** Every model call of one store's build, flattened. */
export function allStoreSteps(storeId: string): StepMetrics[] {
  const plan = storeStepPlan(storeId);
  return [
    ...plan.tools.flatMap((t) => [t.agent, ...(t.embed ? [t.embed] : [])]),
    plan.finalAgent,
    ...ITEM_KINDS.flatMap((k) => [plan.copy(k), plan.check(k)]),
  ];
}
