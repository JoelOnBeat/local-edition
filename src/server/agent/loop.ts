import type { AgentEvent, EditionItemKind } from "@/contract";
import { createLogger } from "../log";
import { UpstreamError } from "../http/errors";
import { runTool } from "./exec";
import { runFallbackPlan } from "./fallback";
import { ToolMemory } from "./memory";
import { chooseDeterministic, resolveSubmit, SUBMIT_TOOL, SubmitArgs, type CandidateSet, type Exclusions } from "./plan";
import { AGENT_MODEL, limitsOf, type AgentDeps, type ChatMessage, type ChatToolCall, type StoreContext } from "./ports";
import { TOOL_BY_NAME, renderPayload, storeBrief, toolSpecs } from "./tools";
import { withTimeout } from "./util";

const log = createLogger("agent:loop");

export interface LoopInput {
  sc: StoreContext;
  deps: AgentDeps;
  /** Resume with tool results already gathered (regeneration reuses nothing by default). */
  mem?: ToolMemory;
  /** Regenerate: only this kind matters. */
  focus?: EditionItemKind;
  hint?: string;
  exclude?: Exclusions;
}

export interface LoopResult {
  set: CandidateSet;
  mem: ToolMemory;
  usedFallback: boolean;
  fallbackReason?: string;
  steps: number;
}

const SYSTEM = `You are the edition planner for a {category} chain's store. Each week you pick, for one store, a menu special, a sound brief (artists for the room), a local partner and an event night, grounded in what the tools return about that block.
Rules:
- Call the tools to gather candidates, then call submit_candidates once. Use only the refs the tools returned (s1, a1, p1, e1). Never invent names, refs or facts.
- Prefer menu_match then partners_rank before choosing. Taste and place only: no health, diet, nutrition or allergen claims, and never target a group of people by age, gender, ethnicity or religion.
- Say "rising in Qloo's population data", never "rising on this street".
- You have at most {steps} turns. Do not repeat a tool call with the same arguments.`;

function userPrompt(input: LoopInput, mem: ToolMemory): string {
  const { sc, focus, hint, exclude } = input;
  const lines = [
    `Week of ${sc.weekOf}.`,
    storeBrief(sc, mem),
    `Brand voice: ${sc.chain.brandVoice.join(" ")}`,
    `Menu: ${sc.menu.map((m) => m.name).join(", ")}.`,
  ];
  if (focus) lines.push(`Only the ${focus} item needs to change. Submit just that kind.`);
  if (hint) lines.push(`Head office asks: "${hint}"`);
  const avoid = Object.entries(exclude ?? {}).filter(([, v]) => v?.length);
  if (avoid.length) lines.push(`Pick something different from the current choice (excluded: ${avoid.map(([k, v]) => `${k}=${v!.length}`).join(", ")}).`);
  return lines.join("\n");
}

function parseJson(text: string | null | undefined): unknown {
  if (!text) return undefined;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return undefined;
  try { return JSON.parse(text.slice(start, end + 1)); } catch { return undefined; }
}

function parseArgs(raw: string): { ok: true; value: unknown } | { ok: false } {
  if (!raw.trim()) return { ok: true, value: {} };
  try { return { ok: true, value: JSON.parse(raw) }; } catch { return { ok: false }; }
}

function violations(set: CandidateSet, ex: Exclusions = {}): string[] {
  const out: string[] = [];
  if (set.special && ex.menuItemIds?.includes(set.special.menuItem.id)) out.push("special repeats the current menu item; pick a different pair");
  if (set.partner && ex.placeIds?.includes(set.partner.place.entity.entityId)) out.push("partner repeats the current place; pick a different one");
  if (set.event?.tieIn && ex.eventUrls?.includes(set.event.tieIn.url)) out.push("event repeats the current tie-in; pick a different event");
  return out;
}

function keepFocus(set: CandidateSet, focus?: EditionItemKind): CandidateSet {
  return focus ? (set[focus] ? ({ [focus]: set[focus] } as CandidateSet) : {}) : set;
}

/**
 * Per-store tool loop on the agent model: at most `maxSteps` model turns, every tool call validated
 * with zod, every model output resolved against what the tools actually returned. If the model
 * stalls, emits bad arguments repeatedly, runs out of steps or errors, the deterministic plan takes over.
 */
