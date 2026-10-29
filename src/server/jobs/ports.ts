import type { AgentEvent, Chain, GuardrailResult, MenuItem, Store } from "@/contract";
import type { Repo } from "../store";

/**
 * Seams to the streams built in parallel (C: edition agent, D: guardrails). Handlers depend on these
 * types only; `wiring.ts` is the single file that imports the real modules, and tests inject fakes.
 */

export type CopyKind = "special" | "sound" | "partner" | "event" | "card";

/** Same shape as stream C's GuardrailsPort.checkCopy. `text` is the revised copy when rewritten. */
export type CheckCopy = (input: { text: string; kind: CopyKind; brandVoice: string[] }) => Promise<GuardrailResult & { text?: string }>;

export interface BuildArgs {
  repo: Repo;
  workspaceId: string;
  chain: Chain;
  stores: Store[];
  menu: MenuItem[];
  /** ISO Monday the editions are for. */
  weekOf: string;
  runId: string;
}

/** Builds and persists editions; yields the same AgentEvents the SSE build route streams. */
export type BuildEditions = (args: BuildArgs) => AsyncIterable<AgentEvent>;

export type GuardrailsProbe = () => Promise<"up" | "down" | "local">;

export interface Ports {
  checkCopy: CheckCopy;
  buildEditions: BuildEditions;
  /** Optional override of the HTTP health probe (e.g. when guardrails run in-process). */
  probeGuardrails?: GuardrailsProbe;
  /** Runs work after the response is sent (Workers `waitUntil`). Default: fire and forget. */
  background: (work: Promise<unknown>) => void;
}

export type JobPorts = Pick<Ports, "buildEditions" | "background">;

let overrides: Partial<Ports> = {};

/** Tests (and the architect's wiring) replace any subset. */
export function setPorts(next: Partial<Ports>): void {
  overrides = { ...overrides, ...next };
}
export function resetPorts(): void {
  overrides = {};
}

export function getOverrides(): Partial<Ports> {
  return overrides;
}

export function getGuardrailsProbe(): GuardrailsProbe | undefined {
  return overrides.probeGuardrails;
}
