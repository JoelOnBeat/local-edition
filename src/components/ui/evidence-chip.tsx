import type { Evidence } from "@/contract";
import { cx } from "./cx";
import { ProviderBadge, type Provider } from "./provider-badge";

const sourceProvider = (s: Evidence["source"]): Provider => (s === "tokenfactory" ? "nemotron" : s);

/** The single most telling number on a piece of evidence, as plain words. */
export function headlineMetric(e: Evidence): string | null {
  const m = e.metrics;
  if (m.lift !== undefined) return `lift ${m.lift >= 0 ? "+" : ""}${m.lift.toFixed(2)}`;
  if (m.affinity !== undefined) return `affinity ${m.affinity.toFixed(2)}`;
  if (m.distanceM !== undefined) return `${Math.round(m.distanceM)} m`;
  if (m.relevance !== undefined) return `relevance ${m.relevance.toFixed(2)}`;
  if (m.popularity !== undefined) return `popularity ${m.popularity.toFixed(2)}`;
  return null;
}

/** One piece of evidence as a chip: provider, endpoint, headline number. Clicking opens the drawer. */
export function EvidenceChip({ evidence, onClick, className }: { evidence: Evidence; onClick?: () => void; className?: string }) {
  const metric = headlineMetric(evidence);
  const body = (
    <>
      <ProviderBadge provider={sourceProvider(evidence.source)} compact />
      <span className="truncate font-mono text-[11.5px] text-ink-2">{evidence.endpoint}</span>
      {metric ? <span className="shrink-0 font-mono text-[11.5px] text-ink">{metric}</span> : null}
    </>
  );
  const cls = cx(
    "inline-flex h-7 max-w-full items-center gap-2 rounded-[var(--radius)] border border-rule bg-paper-2 px-2 text-left",
    onClick && "transition-colors hover:border-ink-2",
    className,
  );
  return onClick ? (
    <button type="button" onClick={onClick} className={cls} aria-label={`Evidence: ${evidence.summary}`}>{body}</button>
  ) : (
    <span className={cls}>{body}</span>
  );
}

export { sourceProvider };
