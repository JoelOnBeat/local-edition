import type { AgentEvent, EditionItemKind } from "@/contract";
import { runTool } from "./exec";
import { flush } from "./metrics";
import { TOOL_BY_NAME, type ToolCtx } from "./tools";

/** The fixed tool order used when tool calling misbehaves. The model never chooses here. */
export const FALLBACK_SEQUENCE = ["block_profile", "menu_match", "places_near", "partners_rank", "artists_local", "events_this_week"] as const;

const NEEDED: Record<EditionItemKind, readonly string[]> = {
  special: ["block_profile", "menu_match"],
  sound: ["block_profile", "artists_local"],
  partner: ["block_profile", "places_near", "partners_rank"],
  event: ["block_profile", "events_this_week"],
};

/** Runs whichever fixed steps have not produced data yet, narrating each as events. */
export async function* runFallbackPlan(ctx: ToolCtx, focus?: EditionItemKind): AsyncGenerator<AgentEvent, void> {
  const wanted = focus ? NEEDED[focus] : FALLBACK_SEQUENCE;
  for (const name of FALLBACK_SEQUENCE) {
    if (!wanted.includes(name) || ctx.mem.done.has(name) || ctx.mem.skipped.has(name)) continue;
    if (name === "partners_rank" && ctx.mem.places.size === 0) continue;
    if (name === "menu_match" && !ctx.mem.profile) continue;
    yield* runTool(ctx, TOOL_BY_NAME.get(name)!, {});
    yield* flush(ctx.deps);
  }
}
