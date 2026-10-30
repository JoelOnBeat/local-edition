import type { ReactNode } from "react";
import type { Provider } from "@/components/ui";
import { cx } from "@/components/ui";
import { Icon } from "@/components/app-ui/icons";
import { LogoTile } from "@/components/app-ui/tiles";

/**
 * A connection tile (ByDefault §9 Tile): white 14px card with a preview well on top holding the tool's official mark, its
 * status chip and a tiny picture of what it does, then the text and actions below.
 */
export function ToolTile({ provider, status, preview, children, testId, dataStatus }: {
  provider: Provider;
  status: ReactNode;
  preview?: ReactNode;
  children: ReactNode;
  testId: string;
  dataStatus: string;
}) {
  return (
    <article data-testid={testId} data-status={dataStatus} className="ring-after relative flex min-w-0 flex-col rounded-[14px] bg-white p-1.5">
      <div className="relative h-[132px] overflow-hidden rounded-lg bg-well shadow-[inset_0_0_0_1px_var(--well-ring)]">
        <LogoTile provider={provider} size="lg" className="absolute left-3 top-3 shadow-ring-sm" />
        <div className="absolute right-3 top-3">{status}</div>
        {preview ? <div className="absolute inset-x-3 bottom-0 top-[64px]" aria-hidden>{preview}</div> : null}
      </div>
      <div className="flex flex-1 flex-col gap-3 px-2.5 pb-2.5 pt-3.5">{children}</div>
    </article>
  );
}

/** A white mini card inside the well. */
export function MiniCard({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("rounded-[10px] bg-white px-2.5 py-1.5 text-[12px] leading-4 text-ink-strong shadow-ring-xs", className)}>{children}</div>;
}

/** A grey bar standing in for text in a preview. */
export function Bar({ w, className }: { w: string; className?: string }) {
  return <span className={cx("block h-1.5 rounded-full bg-stone-200", className)} style={{ width: w }} />;
}

/** Square: the menu and locations as rows, with the real counts when connected. */
export function SquarePreview({ items, linked, total, at }: { items?: number; linked?: number; total?: number; at?: string | null }) {
  const rows: [string, string | null][] = [
    ["Menu items", items !== undefined ? String(items) : null],
    ["Locations linked", linked !== undefined && total !== undefined ? `${linked} of ${total}` : null],
    ["Webhook", at ?? null],
  ];
  return (
    <div className="ml-auto grid w-[78%] gap-1.5">
      {rows.map(([k, v]) => (
        <MiniCard key={k} className="flex items-center justify-between gap-2">
          <span className="truncate text-ink-2">{k}</span>
          {v ? <span className="shrink-0 font-medium tnum">{v}</span> : <Bar w="28px" />}
        </MiniCard>
      ))}
    </div>
  );
}

/** Slack: a message bubble in the head-office channel. */
export function SlackPreview({ channel }: { channel?: string }) {
  return (
    <MiniCard className="ml-auto w-[82%] px-3 py-2">
      <span className="flex items-center gap-1.5 text-[11px] text-muted"><span className="font-medium text-ink-strong">Local Edition</span>{channel ? `#${channel}` : "#head-office"}</span>
      <span className="mt-1.5 block text-[12px] leading-4 text-ink-2">This week&apos;s editions are ready to approve.</span>
      <span className="mt-2 flex gap-1.5">
        <span className="rounded-md bg-ok-bg px-1.5 py-0.5 text-[11px] font-medium text-ok-strong">Approve</span>
        <span className="rounded-md bg-stone-100 px-1.5 py-0.5 text-[11px] font-medium text-ink-2">Open</span>
      </span>
    </MiniCard>
  );
}

/** Gmail / Outlook: envelopes going out, a reply coming back. */
export function MailPreview() {
  return (
    <div className="ml-auto grid w-[78%] gap-1.5">
      {[["arrowUp", "Staff card to each store", "62%"], ["arrowDown", "Replies come back", "48%"]].map(([icon, label, w]) => (
        <MiniCard key={label} className="flex items-center gap-2">
          <Icon name={icon as "arrowUp"} size={12} className="shrink-0 text-faint" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-ink-strong">{label}</span>
            <Bar w={w} className="mt-1" />
          </span>
        </MiniCard>
      ))}
    </div>
  );
}

/** Calendar: approved event nights as rows. */
export function CalendarPreview({ count }: { count: number }) {
  return (
    <div className="ml-auto grid w-[78%] gap-1.5">
      {[0, 1].map((i) => (
        <MiniCard key={i} className="flex items-center gap-2">
          <span className="flex size-5 shrink-0 items-center justify-center rounded-md bg-accent-subtle text-accent-text"><Icon name="calendar" size={11} /></span>
          <Bar w={i === 0 ? "64%" : "48%"} />
        </MiniCard>
      ))}
      <span className="pl-1 text-[11px] text-muted tnum">{count} event {count === 1 ? "night" : "nights"} in the feed</span>
    </div>
  );
}
