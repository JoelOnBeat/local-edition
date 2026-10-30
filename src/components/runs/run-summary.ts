"use client";

import { useEffect, useState } from "react";
import { deriveRun } from "./run-model";
import { listKnownRuns, subscribeRuns, type RunState } from "./run-store";

/** What a run row or card shows: where it stands, what it did and what it cost. */
export interface RunSummary {
  runId: string;
  state: "live" | "finished" | "stopped";
  done: number;
  total: number;
  toolCalls: number;
  tokens: number;
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

/** "Today, 14:07" / "Thu 29 Oct, 09:12" in New York time; "Earlier in this tab" when the start was not recorded. */
export function runWhen(ms: number | undefined): string {
  if (!ms) return "Earlier in this tab";
  const d = new Date(ms);
  const tz = "America/New_York";
  const day = d.toLocaleDateString("en-CA", { timeZone: tz });
  const today = new Date().toLocaleDateString("en-CA", { timeZone: tz });
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: tz });
  return day === today ? `Today, ${time}` : `${d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: tz })}, ${time}`;
}
