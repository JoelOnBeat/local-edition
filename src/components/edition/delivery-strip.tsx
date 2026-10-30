import type { Delivery } from "@/contract";
import { Chip, ProviderBadge } from "../ui";
import { formatDateTime } from "../lib/format";

const TONE: Record<Delivery["status"], "ok" | "warn" | "flag" | "neutral"> = { sent: "ok", pending: "warn", failed: "flag", skipped: "neutral" };

/** Where the approved edition went (Square, Slack, mail…). Renders nothing until a connector has delivered something. */
export function DeliveryStrip({ deliveries }: { deliveries: Delivery[] }) {
  if (!deliveries.length) return null;
  return (
    <section className="border-t border-rule pt-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">Where it went</p>
      <ul className="mt-2 flex flex-wrap gap-2">
        {deliveries.map((d, i) => {
          const body = (
            <>
              <ProviderBadge provider={d.provider} />
              <Chip tone={TONE[d.status]}>{d.status}</Chip>
              <span className="text-[11.5px] text-muted">{formatDateTime(d.at)}</span>
            </>
          );
          return (
            <li key={`${d.provider}-${d.itemId ?? "all"}-${i}`} title={d.note ?? undefined}>
              {d.url ? (
                <a href={d.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-[var(--radius)] border border-rule px-2.5 py-1.5 hover:border-ink-2">{body}</a>
              ) : (
                <span className="inline-flex items-center gap-2 rounded-[var(--radius)] border border-rule px-2.5 py-1.5">{body}</span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
