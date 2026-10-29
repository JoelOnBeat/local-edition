import { MODELS } from "./models";

/**
 * Reasoning control for Nemotron on Token Factory (measured live, 29 Oct 2026; see docs/LIVE-SMOKE.md).
 * - `off`:  `reasoning_effort: "none"` plus `chat_template_kwargs.enable_thinking: false`. Either alone turns
 *           thinking off on Lightning, Super-VL and the old Super-120B (0 reasoning tokens); both together are
 *           accepted everywhere, so both are sent.
 * - `low`:  `reasoning_effort: "low"`. Cuts Super-120B reasoning ~4x; barely helps Super-VL and does nothing on
 *           Lightning, so it is only as good as the model's honesty about "low".
 * - `default`: the provider's own behaviour (full reasoning).
 * Not honoured by any model: `/no_think` system lines, `reasoning: {enabled:false}`, `reasoning_budget: 0`.
 */
export type Reasoning = "off" | "low" | "default";

/** Models known to accept the reasoning fields. Anything else is sent nothing (an unknown 400 is not worth risking). */
const SUPPORTS_REASONING_FIELDS = new Set<string>([
  MODELS.copy,
  MODELS.agent,
  "nvidia/nemotron-3-super-120b-a12b",
  MODELS.reviewer,
]);

export function reasoningBody(model: string, reasoning: Reasoning | undefined): Record<string, unknown> {
  if (!reasoning || reasoning === "default" || !SUPPORTS_REASONING_FIELDS.has(model)) return {};
  if (reasoning === "low") return { reasoning_effort: "low" };
  return { reasoning_effort: "none", chat_template_kwargs: { enable_thinking: false } };
}

/**
 * The setting used when a caller does not choose one. Lightning writes one-line copy: with thinking on, a
 * 20-word reply burns 300 to 600 tokens and the reasoning can spill into `content` (see LIVE-SMOKE.md), so off.
 * The agent without tools (plain JSON) is off too; with tools it uses `AGENT_REASONING`. Everything else keeps the provider default.
 */
export function defaultReasoning(model: string, hasTools: boolean): Reasoning {
  if (model === MODELS.copy) return "off";
  if (model === MODELS.agent) return hasTools ? AGENT_REASONING : "off";
  return "default";
}

/**
 * Reasoning for the tool-calling agent loop on Super-VL: the provider default. Measured live on one store
 * (Qloo fixtures, 3 runs each): off fell back to the fixed plan 2 of 3 times (it repeats the same empty
 * `artists_local` call until the invalid-call cap), low 1 of 3, default 1 of 3. Thinking costs $0.002 to
 * $0.005 more per store, so reliability wins. Re-measure once Qloo returns real artists.
 */
export const AGENT_REASONING: Reasoning = "default";
