"use client";

import { Skeleton, cx } from "../ui";
import { Dropdown, MenuItem, MenuLabel } from "../app-ui/menu";
import { Icon } from "../app-ui/icons";
import { formatDate, previousWeeks } from "../lib/format";
import { useWorkspace } from "./workspace-context";

export const shortChainName = (name: string) => name.replace(/\s*\(sample chain\)\s*$/i, "");

/** Week select: "Week of 26 Oct" with the last four Mondays. Past weeks are read only. */
export function WeekPicker({ block }: { block?: boolean }) {
  const { currentWeek, week, setWeek, loading } = useWorkspace();
  if (loading) return <Skeleton className="h-8 w-36 rounded-lg" />;
  const weeks = previousWeeks(currentWeek, 4);
  const label = (w: string) => (w === currentWeek ? "This week" : `Week of ${formatDate(w, { year: false })}`);
  return (
    <Dropdown
      label="Week"
      align="end"
      width={block ? "w-full" : "w-60"}
      className={block ? "w-full" : undefined}
      testId="week-select"
      triggerClassName={cx(
        "flex h-8 items-center gap-2 rounded-lg bg-white pl-2.5 pr-2 text-[14px] text-stone-900 shadow-ring-xs transition-colors duration-150 hover:bg-stone-50",
        block && "h-10 w-full",
      )}
      trigger={() => (
        <>
          <Icon name="calendar" size={14} className="shrink-0 text-ink-2" />
          <span className="whitespace-nowrap tnum">{week === currentWeek ? `Week of ${formatDate(week, { year: false })}` : label(week)}</span>
          <Icon name="chevronDown" size={14} className="ml-auto shrink-0 text-faint" />
        </>
      )}
    >
      {(close) => (
        <>
          <MenuLabel>Edition week</MenuLabel>
          {weeks.map((w) => (
            <MenuItem key={w} onClick={() => { setWeek(w); close(); }} active={w === week} className="py-1.5">
              <span className="flex-1">{label(w)}</span>
              <span className="text-[13px] font-normal text-muted tnum">{formatDate(w, { year: false })}</span>
              {w === week ? <Icon name="check" size={14} className="text-ink-2" /> : <span className="w-3.5" />}
            </MenuItem>
          ))}
        </>
      )}
    </Dropdown>
  );
}

export function StatusDot({ status }: { status?: string }) {
  const c = status === "approved" ? "bg-ok" : status === "flagged" ? "bg-flag" : status === "drafting" ? "bg-info" : status === "draft" ? "bg-warn" : "bg-stone-300";
  return <span className={cx("size-1.5 shrink-0 rounded-full", c)} aria-hidden />;
}
