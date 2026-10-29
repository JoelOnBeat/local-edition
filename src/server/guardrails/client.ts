import { z } from "zod";
import { GuardrailResult } from "@/contract";
import { HttpError } from "../http/errors";
import { getTokenFactory, type TokenFactory } from "../tokenfactory";
import { findHits, reasonsFor } from "./catalogue";
import { findInjection } from "./injection";
import { selfCheckOutput } from "./self-check";

export const CopyKind = z.enum(["special", "event", "card", "sound", "partner", "other"]);
export type CopyKind = z.infer<typeof CopyKind>;

export const CheckCopyInput = z.object({
  text: z.string(),
  kind: CopyKind,
  brandVoice: z.array(z.string()).max(3),
});
export type CheckCopyInput = z.input<typeof CheckCopyInput>;

export interface CheckCopyOptions {
  /** Default: the shared Token Factory client. */
  tokenFactory?: TokenFactory;
  /** Test seam. */
  now?: () => number;
}

/** Rail names. The regex rail and the self check use NeMo's flow names so live and batch verdicts read alike. */
export const RAIL_CLAIMS = "check health claims";
export const RAIL_SELF_CHECK = "self check output";
export const RAIL_INJECTION = "strip prompt injection";
/** Longest copy the checker accepts. Longer text is refused with 413, never waved through as "unchecked". */
export const MAX_TEXT = 8000;
/** Copy built from web snippets: the event, and the staff card that repeats it. */
const WEB_KINDS: ReadonlySet<CopyKind> = new Set<CopyKind>(["event", "card"]);
const BREAKER_MS = 10_000;

export interface CheckedCopy {
  result: GuardrailResult;
  /** The text to use. Nothing here rewrites copy, so it is the input text. */
  text: string;
}

let modelDownUntil = 0;

/** Test seam: forget the circuit-breaker state. */
export function resetGuardrailsBreaker(): void {
  modelDownUntil = 0;
}

/**
 * Live check, in the Worker, no sidecar. Never throws except HttpError 413 `copy_too_long`.
 *   1. event and card copy is built from web snippets: a prompt-injection phrase blocks it (our rule, mirror of injection.py);
 *   2. the regex catalogue (our rule, mirror of the NeMo `check health claims` rail): a hit blocks, no model call;
 *   3. NeMo's own `self check output` prompt on Lightning, reasoning off: "Yes" blocks;
 *   4. otherwise `passed`. If the model call is skipped (failure, no live model, a breaker after a failure) the copy
 *      still passed the regex rail and says so in `reasons`. `unchecked` is only for empty or invalid input.
 * Every verdict is `checkedBy: "live"`; the NeMo library in the Nebius job re-certifies it later.
 */
export async function checkCopyDetailed(input: CheckCopyInput, options: CheckCopyOptions = {}): Promise<CheckedCopy> {
  const parsed = CheckCopyInput.safeParse(input);
  const text = typeof input?.text === "string" ? input.text : "";
  const unchecked = (why: string): CheckedCopy => ({ text, result: { status: "unchecked", reasons: [why], checkedBy: "live" } });
  if (!parsed.success) return unchecked("The copy could not be checked: invalid input.");
  const value = parsed.data;
  if (!value.text.trim()) return unchecked("There is no copy to check.");
  if (value.text.length > MAX_TEXT) {
    throw new HttpError(413, "copy_too_long", `Copy can be at most ${MAX_TEXT} characters.`);
  }
  const blocked = (rail: string, reasons: string[]): CheckedCopy => ({
    text: value.text,
    result: { status: "blocked", rail, reasons, original: value.text, checkedBy: "live" },
  });

  if (WEB_KINDS.has(value.kind)) {
    const injected = findInjection(value.text);
    if (injected.length) return blocked(RAIL_INJECTION, injected.map((h) => `${h.rule.reason} Matched "${h.match.slice(0, 80)}".`));
  }
  const claims = findHits(value.text);
  if (claims.length) return blocked(RAIL_CLAIMS, reasonsFor(claims));

  const now = options.now ?? Date.now;
  const skipNote = (why: string): CheckedCopy => ({
    text: value.text,
    result: { status: "passed", reasons: [`Skipped self check output: ${why}.`], checkedBy: "live" },
  });
  if (now() < modelDownUntil) return skipNote("the model was recently unreachable");

  const check = await selfCheckOutput(options.tokenFactory ?? getTokenFactory(), value.text, value.kind, value.brandVoice);
  if (check.outcome === "skipped") {
    if (check.why === "the model call failed") modelDownUntil = now() + BREAKER_MS;
    return skipNote(check.why);
  }
  if (check.outcome === "block") {
    return blocked(RAIL_SELF_CHECK, ["The self check (NeMo's prompt on Lightning) says the copy breaks the brand voice or the claims policy."]);
  }
  return { text: value.text, result: { status: "passed", reasons: [], checkedBy: "live" } };
}

/** Same as checkCopyDetailed, returning only the contract's GuardrailResult. */
export async function checkCopy(input: CheckCopyInput, options: CheckCopyOptions = {}): Promise<GuardrailResult> {
  return (await checkCopyDetailed(input, options)).result;
}
