import type { DataMode, Evidence } from "@/contract";
import { UpstreamError } from "../http/errors";

/** Small deterministic helpers shared across the agent. */

export function fnv(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

export function withTimeout<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new UpstreamError("timeout", label, `${label} did not finish within ${ms} ms.`, { retryable: true })), ms);
  });
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
}

export interface EvidenceDraft {
  source: Evidence["source"];
  endpoint: string;
  params: Record<string, string>;
  summary: string;
  metrics?: Evidence["metrics"];
  entityIds?: string[];
  url?: string;
  mode: DataMode;
  fetchedAt: string;
}

/** Content-addressed evidence: the same call on the same inputs yields the same id. */
export function makeEvidence(d: EvidenceDraft): Evidence {
  const id = `ev_${d.source.slice(0, 2)}_${fnv(JSON.stringify([d.endpoint, d.params, d.summary]))}`;
  return { id, source: d.source, endpoint: d.endpoint, params: d.params, summary: d.summary, metrics: d.metrics ?? {}, entityIds: d.entityIds ?? [], url: d.url, fetchedAt: d.fetchedAt, mode: d.mode };
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
export type DayName = (typeof DAYS)[number];

/** Weekday of an ISO date or date-time, read in the date's own calendar day (no timezone shift). */
export function weekdayOf(iso: string): DayName | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  return DAYS[new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay()];
}

export function timeOf(iso: string): string | null {
  const m = /[T ]([01]\d|2[0-3]):([0-5]\d)/.exec(iso);
  return m ? `${m[1]}:${m[2]}` : null;
}

/** The Monday on or before `now`, as YYYY-MM-DD (UTC calendar). */
export function mondayOf(now: Date): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const back = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
}

/** Dates of the Mon..Sun window starting at `weekOf`. */
export function weekWindow(weekOf: string): { start: string; end: string } {
  const d = new Date(`${weekOf}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 6);
  return { start: weekOf, end: d.toISOString().slice(0, 10) };
}

export function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}
