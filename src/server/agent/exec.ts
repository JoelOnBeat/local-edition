import type { AgentEvent } from "@/contract";
import { createLogger } from "../log";
import { UpstreamError } from "../http/errors";
import { limitsOf } from "./ports";
import type { ToolCtx, ToolDef } from "./tools";
import { withTimeout } from "./util";

const log = createLogger("agent:tool");

export interface ToolRun {
  ok: boolean;
  /** True when the arguments failed validation (counts toward the misbehaviour budget). */
  invalid: boolean;
  summary: string;
  payload: unknown;
  evidenceIds: string[];
}

function issueText(err: { issues: { path: PropertyKey[]; message: string }[] }): string {
  return err.issues.slice(0, 3).map((i) => `${i.path.length ? i.path.map(String).join(".") : "arguments"}: ${i.message}`).join("; ");
}

/**
 * Validate the arguments, run one tool under a timeout and narrate it as `tool_call` / `tool_result`
 * events. A failing tool is a result the model can react to; only the spend cap aborts the run.
 */
export async function* runTool(ctx: ToolCtx, def: ToolDef, rawArgs: unknown): AsyncGenerator<AgentEvent, ToolRun> {
  const storeId = ctx.sc.store.id;
  const shown = rawArgs && typeof rawArgs === "object" && !Array.isArray(rawArgs) ? (rawArgs as Record<string, unknown>) : {};
  yield { type: "tool_call", storeId, tool: def.name, args: shown };

  const parsed = def.schema.safeParse(rawArgs ?? {});
  if (!parsed.success) {
    const summary = `invalid arguments: ${issueText(parsed.error)}`;
    yield { type: "tool_result", storeId, tool: def.name, ok: false, summary, evidenceIds: [] };
    return { ok: false, invalid: true, summary, payload: { error: summary }, evidenceIds: [] };
  }

  try {
    const out = await withTimeout(def.run(ctx, parsed.data), limitsOf(ctx.deps).toolTimeoutMs, def.name);
    ctx.mem.done.add(def.name);
    yield { type: "tool_result", storeId, tool: def.name, ok: true, summary: out.summary, evidenceIds: out.evidenceIds };
    return { ok: true, invalid: false, summary: out.summary, payload: out.payload, evidenceIds: out.evidenceIds };
  } catch (e) {
    if (e instanceof UpstreamError && e.code === "spend_cap") throw e;
    const summary = e instanceof UpstreamError ? e.message : "The tool failed.";
    log.warn("tool failed", { tool: def.name, err: e });
    yield { type: "tool_result", storeId, tool: def.name, ok: false, summary, evidenceIds: [] };
    return { ok: false, invalid: false, summary, payload: { error: summary }, evidenceIds: [] };
  }
}
