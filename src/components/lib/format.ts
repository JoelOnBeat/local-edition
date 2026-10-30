/** Display formatting shared by the app pages. Dates are shown as the chain reads them (New York). */

const TZ = "America/New_York";

/** "26 Oct 2026" from an ISO date (YYYY-MM-DD), read as a calendar date. */
export function formatDate(isoDate: string, opts: { year?: boolean } = {}): string {
  const d = new Date(`${isoDate.slice(0, 10)}T12:00:00Z`);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(opts.year === false ? {} : { year: "numeric" }), timeZone: "UTC" });
}

/** "Week of 26 Oct" */
export const weekLabel = (weekOf: string, year = false) => `Week of ${formatDate(weekOf, { year })}`;

/** "Mon 26 Oct, 08:05" in New York time. */
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: TZ });
}

/** The Monday on or before a date, as YYYY-MM-DD. */
export function mondayOf(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() - ((day + 6) % 7));
  return d.toISOString().slice(0, 10);
}

/** `n` Mondays ending at `weekOf`, newest first. */
export function previousWeeks(weekOf: string, n: number): string[] {
  const out: string[] = [];
  const d = new Date(`${weekOf}T00:00:00Z`);
  for (let i = 0; i < n; i++) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() - 7);
  }
  return out;
}

export function formatUsd(usd: number): string {
  if (usd === 0) return "$0";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

export const formatInt = (n: number) => n.toLocaleString("en-US");

export function formatMeters(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}

export function formatMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`;
}

/** "nvidia/Nemotron-3_5-Lightning" -> "Nemotron 3.5 Lightning". */
export function modelName(id: string): string {
  const tail = id.split("/").pop() ?? id;
  if (/ultra/i.test(tail)) return "Nemotron 3 Ultra";
  if (/super-vl/i.test(tail)) return "Nemotron 3.5 Super VL";
  if (/lightning/i.test(tail)) return "Nemotron 3.5 Lightning";
  if (/embedding/i.test(tail)) return "Qwen3 Embedding";
  if (/reranker/i.test(tail)) return "Qwen3 Reranker";
  return tail.replace(/[-_]/g, " ");
}

export const pct = (x: number) => `${Math.round(x * 100)}%`;