export async function* runStoreAgent(input: LoopInput): AsyncGenerator<AgentEvent, LoopResult> {
  const { sc, deps, focus } = input;
  const limits = limitsOf(deps);
  const mem = input.mem ?? new ToolMemory();
  const ctx = { sc, deps, mem };
  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM.replace("{category}", sc.chain.category).replace("{steps}", String(limits.maxSteps)) },
    { role: "user", content: userPrompt(input, mem) },
  ];
  const tools = [...toolSpecs(), { name: SUBMIT_TOOL.name, description: SUBMIT_TOOL.description, parameters: SUBMIT_TOOL.parameters as Record<string, unknown> }];
  const deadline = Date.now() + limits.loopDeadlineMs;
  let steps = 0;
  let invalid = 0;
  let nudges = 0;

  const finish = async function* (reason: string): AsyncGenerator<AgentEvent, LoopResult> {
    log.warn("using deterministic plan", { storeId: sc.store.id, reason });
    yield* runFallbackPlan(ctx, focus);
    return { set: chooseDeterministic(mem, sc, focus, input.exclude), mem, usedFallback: true, fallbackReason: reason, steps };
  };

  while (steps < limits.maxSteps) {
    if (Date.now() > deadline) return yield* finish("deadline");
    steps++;
    let response;
    try {
      response = await withTimeout(deps.chat.complete({ model: AGENT_MODEL, messages, tools, temperature: 0.3, maxTokens: 1200, timeoutMs: limits.chatTimeoutMs }), limits.chatTimeoutMs + 2000, "agent model");
    } catch (e) {
      if (e instanceof UpstreamError && e.code === "spend_cap") throw e;
      return yield* finish(e instanceof UpstreamError ? e.code : "chat_failed");
    }

    const calls: ChatToolCall[] = response.toolCalls.slice(0, 4).map((c, i) => ({ ...c, id: c.id || `call_${steps}_${i}` }));
    messages.push({ role: "assistant", content: response.content, toolCalls: calls.length ? calls : undefined });

    if (!calls.length) {
      // Some models answer with the submit JSON as plain text; accept it if it resolves cleanly.
      const asText = SubmitArgs.safeParse(parseJson(response.content));
      if (asText.success) {
        const { set, problems } = resolveSubmit(asText.data, mem, sc);
        if (!problems.length && Object.keys(set).length) return { set: keepFocus(set, focus), mem, usedFallback: false, steps };
      }
      if (++nudges > 1) return yield* finish("no_tool_calls");
      messages.push({ role: "user", content: "Call a tool, or call submit_candidates if you have enough." });
      continue;
    }

    for (const call of calls) {
      const args = parseArgs(call.arguments);
      if (call.name === SUBMIT_TOOL.name) {
        const parsed = args.ok ? SubmitArgs.safeParse(args.value) : null;
        let problems: string[];
        if (!parsed || !parsed.success) {
          problems = ["submit_candidates arguments are not valid: use the documented shape with refs only"];
        } else {
          const r = resolveSubmit(parsed.data, mem, sc);
          problems = [...r.problems, ...violations(r.set, input.exclude)];
          if (!problems.length && !Object.keys(keepFocus(r.set, focus)).length) problems = ["nothing was picked; pick at least one candidate"];
          if (!problems.length) return { set: keepFocus(r.set, focus), mem, usedFallback: false, steps };
        }
        invalid++;
        messages.push({ role: "tool", toolCallId: call.id, content: JSON.stringify({ error: problems.join("; ") }) });
        continue;
      }
      const def = TOOL_BY_NAME.get(call.name);
      if (!def) {
        invalid++;
        messages.push({ role: "tool", toolCallId: call.id, content: JSON.stringify({ error: `Unknown tool ${call.name}. Use: ${[...TOOL_BY_NAME.keys()].join(", ")}, submit_candidates.` }) });
        continue;
      }
      const run = yield* runTool(ctx, def, args.ok ? args.value : "not json");
      if (run.invalid || !args.ok) invalid++;
      messages.push({ role: "tool", toolCallId: call.id, content: renderPayload(run.payload) });
    }
    if (invalid >= limits.maxInvalidCalls) return yield* finish("too_many_invalid_calls");
  }
  return yield* finish("step_cap");
}
