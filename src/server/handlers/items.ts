import type { Edition, EditionItem, EditionStatus, GuardrailResult, ItemPatch } from "@/contract";
import { HttpError } from "../http/errors";
import type { CheckCopy } from "../jobs/ports";

/** Fields head office may edit, per item kind. Text fields are re-checked by guardrails. */
const EDITABLE: Record<EditionItem["kind"], readonly (keyof ItemPatch)[]> = {
  special: ["name", "description", "staffLine", "flavourTags"],
  sound: ["brief", "mood"],
  partner: ["reason", "offerIdea"],
  event: ["title", "day", "time", "description"],
};
/** Free-text fields sent to guardrails (flavour tags are checked joined). */
const TEXT_FIELDS: Record<EditionItem["kind"], readonly string[]> = {
  special: ["name", "description", "staffLine", "flavourTags"],
  sound: ["brief", "mood"],
  partner: ["reason", "offerIdea"],
  event: ["title", "description"],
};

/** Applies a patch after checking every key belongs to this kind. */
export function applyPatch(item: EditionItem, patch: ItemPatch): EditionItem {
  const allowed = EDITABLE[item.kind];
  for (const key of Object.keys(patch) as (keyof ItemPatch)[]) {
    if (!allowed.includes(key)) throw new HttpError(400, "invalid_patch", `"${key}" cannot be edited on a ${item.kind} item.`);
  }
  return { ...item, ...patch } as EditionItem;
}

const RANK: Record<GuardrailResult["status"], number> = { passed: 0, rewritten: 1, unchecked: 2, blocked: 3 };

/**
 * Re-runs guardrails over each text field. A rewrite replaces that field; the worst field verdict is the
 * item's verdict. A guardrails outage or throw yields `unchecked` (never `passed`).
 */
export async function recheckItem(item: EditionItem, check: CheckCopy, brandVoice: string[]): Promise<EditionItem> {
  const record = item as unknown as Record<string, unknown>;
  const updates: Record<string, unknown> = {};
  let verdict: GuardrailResult = { status: "passed", reasons: [] };
  for (const field of TEXT_FIELDS[item.kind]) {
    const value = record[field];
    const text = Array.isArray(value) ? value.join(", ") : String(value ?? "");
    if (!text.trim()) continue;
    let result: GuardrailResult & { text?: string };
    try {
      result = await check({ text, kind: item.kind, brandVoice });
    } catch {
      result = { status: "unchecked", reasons: ["Guardrails could not be reached."] };
    }
    if (result.status === "rewritten" && result.text && !Array.isArray(value)) updates[field] = result.text;
    if (RANK[result.status] > RANK[verdict.status]) {
      verdict = { status: result.status, rail: result.rail, reasons: result.reasons, original: result.original ?? (result.status === "rewritten" ? text : undefined) };
    } else if (RANK[result.status] === RANK[verdict.status] && result.status !== "passed") {
      verdict = { ...verdict, reasons: [...new Set([...verdict.reasons, ...result.reasons])] };
    }
  }
  const guardrail: GuardrailResult = { status: verdict.status, reasons: verdict.reasons, ...(verdict.rail ? { rail: verdict.rail } : {}), ...(verdict.original ? { original: verdict.original } : {}) };
  const status = guardrail.status === "blocked" ? "flagged" : "edited";
  return { ...item, ...updates, guardrail, status } as EditionItem;
}

/** Edition status from its items. `drafting` is owned by the build and never derived here. */
export function deriveEditionStatus(edition: Pick<Edition, "status" | "items">): EditionStatus {
  if (edition.status === "drafting") return "drafting";
  const live = edition.items.filter((i) => i.status !== "rejected");
  if (live.some((i) => i.status === "flagged" || i.guardrail.status === "blocked")) return "flagged";
  return live.length > 0 && live.every((i) => i.status === "approved") ? "approved" : "draft";
}

/** Approve-all skips anything that has not clearly passed guardrails: flagged, rejected, unchecked. */
export function autoApprovable(item: EditionItem): boolean {
  return (item.status === "draft" || item.status === "edited") && (item.guardrail.status === "passed" || item.guardrail.status === "rewritten");
}
