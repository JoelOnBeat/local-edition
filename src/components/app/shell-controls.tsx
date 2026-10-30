"use client";

import { StoreTile, SampleBadge, Skeleton, cx } from "../ui";
import { Dropdown, MenuDivider, MenuItem, MenuLabel } from "../app-ui/menu";
import { Icon } from "../app-ui/icons";
import { StoreStack } from "../app-ui/tiles";
import { formatDate, previousWeeks } from "../lib/format";
import { useWorkspace } from "./workspace-context";

export const shortChainName = (name: string) => name.replace(/\s*\(sample chain\)\s*$/i, "");

/** Chain pill in the header: stacked store tiles, the chain name, "Sample" for the sample chain. Opens the store list. */
export function WorkspaceSwitcher() {
  const { bundle, loading, editionForStore } = useWorkspace();
  if (loading || !bundle) return <Skeleton className="h-6 w-36 rounded-lg" />;
  const { chain, stores } = bundle;
  const name = shortChainName(chain.name) || "Your chain";
  return (
    <Dropdown
      label="Workspace"
      className="min-w-0 lg:shrink-0"
      width="w-80"
      testId="workspace-switcher"
      triggerClassName="group flex h-9 min-w-0 max-w-full items-center gap-2 rounded-lg px-1.5 transition-[background-color,scale] duration-150 hover:bg-hover-tint active:scale-[.98] sm:px-2"
      trigger={(open) => (
        <>
          <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-stone-900 text-[11px] font-semibold text-stone-50 shadow-[inset_0_1px_0_rgb(255_255_255/.14)]" aria-hidden>{name.slice(0, 1)}</span>
          <span className="min-w-0 truncate text-[14px] font-medium text-ink-strong sm:max-w-[180px]" title={chain.name}>{name}</span>
          {chain.isSample ? <SampleBadge /> : null}
          <Icon name="chevronsUpDown" size={14} className={cx("shrink-0 text-faint transition-colors", open && "text-ink-2")} />
        </>
      )}
    >
      {(close) => (
        <>
          <MenuLabel>Workspace</MenuLabel>
          <div className="flex items-center gap-3 rounded-[10px] px-2.5 py-2">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-[7px] bg-stone-900 text-[11px] font-semibold text-stone-50">{name.slice(0, 1)}</span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2 text-[14px] font-medium text-ink"><span className="truncate">{name}</span>{chain.isSample ? <SampleBadge /> : null}</span>
              <span className="mt-0.5 flex items-center gap-2 text-[13px] text-ink-2">{stores.length ? <StoreStack stores={stores} max={4} size="sm" /> : null}<span className="truncate">{stores.length} {stores.length === 1 ? "store" : "stores"} · {chain.city.name}</span></span>
            </span>
            <Icon name="check" size={14} className="shrink-0 text-ink-2" />
          </div>
          {stores.length ? (
            <>
              <MenuDivider />
              <MenuLabel>Stores</MenuLabel>
              <div className="max-h-[min(360px,50dvh)] overflow-y-auto">
                {stores.map((s) => (
                  <MenuItem key={s.id} href={`/app/stores/${s.id}`} onClick={close} className="py-1.5">
                    <StoreTile colorIndex={s.colorIndex} name={s.name} size="lg" />
                    <span className="min-w-0 flex-1 truncate">{s.name}</span>
                    <StatusDot status={editionForStore(s.id)?.status} />
                  </MenuItem>
                ))}
              </div>
            </>
          ) : null}
          <MenuDivider />
          <MenuItem href="/app/settings" onClick={close}><Icon name="settings" className="text-faint" />Chain settings</MenuItem>
          {chain.isSample ? (
            <p className="px-2.5 pb-1.5 pt-1 text-[12px] leading-4 text-muted">A sample chain: the stores and places are invented for the demo.</p>
          ) : null}
        </>
      )}
    </Dropdown>
  );
}

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
