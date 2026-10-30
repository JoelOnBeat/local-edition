import type { ReactNode } from "react";
import { cx } from "@/components/ui";
import { Icon, type IconName } from "./icons";

/**
 * KPI cells in ByDefault's case-study style (icon + 16/500 label, 32/40 value, caption) laid out as a strip inside one
 * white card with hairline dividers, plus a usage meter bar.
 */

export interface StatCellProps {
  icon?: IconName;
  label: ReactNode;
  value: string;
  sub?: ReactNode;
  /** Optional visual under the value (meter, status bar). */
  visual?: ReactNode;
  testId?: string;
  tone?: "ok" | "warn" | "flag";
}

export function StatCell({ icon, label, value, sub, visual, testId, tone }: StatCellProps) {
  return (
    <div data-testid={testId} data-value={value} className="flex min-w-0 flex-col gap-3 p-5">
      <p className="flex min-w-0 items-center gap-2 text-[14px] font-medium leading-5 text-ink-2">
        {icon ? <Icon name={icon} className="shrink-0 text-faint" /> : null}
        <span className="min-w-0">{label}</span>
      </p>
      <p className={cx("text-[32px] font-medium leading-10 tracking-[-0.02em] tnum [overflow-wrap:anywhere]", tone === "flag" ? "text-flag" : tone === "warn" ? "text-warn-ink" : "text-ink")}>{value}</p>
      {visual}
      {sub ? <p className="text-[13px] leading-5 text-muted [overflow-wrap:anywhere]">{sub}</p> : null}
    </div>
  );
}

/** A row of stat cells in one white plate, divided by hairlines; wraps to two columns, then one. */
export function StatStrip({ cells, className, cols = 4 }: { cells: StatCellProps[]; className?: string; cols?: 2 | 3 | 4 }) {
  return (
    <div className={cx(
      "grid gap-px overflow-hidden rounded-lg bg-rule-subtle shadow-ring-xs [&>*]:bg-white",
      cols === 2 && "sm:grid-cols-2",
      cols === 3 && "sm:grid-cols-3",
      cols === 4 && "sm:grid-cols-2 lg:grid-cols-4",
      className,
    )}>
      {cells.map((c, i) => <StatCell key={i} {...c} />)}
    </div>
  );
}

/** Usage meter: an 8px track with a fill in the threshold colour (≥90% flag, ≥70% warn, else ok). */
export function UsageMeter({ used, cap, label, testId, className }: { used: number; cap: number; label: string; testId?: string; className?: string }) {
  const share = cap > 0 ? Math.min(1, used / cap) : 0;
  const fill = share >= 0.9 ? "bg-flag" : share >= 0.7 ? "bg-warn" : "bg-ok";
  return (
    <div
      data-testid={testId}
      data-used={used}
      data-cap={cap}
      role="meter"
      aria-valuemin={0}
      aria-valuemax={cap}
      aria-valuenow={used}
      aria-label={label}
      className={cx("h-2 w-full overflow-hidden rounded-full bg-stone-100 shadow-[inset_0_0_0_1px_rgb(28_25_23/.04)]", className)}
    >
      <div className={cx("h-full rounded-full transition-[width] duration-500 ease-quint", fill)} style={{ width: `${Math.max(share * 100, used > 0 ? 1.5 : 0)}%` }} />
    </div>
  );
}

/** ByDefault's table frame: a soft grey well around a white plate. */
export function TableFrame({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx("rounded-2xl bg-black/[.04] p-1", className)}>
      <div className="overflow-hidden rounded-xl bg-white shadow-plate">{children}</div>
    </div>
  );
}
