import { z } from "zod";
import { createLogger } from "../log";
import { UpstreamError } from "../http/errors";
import { asModelUnavailable } from "../http/model-unavailable";
import { askJson, askText } from "./json";
import type { Candidate } from "./plan";
import { COPY_MODEL, limitsOf, type AgentDeps, type StoreContext } from "./ports";
import { templateCopy, type CopyFields } from "./templates";

const log = createLogger("agent:copy");

const SCHEMAS = {
  special: z.object({ name: z.string().min(2).max(60), description: z.string().min(10).max(220), staffLine: z.string().min(5).max(160) }),
  sound: z.object({ brief: z.string().min(10).max(280), mood: z.string().min(2).max(60) }),
  partner: z.object({ reason: z.string().min(10).max(220), offerIdea: z.string().min(10).max(200) }),
  event: z.object({ title: z.string().min(3).max(80), description: z.string().min(10).max(240) }),
} as const;

const SHAPES: Record<keyof typeof SCHEMAS, string> = {
  special: `{"name": "<=60 chars, a menu-board name", "description": "<=220 chars, one or two sentences", "staffLine": "<=160 chars, what staff say at the counter"}`,
  sound: `{"brief": "1-2 sentences telling staff what to play and why", "mood": "2-4 words"}`,
  partner: `{"reason": "<=220 chars, why this neighbour fits", "offerIdea": "<=200 chars, one concrete cross-promotion"}`,
  event: `{"title": "<=80 chars", "description": "<=240 chars, what happens in the shop that evening"}`,
};

export function voiceSystem(sc: StoreContext): string {
  // Brand voice first, then the rules: the same prefix for every item of a chain, so the provider's prompt cache hits.
  return [
    `Brand voice: ${sc.chain.brandVoice.join(" ")}`,
    `You write short in-store copy for ${sc.chain.name}, a ${sc.chain.category} chain.`,
    "Rules: plain text, no emojis. Use only the facts given. No health, diet, nutrition or allergen claims. Never mention age, gender, ethnicity or religion groups. No prices or discounts unless a fact states one. Say \"rising in Qloo's population data\", never \"rising on this street\".",
    "Reply with only a JSON object.",
  ].join("\n");
}

function factsFor(c: Candidate, sc: StoreContext, evidenceFacts: string[]): string {
  const head: string[] = [`Store: ${sc.store.name} (${sc.store.addressLabel}), ${sc.chain.city.name}. Week of ${sc.weekOf}.`];
  if (c.kind === "special") head.push(`Base menu item: ${c.menuItem.name} (${c.menuItem.category}). ${c.menuItem.description ?? ""}`, `The block leans: ${c.tagNames.join(", ")}.`);
  if (c.kind === "sound") head.push(`Artists to play: ${c.artists.slice(0, 8).map((a) => a.name).join(", ")}.`, `Mood: ${c.mood}.`, c.blockTags.length ? `Block leans: ${c.blockTags.join(", ")}.` : "");
  if (c.kind === "partner") head.push(`Neighbour: ${c.place.entity.name}, ${Math.round(c.place.distanceM)} m away${c.place.address ? `, ${c.place.address}` : ""}. Tags: ${c.place.tags.slice(0, 3).join(", ")}.`);
  if (c.kind === "event") head.push(`Event night: ${c.day} at ${c.time}.`, c.tieIn ? `Tie-in: a real event, "${c.tieIn.title}" (${c.tieIn.url}).` : "No external event; a block-led night.");
  if (c.kind !== "sound" && c.angle) head.push(`Planner's angle: ${c.angle}`);
  return [...head.filter(Boolean), "Evidence:", ...evidenceFacts.map((f) => `- ${f}`)].join("\n");
}

export interface CopyResult {
  fields: CopyFields;
  /** True when the copy model failed and the plain template was used. */
  templated: boolean;
  /** The copy model's id when the template was used because the model is unavailable (404, model_not_found, not listed). */
  unavailable?: string;
}

/** Lightning writes the item's text in the chain's voice; on any model failure the template stands in. */
export async function writeCopy(deps: AgentDeps, sc: StoreContext, c: Candidate, evidenceFacts: string[], hint?: string): Promise<CopyResult> {
  const kind = c.kind;
  try {
    const user = `${factsFor(c, sc, evidenceFacts)}\n${hint ? `Head office note: ${hint}\n` : ""}Write the ${kind} copy as JSON: ${SHAPES[kind]}`;
    const fields = await askJson(deps.chat, { model: COPY_MODEL, system: voiceSystem(sc), user, schema: SCHEMAS[kind], timeoutMs: limitsOf(deps).chatTimeoutMs, tag: "write_copy" });
    return { fields: fields as CopyFields, templated: false };
  } catch (e) {
    if (e instanceof UpstreamError && e.code === "spend_cap") throw e;
    log.warn("copy model failed, using template", { kind, err: e });
    const gone = asModelUnavailable(e, COPY_MODEL);
    return { fields: templateCopy(c, sc), templated: true, ...(gone ? { unavailable: gone.model } : {}) };
  }
}

/** One rewrite of a single field with the flagged claim removed. Returns null when the model cannot. */
export async function rewriteField(deps: AgentDeps, sc: StoreContext, field: string, text: string, reasons: string[]): Promise<string | null> {
  try {
    return await askText(deps.chat, {
      model: COPY_MODEL,
      system: `${voiceSystem(sc).replace("Reply with only a JSON object.", "Reply with only the rewritten text.")}`,
      user: `Rewrite this ${field} so it keeps the same meaning but removes whatever was flagged.\nFlagged because: ${reasons.join("; ") || "policy"}.\nText: ${text}`,
      timeoutMs: limitsOf(deps).chatTimeoutMs,
      tag: "rewrite_copy",
    });
  } catch (e) {
    if (e instanceof UpstreamError && e.code === "spend_cap") throw e;
    log.warn("rewrite failed", { field, err: e });
    return null;
  }
}
