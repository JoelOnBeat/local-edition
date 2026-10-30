import type { AgentEvent, EditionItem, GuardrailResult, MenuItem } from "@/contract";
import type { Provider } from "../ui";

/** Pure derivation of the run view from the AgentEvent stream. */

type Ev<T extends AgentEvent["type"]> = Extract<AgentEvent, { type: T }>;
export type StepMetrics = Ev<"step_metrics">;

export type TraceEntry =
  | { kind: "tool"; key: string; tool: string; args: Record<string, unknown>; result?: Ev<"tool_result"> }
  | { kind: "model"; key: string; step: StepMetrics }
  | { kind: "item"; key: string; item: EditionItem; guardrail?: GuardrailResult }
  | { kind: "review"; key: string; review: Ev<"review"> }
  | { kind: "error"; key: string; code: string; message: string };

export type LaneStatus = "queued" | "working" | "retrying" | "done" | "skipped" | "error";
export interface Lane {
  storeId: string;
  status: LaneStatus;
  entries: TraceEntry[];
  editionId?: string;
  usd: number;
  tokens: number;
  toolCalls: number;
  items: number;
  skipReason?: string;
}

export interface ModelTotal { model: string; calls: number; promptTokens: number; cachedTokens: number; completionTokens: number; usd: number; ms: number }

export interface RunModel {
  runId?: string;
  lanes: Lane[];
  done: number;
  total: number;
  finished: boolean;
  models: ModelTotal[];
  usd: number;
  promptTokens: number;
  cachedTokens: number;
  completionTokens: number;
  toolCalls: number;
  runErrors: { code: string; message: string }[];
}

/**
 * What an error event does to its lane. `store_retrying` says the attempt failed and the Workflow will try again, so the
 * lane shows Retrying, never Failed. Item-level problems leave the store working (the edition still lands). Anything else
 * (`store_failed` after the last attempt, `spend_cap`, `no_items`) is final.
 */
export function laneStatusAfterError(code: string, current: LaneStatus): LaneStatus | null {
  if (code === "has_approvals") return "skipped";
  if (code === "store_retrying") return "retrying";
  if (code === "item_dropped" || code === "item_failed") return null;
  return current === "done" ? null : "error";
}

export function deriveRun(events: AgentEvent[]): RunModel {
  const lanes = new Map<string, Lane>();
  const lane = (id: string) => {
    let l = lanes.get(id);
    if (!l) lanes.set(id, (l = { storeId: id, status: "queued", entries: [], usd: 0, tokens: 0, toolCalls: 0, items: 0 }));
    return l;
  };
  const models = new Map<string, ModelTotal>();
  const m: RunModel = { lanes: [], done: 0, total: 0, finished: false, models: [], usd: 0, promptTokens: 0, cachedTokens: 0, completionTokens: 0, toolCalls: 0, runErrors: [] };
  let progress = null as { done: number; total: number } | null;

  events.forEach((e, i) => {
    const key = `${i}`;
    switch (e.type) {
      case "run_started": m.runId = e.runId; e.storeIds.forEach(lane); break;
      case "store_started": lane(e.storeId).status = "working"; break;  // a retry attempt starts: Retrying turns back into Working
      case "tool_call": { const l = lane(e.storeId); l.entries.push({ kind: "tool", key, tool: e.tool, args: e.args }); l.toolCalls++; m.toolCalls++; break; }
      case "tool_result": {
        const l = lane(e.storeId);
        const open = [...l.entries].reverse().find((x) => x.kind === "tool" && x.tool === e.tool && !x.result);
        if (open && open.kind === "tool") open.result = e;
        else l.entries.push({ kind: "tool", key, tool: e.tool, args: {}, result: e });
        break;
      }
      case "step_metrics": {
        if (e.storeId) { const l = lane(e.storeId); l.entries.push({ kind: "model", key, step: e }); l.usd += e.usd; l.tokens += e.promptTokens + e.completionTokens; }
        const t = models.get(e.model) ?? { model: e.model, calls: 0, promptTokens: 0, cachedTokens: 0, completionTokens: 0, usd: 0, ms: 0 };
        t.calls++; t.promptTokens += e.promptTokens; t.cachedTokens += e.cachedTokens; t.completionTokens += e.completionTokens; t.usd += e.usd; t.ms += e.ms;
        models.set(e.model, t);
        m.usd += e.usd; m.promptTokens += e.promptTokens; m.cachedTokens += e.cachedTokens; m.completionTokens += e.completionTokens;
        break;
      }
      case "item_drafted": { const l = lane(e.storeId); l.entries.push({ kind: "item", key, item: e.item }); l.items++; break; }
      case "guardrail": {
        const l = lane(e.storeId);
        const it = [...l.entries].reverse().find((x) => x.kind === "item" && x.item.id === e.itemId);
        if (it && it.kind === "item") it.guardrail = e.result;
        break;
      }
      case "review": lane(e.storeId).entries.push({ kind: "review", key, review: e }); break;
      case "store_done": { const l = lane(e.storeId); l.status = "done"; l.editionId = e.editionId; break; }
      case "progress": progress = { done: e.done, total: e.total }; break;
      case "run_done": m.finished = true; break;
      case "error":
        if (e.storeId) {
          const l = lane(e.storeId);
          l.entries.push({ kind: "error", key, code: e.code, message: e.message });
          const next = laneStatusAfterError(e.code, l.status);
          if (next) l.status = next;
          if (e.code === "has_approvals") l.skipReason = e.message;
        } else m.runErrors.push({ code: e.code, message: e.message });
        break;
    }
  });
  m.lanes = [...lanes.values()];
  m.total = progress?.total ?? m.lanes.length;
  m.done = progress?.done ?? m.lanes.filter((l) => l.status === "done" || l.status === "skipped" || l.status === "error").length;
  m.models = [...models.values()].sort((a, b) => b.usd - a.usd);
  return m;
}

/** Which provider a tool call goes to, and the name shown in the trace. */
export function toolInfo(tool: string, menuSource?: MenuItem["source"]): { provider: Provider | null; label: string } {
  const t = tool.toLowerCase();
  if (/event|tavily|search_local/.test(t)) return { provider: "tavily", label: `tavily.${tool}` };
  // The Square badge only when the menu was imported from Square; a photo or manual menu has no provider badge.
  if (/menu/.test(t)) return { provider: menuSource === "square" ? "square" : null, label: `menu.${tool}` };
  if (/self_check|guard/.test(t)) return { provider: "guardrails", label: tool };
  if (/write_|compose|submit|review/.test(t)) return { provider: "nemotron", label: tool };
  return { provider: "qloo", label: `qloo.${tool}` };
}

/** Compact arguments for a trace line: `radiusM 800 · limit 12`, skipping the store id. */
export function formatArgs(args: Record<string, unknown>): string {
  return Object.entries(args)
    .filter(([k]) => k !== "storeId")
    .map(([k, v]) => `${k} ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
    .join(" · ");
}

/** The menu's source for the trace badge: Square only when every item came from the Square import. */
export function menuSourceOf(menu: readonly MenuItem[] | undefined): MenuItem["source"] | undefined {
  if (!menu?.length) return undefined;
  return menu.some((m) => m.source === "square") ? "square" : menu[0].source;
}
