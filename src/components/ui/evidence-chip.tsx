import type { Evidence } from "@/contract";
import { cx } from "./cx";
import { ProviderTile, type Provider } from "./provider-badge";

/**
 * Which tile a piece of evidence shows. Token Factory evidence is only "Nemotron" when a chat model made it; embedding and
 * rerank calls (Qwen) show as Token Factory, so the badge never credits Nemotron with work it did not do.
 */
const sourceProvider = (s: Evidence["source"], endpoint = ""): Provider =>
  s === "tokenfactory" ? (/embed|rerank/i.test(endpoint) ? "tokenfactory" : "nemotron") : s;

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

/** One piece of evidence as a tag chip: provider tile, endpoint, headline number. Clicking opens the drawer. */
export function EvidenceChip({ evidence, onClick, className }: { evidence: Evidence; onClick?: () => void; className?: string }) {
  const metric = headlineMetric(evidence);
  const body = (
    <>
      <ProviderTile provider={sourceProvider(evidence.source, evidence.endpoint)} size={18} />
      <span className="truncate font-mono text-[12px] text-ink-2">{evidence.endpoint}</span>
      {metric ? <span className="shrink-0 text-[13px] font-medium text-ink-strong tnum">{metric}</span> : null}
    </>
  );
  const cls = cx(
    "inline-flex h-7 max-w-full items-center gap-1.5 rounded-md border border-rule bg-white pl-1 pr-2 text-left",
    onClick && "transition-[background-color,scale] duration-150 ease-quint hover:bg-paper-2 active:scale-[.97]",
    className,
  );
  return onClick ? (
    <button type="button" onClick={onClick} className={cls} aria-label={`Evidence: ${evidence.summary}`}>{body}</button>
  ) : (
    <span className={cls}>{body}</span>
  );
}

export { sourceProvider };
