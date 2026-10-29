import type { GuardrailResult } from "@/contract";
import { createLogger } from "../log";
import { UpstreamError } from "../http/errors";
import { rewriteField } from "./copy";
import type { AgentDeps, CopyKind, StoreContext } from "./ports";
import type { CopyFields } from "./templates";

const log = createLogger("agent:guard");

const UNCHECKED: GuardrailResult = { status: "unchecked", reasons: ["Guardrails were unavailable, so this copy has not been checked."] };
const RANK: Record<GuardrailResult["status"], number> = { passed: 0, rewritten: 1, unchecked: 2, blocked: 3 };

async function check(deps: AgentDeps, sc: StoreContext, kind: CopyKind, text: string) {
  try {
    return await deps.guardrails.checkCopy({ text, kind, brandVoice: sc.chain.brandVoice });
  } catch (e) {
    log.warn("guardrails unavailable", { err: e instanceof UpstreamError ? e.code : (e as Error).name });
    return { ...UNCHECKED };
  }
}

/**
 * Check one field. Blocked copy gets exactly one rewrite from the copy model, then a re-check.
 * Guardrails down means `unchecked`: the text stands but can never be auto-approved.
 */
export async function guardField(
  deps: AgentDeps,
  sc: StoreContext,
  kind: CopyKind,
  field: string,
  text: string,
): Promise<{ text: string; result: GuardrailResult }> {
  const first = await check(deps, sc, kind, text);
  if (first.status === "passed") return { text, result: { status: "passed", reasons: first.reasons ?? [] } };
  if (first.status === "unchecked") return { text, result: { ...UNCHECKED, reasons: first.reasons?.length ? first.reasons : UNCHECKED.reasons } };
  if (first.status === "rewritten") {
    return { text: first.text ?? text, result: { status: "rewritten", rail: first.rail, reasons: first.reasons, original: first.original ?? text } };
  }

  const retry = await rewriteField(deps, sc, field, text, first.reasons);
  if (retry) {
    const second = await check(deps, sc, kind, retry);
    if (second.status === "passed") return { text: retry, result: { status: "rewritten", rail: first.rail, reasons: first.reasons, original: text } };
    if (second.status === "rewritten") return { text: second.text ?? retry, result: { status: "rewritten", rail: second.rail ?? first.rail, reasons: [...first.reasons, ...second.reasons], original: text } };
    if (second.status === "unchecked") return { text: retry, result: { ...UNCHECKED } };
  }
  return { text, result: { status: "blocked", rail: first.rail, reasons: first.reasons, original: text } };
}

/** Merge per-field results: the worst status wins; reasons and originals are concatenated. */
export function mergeResults(parts: { field: string; result: GuardrailResult }[]): GuardrailResult {
  if (!parts.length) return { ...UNCHECKED };
  const worst = parts.reduce((a, b) => (RANK[b.result.status] > RANK[a.result.status] ? b : a));
  const reasons = [...new Set(parts.flatMap((p) => p.result.reasons))];
  const originals = parts.filter((p) => p.result.original).map((p) => p.result.original!);
  return {
    status: worst.result.status,
    ...(worst.result.rail ? { rail: worst.result.rail } : {}),
    reasons,
    ...(originals.length ? { original: originals.join("\n") } : {}),
  };
}

/** Guard every text field of an item concurrently. */
export async function guardFields(
  deps: AgentDeps,
  sc: StoreContext,
  kind: CopyKind,
  fields: CopyFields,
): Promise<{ fields: CopyFields; result: GuardrailResult }> {
  const entries = Object.entries(fields);
  const done = await Promise.all(entries.map(([field, text]) => guardField(deps, sc, kind, field, text)));
  const out: CopyFields = {};
  entries.forEach(([field], i) => { out[field] = done[i].text; });
  return { fields: out, result: mergeResults(entries.map(([field], i) => ({ field, result: done[i].result }))) };
}
