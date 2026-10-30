"use client";

import { useSyncExternalStore } from "react";
import type { AgentEvent } from "@/contract";
import { getApi } from "@/lib/api-client";
import { clientDataMode } from "@/lib/env";
import { parseSseStream } from "@/lib/sse-client";
import { toShownError, type ShownError } from "../lib/use-async";

/**
 * Client-side home of every build run this tab started. The portfolio starts a build here and navigates to the run
 * view as soon as `run_started` arrives; the run view reads the same state, so nothing is lost in the hand-off.
 * Events are mirrored to sessionStorage, and in app mode a dropped stream re-attaches with `Last-Event-ID: 0`
 * (the server replays the run from its log), so a disconnect or a reload resumes from replay.
 */

export type RunStatus = "streaming" | "reconnecting" | "done" | "failed" | "detached";
export interface RunState {
  runId: string;
  events: AgentEvent[];
  status: RunStatus;
  error?: ShownError;
  attempts: number;
}

const runs = new Map<string, RunState>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const KEY = (id: string) => `le-run:${id}`;
const MAX_RESUMES = 4;

function save(s: RunState) {
  try {
    sessionStorage.setItem(KEY(s.runId), JSON.stringify({ runId: s.runId, events: s.events, status: s.status }));
  } catch {
    /* storage full or blocked: the in-memory copy still works */
  }
}

function set(runId: string, patch: Partial<RunState>, persist = false) {
  const prev = runs.get(runId) ?? { runId, events: [], status: "streaming" as RunStatus, attempts: 0 };
  const next = { ...prev, ...patch };
  runs.set(runId, next);
  if (persist || next.status !== "streaming" || next.events.length % 12 === 0) save(next);
  emit();
}

const isTerminal = (e: AgentEvent) => e.type === "run_done";

async function pump(runId: string, stream: AsyncIterable<AgentEvent>, replay: boolean) {
  let first = true;
  for await (const e of stream) {
    if (first && replay) {
      first = false;
      if (e.type === "run_started" && e.runId !== runId) {
        set(runId, { status: "detached" }, true);
        return;
      }
      set(runId, { events: [e], status: "streaming" });
      continue;
    }
    first = false;
    const cur = runs.get(runId)!;
    set(runId, { events: [...cur.events, e], status: isTerminal(e) ? "done" : "streaming" }, isTerminal(e));
  }
  const cur = runs.get(runId);
  if (cur && cur.status === "streaming") throw new Error("stream ended early");
}

/** Re-attach to the workspace's latest run and replay it from the start (app mode only). */
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
    const res = await fetch("/api/editions/build", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "text/event-stream", "last-event-id": "0" },
      body: "{}",
      credentials: "same-origin",
    });
    if (!res.ok || !res.body) throw new Error(`reattach failed (${res.status})`);
    await pump(runId, parseSseStream(res.body), true);
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
    runs.set(runId, { runId, events: [first.value], status: "streaming", attempts: 0 });
    save(runs.get(runId)!);
    emit();
    const rest = { [Symbol.asyncIterator]: () => stream };
    pump(runId, rest, false).catch((e: unknown) => {
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
    const saved = JSON.parse(raw) as { events: AgentEvent[]; status: RunStatus };
    const done = saved.events.some(isTerminal);
    runs.set(runId, { runId, events: saved.events, status: done ? "done" : "reconnecting", attempts: 0 });
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
