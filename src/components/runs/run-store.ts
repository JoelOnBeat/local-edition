"use client";

import { useSyncExternalStore } from "react";
import type { AgentEvent } from "@/contract";
import { getApi } from "@/lib/api-client";
import { clientDataMode } from "@/lib/env";
import type { SeqEvent } from "@/lib/sse-client";
import { toShownError, type ShownError } from "../lib/use-async";

/**
 * Client-side home of every build run this tab started. The portfolio starts a build here and navigates to the run
 * view as soon as `run_started` arrives; the run view reads the same state, so nothing is lost in the hand-off.
 * Events are mirrored to sessionStorage, and in app mode a dropped stream re-attaches through `api.resumeBuild`: the first time from
 * the start (the server replays the run from its log, `Last-Event-ID: 0`), after that from the last `id:` it parsed, so a
 * disconnect or a reload resumes where it left off.
 */

export type RunStatus = "streaming" | "reconnecting" | "done" | "failed" | "detached";
export interface RunState {
  runId: string;
  events: AgentEvent[];
  status: RunStatus;
  error?: ShownError;
  attempts: number;
  /** The server's id of the last event we hold (its event-log sequence); 0 until a replay has told us. */
  seq: number;
  /** When this tab started the build (ms since epoch). Display only; absent for runs saved before it was recorded. */
  startedAt?: number;
}

const runs = new Map<string, RunState>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const KEY = (id: string) => `le-run:${id}`;
const MAX_RESUMES = 4;

function save(s: RunState) {
  try {
    sessionStorage.setItem(KEY(s.runId), JSON.stringify({ runId: s.runId, events: s.events, status: s.status, seq: s.seq, startedAt: s.startedAt }));
  } catch {
    /* storage full or blocked: the in-memory copy still works */
  }
}

function set(runId: string, patch: Partial<RunState>, persist = false) {
  const prev = runs.get(runId) ?? { runId, events: [], status: "streaming" as RunStatus, attempts: 0, seq: 0 };
  const next = { ...prev, ...patch };
  runs.set(runId, next);
  if (persist || next.status !== "streaming" || next.events.length % 12 === 0) save(next);
  emit();
}

const isTerminal = (e: AgentEvent) => e.type === "run_done";

async function pump(runId: string, stream: AsyncIterable<AgentEvent>) {
  for await (const e of stream) {
    const cur = runs.get(runId)!;
    set(runId, { events: [...cur.events, e], status: isTerminal(e) ? "done" : "streaming" }, isTerminal(e));
  }
  const cur = runs.get(runId);
  if (cur && cur.status === "streaming") throw new Error("stream ended early");
}

/** Pumps a re-attached stream. From the start (`fromStart`) the replay replaces what we hold; otherwise events append after `seq`. */
async function pumpResumed(runId: string, stream: AsyncIterable<SeqEvent>, fromStart: boolean) {
  let first = fromStart;
  for await (const { seq, event: e } of stream) {
    if (first) {
      first = false;
      if (e.type === "run_started" && e.runId !== runId) {
        set(runId, { status: "detached" }, true);
        return;
      }
      set(runId, { events: [e], status: "streaming", seq: seq ?? 0 });
      continue;
    }
    const cur = runs.get(runId)!;
    set(runId, { events: [...cur.events, e], status: isTerminal(e) ? "done" : "streaming", seq: seq ?? cur.seq }, isTerminal(e));
  }
  const cur = runs.get(runId);
  if (cur && cur.status === "streaming") throw new Error("stream ended early");
}

/** Re-attach to the workspace's latest run (app mode only): a replay from the start first, then from the last event id we saw. */
async function resume(runId: string) {
  const cur = runs.get(runId);
  if (!cur || cur.status === "done") return;
  if (clientDataMode() === "mock" || cur.attempts >= MAX_RESUMES) {
    set(runId, { status: "detached" }, true);
    return;
  }
  set(runId, { status: "reconnecting", attempts: cur.attempts + 1 });
  await new Promise((r) => setTimeout(r, 600 * 2 ** cur.attempts));
  try {
    const after = runs.get(runId)?.seq ?? 0;
    await pumpResumed(runId, getApi().resumeBuild(after), after === 0);
  } catch {
    await resume(runId);
  }
}

/** Starts a build. Resolves with the run id once the server confirms it; rejects with the API error before that. */
export function startBuild(body: { storeIds?: string[]; force?: boolean } = {}): Promise<string> {
  const stream = getApi().buildEditions(body)[Symbol.asyncIterator]();
  return (async () => {
    const first = await stream.next();
    if (first.done || first.value.type !== "run_started") throw new Error("The build did not start. Try again.");
    const runId = first.value.runId;
    runs.set(runId, { runId, events: [first.value], status: "streaming", attempts: 0, seq: 0, startedAt: Date.now() });
    save(runs.get(runId)!);
    emit();
    const rest = { [Symbol.asyncIterator]: () => stream };
    pump(runId, rest).catch((e: unknown) => {
      set(runId, { error: toShownError(e) });
      void resume(runId);
    });
    return runId;
  })();
}

function hydrate(runId: string): RunState | undefined {
  if (runs.has(runId)) return runs.get(runId);
  if (typeof window === "undefined") return undefined;
  try {
    const raw = sessionStorage.getItem(KEY(runId));
    if (!raw) return undefined;
    const saved = JSON.parse(raw) as { events: AgentEvent[]; status: RunStatus; seq?: number; startedAt?: number };
    const done = saved.events.some(isTerminal);
    runs.set(runId, { runId, events: saved.events, status: done ? "done" : "reconnecting", attempts: 0, seq: saved.seq ?? 0, startedAt: saved.startedAt });
    if (!done) queueMicrotask(() => void resume(runId));
    return runs.get(runId);
  } catch {
    return undefined;
  }
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** The live state of one run, or undefined when this tab never saw it. */
export function useRun(runId: string): RunState | undefined {
  return useSyncExternalStore(subscribe, () => hydrate(runId), () => undefined);
}

/**
 * Read-only: every run this tab knows (in memory, or saved in sessionStorage), newest first. It never re-attaches a stream, so
 * listing runs on the portfolio or the runs page does not start any network work.
 */
export function listKnownRuns(): RunState[] {
  const out = new Map<string, RunState>(runs);
  if (typeof window !== "undefined") {
    try {
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        if (!key?.startsWith("le-run:")) continue;
        const id = key.slice("le-run:".length);
        if (out.has(id)) continue;
        const saved = JSON.parse(sessionStorage.getItem(key) ?? "null") as { events?: AgentEvent[]; status?: RunStatus; seq?: number; startedAt?: number } | null;
        if (!saved?.events?.length) continue;
        out.set(id, { runId: id, events: saved.events, status: saved.events.some(isTerminal) ? "done" : (saved.status ?? "detached"), attempts: 0, seq: saved.seq ?? 0, startedAt: saved.startedAt });
      }
    } catch {
      /* storage blocked: the in-memory runs are still listed */
    }
  }
  return [...out.values()].sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0));
}

/** Re-renders when any run changes; pairs with listKnownRuns(). */
export const subscribeRuns = subscribe;
