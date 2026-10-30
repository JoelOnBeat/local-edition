"use client";

import { useEffect, useMemo, useState } from "react";
import type { RunListItem } from "@/contract";
import { getApi } from "@/lib/api-client";
import { deriveRun } from "./run-model";
import { listKnownRuns, subscribeRuns, type RunState } from "./run-store";

/** What a run row or card shows: where it stands, what it did and what it cost. */
export interface RunSummary {
  runId: string;
  state: "live" | "finished" | "partial" | "failed" | "stopped";
  done: number;
  total: number;
  /** Tool calls, tokens and models are read from the trace, so a run this tab never held has none until it is opened. */
  toolCalls: number | null;
  tokens: number | null;
  usd: number;
  models: string[];
  startedAt?: number;
}

export function summarize(r: RunState): RunSummary {
  const m = deriveRun(r.events);
  const live = r.status === "streaming" || r.status === "reconnecting";
  return {
    runId: r.runId,
    state: m.finished ? "finished" : live ? "live" : "stopped",
    done: m.done,
    total: m.total,
    toolCalls: m.toolCalls,
    tokens: m.promptTokens + m.completionTokens,
    usd: m.usd,
    models: m.models.map((x) => x.model),
    startedAt: r.startedAt,
  };
}

const SERVER_STATE: Record<RunListItem["status"], RunSummary["state"]> = { running: "live", done: "finished", done_with_skips: "partial", failed: "failed" };

/** A run from the server's log (D1): status, stores, cost and start time. The trace itself replays when the run is opened. */
export function fromServer(r: RunListItem): RunSummary {
  return { runId: r.id, state: SERVER_STATE[r.status], done: r.done, total: r.total, toolCalls: null, tokens: null, usd: r.usd, models: [], startedAt: Date.parse(r.startedAt) };
}

/**
 * The server's runs with this tab's richer copy laid over them: the tab holds the full trace (tool calls, tokens, models) and the live
 * stream, so where both know a run the tab's summary wins for what it holds, and the server's status is kept (it outlives the stream) along with its start time and cost when the tab's are missing.
 * Runs only this tab holds (no D1 log, as in development) are kept. Newest first.
 */
export function mergeRuns(local: RunSummary[], server: RunListItem[]): RunSummary[] {
  const out = new Map(server.map((r) => [r.id, fromServer(r)]));
  for (const l of local) {
    const s = out.get(l.runId);
    out.set(l.runId, s ? { ...s, ...l, startedAt: l.startedAt ?? s.startedAt, usd: l.usd || s.usd, state: s.state } : l);
  }
  return [...out.values()].sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0));
}

const POLL_MS = 8_000;

/** The workspace's run log from the server, newest first. `ready` once the first answer (or failure) is in; polls while a run is live. */
export function useServerRuns(): { runs: RunListItem[]; ready: boolean; failed: boolean } {
  const [state, setState] = useState<{ runs: RunListItem[]; ready: boolean; failed: boolean }>({ runs: [], ready: false, failed: false });
  const live = state.runs.some((r) => r.status === "running");
  useEffect(() => {
    let off = false;
    const load = () => getApi().listRuns().then((r) => { if (!off) setState({ runs: r.runs, ready: true, failed: false }); }, () => { if (!off) setState((s) => ({ ...s, ready: true, failed: true })); });
    void load();
    if (!live) return () => { off = true; };
    const t = setInterval(() => void load(), POLL_MS);
    return () => { off = true; clearInterval(t); };
  }, [live]);
  return state;
}

/** Every run this tab knows, newest first, kept current while any of them streams. Empty on the server and before mount. */
export function useKnownRuns(): RunSummary[] {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  useEffect(() => {
    const read = () => setRuns(listKnownRuns().map(summarize));
    read();
    const off = subscribeRuns(read);
    return () => {
      off();
    };
  }, []);
  return runs;
}

/** The workspace's runs, whichever tab started them: the server's log merged with this tab's traces. `ready` is false until the log has answered. */
export function useRunSummaries(): { runs: RunSummary[]; ready: boolean; failed: boolean } {
  const local = useKnownRuns();
  const server = useServerRuns();
  const runs = useMemo(() => mergeRuns(local, server.runs), [local, server.runs]);
  return { runs, ready: server.ready, failed: server.failed };
}

/** "Today, 14:07" / "Thu 29 Oct, 09:12" in New York time; "Earlier run" when the start was not recorded. */
export function runWhen(ms: number | undefined): string {
  if (!ms) return "Earlier run";
  const d = new Date(ms);
  const tz = "America/New_York";
  const day = d.toLocaleDateString("en-CA", { timeZone: tz });
  const today = new Date().toLocaleDateString("en-CA", { timeZone: tz });
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: tz });
  return day === today ? `Today, ${time}` : `${d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: tz })}, ${time}`;
}
