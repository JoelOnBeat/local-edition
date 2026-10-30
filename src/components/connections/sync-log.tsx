"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { ConnectorProvider, Store, SyncEvent } from "@/contract";
import { Button, CardBand, Chip, EmptyState, StoreTile, cx, providerName } from "@/components/ui";
import { Icon } from "@/components/app-ui/icons";
import { LogoTile } from "@/components/app-ui/tiles";
import { formatDateTime } from "@/components/lib/format";
import { relativeTime } from "./time";

/** Everything that moved between Local Edition and a connected tool, newest first, as a timeline grouped by day. */

const PAGE = 25;
const TZ = "America/New_York";
const dayKey = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: TZ });

function dayLabel(key: string, now = new Date()): string {
  const today = now.toLocaleDateString("en-CA", { timeZone: TZ });
  const y = new Date(now.getTime() - 86_400_000).toLocaleDateString("en-CA", { timeZone: TZ });
  if (key === today) return "Today";
  if (key === y) return "Yesterday";
  return new Date(`${key}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

/** Segmented toggle: a stone track with a white thumb on the chosen item. */
function Filter({ value, options, onChange }: { value: string; options: { id: string; label: string }[]; onChange: (id: string) => void }) {
  return (
    <div role="group" aria-label="Filter by tool" className="inline-flex max-w-full flex-wrap gap-0.5 rounded-[18px] bg-neutral-200/50 p-1">
      {options.map((o) => (
        <button
          key={o.id}
          data-testid={`sync-filter-${o.id}`}
          type="button"
          aria-pressed={value === o.id}
          onClick={() => onChange(o.id)}
          className={cx(
            "h-8 rounded-full px-3 text-[14px] font-medium transition-[background-color,color,box-shadow] duration-200 ease-quint",
            value === o.id ? "bg-white text-[#151515] shadow-[0_0_0_1px_rgb(0_0_0/.12),0_1px_2px_rgb(0_0_0/.06)]" : "text-[#797979] hover:text-ink",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function SyncLog({ events, stores, live }: { events: SyncEvent[]; stores: Store[]; live: boolean }) {
  const [filter, setFilter] = useState<ConnectorProvider | "all">("all");
  const [shown, setShown] = useState(PAGE);
  const sorted = useMemo(() => [...events].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)), [events]);
  const providers = useMemo(() => [...new Set(sorted.map((e) => e.provider))], [sorted]);
  const rows = filter === "all" ? sorted : sorted.filter((e) => e.provider === filter);
  const storeOf = (id: string | null) => (id ? stores.find((s) => s.id === id) : undefined);
  const failed = sorted.filter((e) => !e.ok).length;
  const page = rows.slice(0, shown);
  const groups: { key: string; items: SyncEvent[] }[] = [];
  for (const e of page) {
    const k = dayKey(e.at);
    const g = groups.at(-1);
    if (g && g.key === k) g.items.push(e);
    else groups.push({ key: k, items: [e] });
  }

  return (
    <section aria-labelledby="sync-log" data-testid="sync-log" data-count={sorted.length}>
      <CardBand
        title={<span id="sync-log">Sync log</span>}
        icon={<Icon name="refresh" />}
        flush
        actions={live ? <span className="inline-flex items-center gap-1.5 text-[13px] text-ink-2"><span className="le-live-dot size-1.5 rounded-full bg-ok" aria-hidden />Live</span> : null}
        footer={
          <>
            <span className="tnum">Showing {Math.min(shown, rows.length)} of {rows.length} {rows.length === 1 ? "event" : "events"}{failed ? ` · ${failed} failed` : ""}</span>
            {rows.length > shown ? (
              <Button data-testid="sync-more" size="sm" variant="secondary" onClick={() => setShown((n) => n + PAGE)}>
                Show {Math.min(PAGE, rows.length - shown)} older
              </Button>
            ) : null}
          </>
        }
      >
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rule-row px-4 py-3">
          <p className="text-[13px] leading-5 text-ink-2">
            <Icon name="arrowDown" size={12} className="mr-1 inline align-[-1px] text-faint" />In: a tool told us something
            <span className="mx-2 text-faint">·</span>
            <Icon name="arrowUp" size={12} className="mr-1 inline align-[-1px] text-accent-text" />Out: we sent something
          </p>
          {providers.length > 1 ? (
            <Filter
              value={filter}
              onChange={(id) => { setFilter(id as ConnectorProvider | "all"); setShown(PAGE); }}
              options={[{ id: "all", label: "All tools" }, ...providers.map((p) => ({ id: p, label: providerName(p) }))]}
            />
          ) : null}
        </div>

        {rows.length === 0 ? (
          <EmptyState
            icon={<Icon name="refresh" size={20} />}
            title="Nothing has synced yet"
            body="Connect Square to import the menu. Every import, published special, staff card and store reply will be listed here."
          />
        ) : (
          <div className="px-4 pb-2 pt-1">
            {groups.map((g) => (
              <div key={g.key}>
                <p className="pb-1 pt-3 text-[12px] font-medium leading-4 text-ink-2">{dayLabel(g.key)}</p>
                <ol className="relative before:absolute before:bottom-3 before:left-[11.5px] before:top-3 before:w-px before:bg-rule">
                  {g.items.map((e) => {
                    const store = storeOf(e.storeId);
                    return (
                      <li
                        key={e.id}
                        data-testid="sync-event" data-provider={e.provider} data-direction={e.direction} data-kind={e.kind} data-ok={e.ok}
                        className="relative grid grid-cols-[24px_minmax(0,1fr)] gap-x-3 py-2.5 sm:grid-cols-[24px_minmax(0,1fr)_auto]"
                      >
                        <span
                          aria-label={e.direction === "in" ? "In" : "Out"}
                          title={e.direction === "in" ? "Into Local Edition" : "Out to the tool"}
                          className={cx(
                            "relative z-[1] mt-px flex size-6 items-center justify-center rounded-full",
                            !e.ok ? "bg-flag-bg text-flag shadow-[0_0_0_3px_#fff]" : "bg-white shadow-[0_0_0_3px_#fff,0_0_0_4px_var(--rule)]",
                            e.ok && (e.direction === "in" ? "text-ink-2" : "text-accent-text"),
                          )}
                        >
                          <Icon name={!e.ok ? "x" : e.direction === "in" ? "arrowDown" : "arrowUp"} size={12} strokeWidth={2.4} />
                        </span>
                        <div className="min-w-0">
                          <p className="flex min-w-0 items-start gap-2">
                            <LogoTile provider={e.provider} size="xs" className="mt-px" />
                            <span className={cx("min-w-0 text-[14px] font-medium leading-5 [overflow-wrap:anywhere]", e.ok ? "text-ink-strong" : "text-flag")}>{e.summary}</span>
                          </p>
                          <p className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 pl-[26px] text-[12px] leading-4 text-muted">
                            <span className="font-mono">{e.kind}</span>
                            {store ? (
                              <span className="inline-flex items-center gap-1.5">
                                <StoreTile colorIndex={store.colorIndex} name={store.name} size="sm" />
                                {e.editionId ? (
                                  <Link href={`/app/stores/${store.id}`} className="text-ink-2 underline decoration-stone-300 underline-offset-[3px] hover:text-ink">{store.name}</Link>
                                ) : <span className="text-ink-2">{store.name}</span>}
                              </span>
                            ) : null}
                            <time dateTime={e.at} title={formatDateTime(e.at)} className="tnum sm:hidden">{relativeTime(e.at)}</time>
                          </p>
                        </div>
                        <div className="hidden items-start gap-2 pt-0.5 sm:flex">
                          {e.ok ? null : <Chip tone="flag" dot>Failed</Chip>}
                          <time dateTime={e.at} title={formatDateTime(e.at)} className="whitespace-nowrap pt-0.5 text-[13px] text-muted tnum">{relativeTime(e.at)}</time>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </div>
            ))}
          </div>
        )}
      </CardBand>
    </section>
  );
}
