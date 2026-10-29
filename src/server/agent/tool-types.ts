import type { z } from "zod";
import type { AgentDeps, StoreContext } from "./ports";
import type { ToolMemory } from "./memory";

/** Shared shapes and small helpers for the tools the Nemotron agent can call. */

export interface ToolCtx {
  sc: StoreContext;
  deps: AgentDeps;
  mem: ToolMemory;
}

export interface ToolOutcome {
  /** One line for the `tool_result` event. */
  summary: string;
  /** Compact JSON the model reads. */
  payload: unknown;
  evidenceIds: string[];
}

export interface ToolDef<S extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  schema: S;
  run(ctx: ToolCtx, args: z.output<S>): Promise<ToolOutcome>;
}

export function round(n: number | undefined): number | undefined {
  return n === undefined ? undefined : Math.round(n * 100) / 100;
}
export function signed(n: number): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}`;
}
export function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return "web"; }
}

/** The store brief used as the rerank query and shown to the model. */
export function storeBrief(sc: StoreContext, mem: ToolMemory): string {
  const tags = (mem.profile?.tags ?? []).slice(0, 5).map((t) => t.name);
  const anchors = sc.chain.anchors.map((a) => a.name).join(", ");
  return [
    `${sc.chain.name}, a ${sc.chain.category} chain resembling ${anchors}.`,
    `Store: ${sc.store.name} (${sc.store.addressLabel}), ${sc.chain.city.name}.`,
    tags.length ? `The block leans: ${tags.join(", ")}.` : "",
  ].filter(Boolean).join(" ");
}
