import { z } from "zod";
import { GuardrailResult } from "@/contract";
import { serverEnv } from "@/lib/env";
import { createLogger } from "../log";
import { findHits, reasonsFor } from "./catalogue";

const log = createLogger("guardrails");

export const CopyKind = z.enum(["special", "event", "card", "sound", "partner", "other"]);
export type CopyKind = z.infer<typeof CopyKind>;

export const CheckCopyInput = z.object({
  text: z.string(),
  kind: CopyKind,
  brandVoice: z.array(z.string()).max(3),
});
export type CheckCopyInput = z.input<typeof CheckCopyInput>;

export interface CheckCopyOptions {
  /** Default: GUARDRAILS_URL from the environment. */
  url?: string;
  /** Shared secret sent as x-le-guard-token. Default: GUARDRAILS_TOKEN from the environment. */
  token?: string;
  /** Default 4000. */
  timeoutMs?: number;
  // Test seams.
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export const LOCAL_RAIL = "local:claims";
const MAX_TEXT = 8000;
const BREAKER_MS = 10_000;

/** What POST /v1/checks answers (NeMo Guardrails 0.24.1). */
const ChecksResponse = z.object({
  status: z.enum(["passed", "modified", "blocked"]),
  content: z.string(),
  rail: z.string().optional().nullable(),
});

/** The sidecar's side channel: why it blocked and which checks it skipped (guardrails/config.py). */
const RailsHeader = z.object({
  reasons: z.array(z.string()).default([]),
  skipped: z.array(z.object({ rail: z.string(), why: z.string() })).default([]),
});
type RailsInfo = z.infer<typeof RailsHeader>;

export function parseRailsHeader(raw: string | null): RailsInfo {
  const empty: RailsInfo = { reasons: [], skipped: [] };
  if (!raw) return empty;
  try {
    const parsed = RailsHeader.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : empty;
  } catch {
    return empty;
  }
}

export interface CheckedCopy {
  result: GuardrailResult;
  /** The text to use: the sidecar's rewrite when status is 'rewritten', else the input text. */
  text: string;
}

type Failure = { kind: "down"; why: string } | { kind: "rejected"; why: string };
let downUntil = 0;

/** Test seam: forget the circuit-breaker state. */
export function resetGuardrailsBreaker(): void {
  downUntil = 0;
}

function resolveConfig(o: CheckCopyOptions): { url: string; token: string | undefined } {
  let url = o.url;
  if (!url) {
    try {
      url = serverEnv().GUARDRAILS_URL;
    } catch {
      url = "http://127.0.0.1:8000";
    }
  }
  const token = o.token ?? (typeof process !== "undefined" ? process.env?.GUARDRAILS_TOKEN : undefined);
  return { url: url.replace(/\/+$/, ""), token: token || undefined };
}

async function callSidecar(
  input: z.output<typeof CheckCopyInput>,
  o: CheckCopyOptions,
): Promise<{ ok: true; body: z.infer<typeof ChecksResponse>; info: RailsInfo } | { ok: false; failure: Failure }> {
  const { url, token } = resolveConfig(o);
  const doFetch = o.fetchImpl ?? fetch;
  const timeoutMs = o.timeoutMs ?? 4000;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  const headers: Record<string, string> = { "content-type": "application/json", accept: "application/json" };
  if (token) headers["x-le-guard-token"] = token;
  try {
    const res = await doFetch(`${url}/v1/checks`, {
      method: "POST",
      headers,
      signal: ac.signal,
      body: JSON.stringify({
        model: "nvidia/Nemotron-3_5-Lightning",
        // NeMo 0.24.1 needs a user turn before the assistant turn once a context message is present.
        messages: [
          { role: "user", content: "Check this copy." },
          { role: "assistant", content: input.text },
        ],
        guardrails: {
          config_id: "localedition",
          rail_types: ["output"],
          context: { brand_voice: input.brandVoice, kind: input.kind },
        },
      }),
    });
    if (res.status === 401 || res.status === 403) {
      return { ok: false, failure: { kind: "rejected", why: "The guardrails server rejected the shared secret." } };
    }
    if (!res.ok) return { ok: false, failure: { kind: "down", why: `The guardrails server answered HTTP ${res.status}.` } };
    const parsed = ChecksResponse.safeParse(await res.json());
    if (!parsed.success) {
      return { ok: false, failure: { kind: "down", why: "The guardrails server returned an unexpected response." } };
    }
    return { ok: true, body: parsed.data, info: parseRailsHeader(res.headers.get("x-le-rails")) };
  } catch (e) {
    const timedOut = ac.signal.aborted;
    log.warn("guardrails server unreachable", { err: (e as Error)?.name, timedOut });
    return {
      ok: false,
      failure: { kind: "down", why: timedOut ? `The guardrails server did not answer within ${timeoutMs} ms.` : "The guardrails server is unreachable." },
    };
  } finally {
    clearTimeout(timer);
  }
}

const unique = (xs: string[]) => [...new Set(xs)];

/**
 * Check generated copy. Never throws. Order: the local regex catalogue first (a hit is a block even if the
 * server is down or disagrees), then the NeMo Guardrails sidecar (regex rail again plus the brand-voice
 * self-check). Server down or timed out -> 'unchecked' (never auto-approvable), or 'blocked' with
 * rail 'local:claims' when the local catalogue already hit.
 */
export async function checkCopyDetailed(input: CheckCopyInput, options: CheckCopyOptions = {}): Promise<CheckedCopy> {
  const parsed = CheckCopyInput.safeParse(input);
  const text = typeof input?.text === "string" ? input.text : "";
  const unchecked = (why: string): CheckedCopy => ({ text, result: { status: "unchecked", reasons: [why] } });
  if (!parsed.success) return unchecked("The copy could not be checked: invalid input.");
  const value = parsed.data;
  if (!value.text.trim()) return unchecked("There is no copy to check.");
  if (value.text.length > MAX_TEXT) return unchecked("The copy is too long to check.");

  const now = options.now ?? Date.now;
  const local = findHits(value.text);
  const localReasons = reasonsFor(local);

  const blockedLocally = (note: string): CheckedCopy => ({
    text: value.text,
    result: { status: "blocked", rail: LOCAL_RAIL, reasons: [...localReasons, note], original: value.text },
  });

  if (now() < downUntil) {
    return local.length ? blockedLocally("Checked locally only: the guardrails server was recently unreachable.") : unchecked("The guardrails server was recently unreachable.");
  }

  const res = await callSidecar(value, options);
  if (!res.ok) {
    if (res.failure.kind === "down") downUntil = now() + BREAKER_MS;
    return local.length ? blockedLocally(`Checked locally only. ${res.failure.why}`) : unchecked(res.failure.why);
  }

  const { body, info } = res;
  if (local.length) {
    const note = body.status === "blocked" ? [] : ["The guardrails server did not flag this copy; the local catalogue did."];
    return {
      text: value.text,
      result: {
        status: "blocked",
        rail: body.status === "blocked" ? (body.rail ?? "check health claims") : LOCAL_RAIL,
        reasons: unique([...localReasons, ...info.reasons, ...note]),
        original: value.text,
      },
    };
  }

  if (body.status === "blocked") {
    const rail = body.rail ?? "unknown rail";
    return {
      text: value.text,
      result: {
        status: "blocked",
        rail,
        reasons: info.reasons.length ? unique(info.reasons) : [`Blocked by the "${rail}" rail.`],
        original: value.text,
      },
    };
  }

  const skipNotes = info.skipped.map((s) => `Skipped ${s.rail}: ${s.why}.`);
  if (body.status === "modified") {
    const reasons = unique([...info.reasons, ...skipNotes]);
    return {
      text: body.content,
      result: { status: "rewritten", reasons: reasons.length ? reasons : ["The guardrails server rewrote the copy."], original: value.text },
    };
  }
  return { text: value.text, result: { status: "passed", reasons: skipNotes } };
}

/** Same as checkCopyDetailed, returning only the contract's GuardrailResult. */
export async function checkCopy(input: CheckCopyInput, options: CheckCopyOptions = {}): Promise<GuardrailResult> {
  return (await checkCopyDetailed(input, options)).result;
}

/** For /api/status: is the sidecar answering its health route. */
export async function probeGuardrails(options: CheckCopyOptions = {}): Promise<"up" | "down"> {
  const { url } = resolveConfig(options);
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), options.timeoutMs ?? 2000);
  try {
    const res = await (options.fetchImpl ?? fetch)(`${url}/v1/health`, { signal: ac.signal });
    return res.ok ? "up" : "down";
  } catch {
    return "down";
  } finally {
    clearTimeout(timer);
  }
}
