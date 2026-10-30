import type { Delivery } from "@/contract";
import { CardBand, Chip } from "../ui";
import { Icon } from "../app-ui/icons";
import { LogoTile, PROVIDER_NAME } from "../app-ui/tiles";
import { formatDateTime } from "../lib/format";

const TONE: Record<Delivery["status"], "ok" | "warn" | "flag" | "neutral"> = { sent: "ok", pending: "warn", failed: "flag", skipped: "neutral" };
const LABEL: Record<Delivery["status"], string> = { sent: "Sent", pending: "Sending", failed: "Failed", skipped: "Skipped" };

/** Where the approved edition went (Square, Slack, mail…). Renders nothing until a connector has delivered something. */
export function DeliveryStrip({ deliveries }: { deliveries: Delivery[] }) {
  if (!deliveries.length) return null;
  return (
    <CardBand data-testid="delivery-strip" title="Delivered to" icon={<Icon name="arrowUpRight" />} flush>
      <ul className="divide-y divide-rule-row">
        {deliveries.map((d, i) => {
          const body = (
            <>
              <LogoTile provider={d.provider} size="md" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-medium text-ink-strong">{PROVIDER_NAME[d.provider]}</span>
                <span className="block truncate font-mono text-[11.5px] text-muted">{formatDateTime(d.at)}{d.note ? ` · ${d.note}` : ""}</span>
              </span>
              <Chip tone={TONE[d.status]} dot={d.status !== "skipped"}>{LABEL[d.status]}</Chip>
              {d.url ? <Icon name="arrowUpRight" size={14} className="shrink-0 text-faint transition-colors group-hover:text-ink-2" /> : null}
            </>
          );
          const cls = "group flex items-center gap-3 px-4 py-3";
          return (
            <li key={`${d.provider}-${d.itemId ?? "all"}-${i}`} title={d.note ?? undefined} data-testid={`delivery-${d.provider}`} data-status={d.status}>
              {d.url ? <a href={d.url} target="_blank" rel="noreferrer" className={`${cls} transition-colors hover:bg-row-hover`}>{body}</a> : <div className={cls}>{body}</div>}
            </li>
          );
        })}
      </ul>
    </CardBand>
  );
}
