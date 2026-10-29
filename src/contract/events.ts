import { z } from "zod";
import { EditionItem, GuardrailResult } from "./domain";
import { ModelRole, ReviewFields } from "./upgrade";

/** Streaming events (Server-Sent Events, `data: <json>\n\n`). Source: docs/CONTRACT.md. */

const storeId = z.string().min(1);

export const AgentEvent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("run_started"), runId: z.string(), storeIds: z.array(z.string()) }),
  z.object({ type: z.literal("store_started"), storeId }),
  z.object({ type: z.literal("tool_call"), storeId, tool: z.string(), args: z.record(z.string(), z.unknown()) }),
  z.object({
    type: z.literal("tool_result"),
    storeId,
    tool: z.string(),
    ok: z.boolean(),
    summary: z.string(),
    evidenceIds: z.array(z.string()),
  }),
  z.object({ type: z.literal("item_drafted"), storeId, item: EditionItem }),
  z.object({ type: z.literal("guardrail"), storeId, itemId: z.string(), result: GuardrailResult }),
  z.object({ type: z.literal("store_done"), storeId, editionId: z.string() }),
  z.object({ type: z.literal("run_done"), runId: z.string(), editionIds: z.array(z.string()) }),
  // Upgrade events. One `step_metrics` per model call, so the run panel shows which Nemotron did what.
  z.object({
    type: z.literal("step_metrics"),
    storeId: storeId.optional(),
    role: ModelRole,
    model: z.string().min(1),
    tool: z.string().optional(),
    ms: z.number().nonnegative(),
    promptTokens: z.number().int().nonnegative(),
    cachedTokens: z.number().int().nonnegative(),
    completionTokens: z.number().int().nonnegative(),
    usd: z.number().nonnegative(),
  }),
  z.object({ type: z.literal("review"), storeId, ...ReviewFields.shape }),
  z.object({ type: z.literal("progress"), runId: z.string(), done: z.number().int().nonnegative(), total: z.number().int().nonnegative() }),
  z.object({ type: z.literal("error"), storeId: storeId.optional(), code: z.string(), message: z.string() }),
]);
export type AgentEvent = z.infer<typeof AgentEvent>;
export type AgentEventType = AgentEvent["type"];
