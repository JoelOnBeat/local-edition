"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { ConnectorProvider, Store, SyncEvent } from "@/contract";
import { Chip, EmptyState, ProviderBadge, StoreSwatch, cx, providerName } from "@/components/ui";
import { formatDateTime } from "@/components/lib/format";
import { relativeTime } from "./time";

/** Everything that moved between Local Edition and a connected tool, newest first, filterable by tool. */

const PAGE = 25;

export function SyncLog({ events, stores, live }: { events: SyncEvent[]; stores: Store[]; live: boolean }) {
  const [filter, setFilter] = useState<ConnectorProvider | "all">("all");
  const [shown, setShown] = useState(PAGE);
  const sorted = useMemo(() => [...events].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)), [events]);
  const providers = useMemo(() => [...new Set(sorted.map((e) => e.provider))], [sorted]);
  const rows = filter === "all" ? sorted : sorted.filter((e) => e.provider === filter);
  const storeOf = (id: string | null) => (id ? stores.find((s) => s.id === id) : undefined);
  const failed = sorted.filter((e) => !e.ok).length;

  return (
    <section aria-labelledby="sync-log" className="grid gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="grid gap-1">
          <h2 id="sync-log" className="font-display text-[22px] font-bold tracking-tight">Sync log</h2>
          <p className="text-[13.5px] text-muted">
            {live ? <span className="mr-1.5 inline-block h-2 w-2 animate-pulse rounded-full bg-ok align-middle" aria-hidden /> : null}
            {live ? "Live. " : ""}In means a tool told us something; out means we sent something.
            {failed ? ` ${failed} failed.` : ""}
          </p>
        </div>
        {providers.length > 1 ? (
          <div role="group" aria-label="Filter by tool" className="flex flex-wrap gap-1.5">
            {(["all", ...providers] as const).map((p) => (
              <button
                key={p}
                type="button"
                aria-pressed={filter === p}
                onClick={() => { setFilter(p); setShown(PAGE); }}
                className={cx(
                  "h-8 rounded-full border px-3 text-[13px]",
                  filter === p ? "border-ink bg-ink text-paper" : "border-rule text-ink-2 hover:border-ink-2",
                )}
              >
                {p === "all" ? "All tools" : providerName(p)}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="Nothing has synced yet"
          body="Connect Square to import the menu. Every import, published special, staff card and store reply will be listed here."
        />
      ) : (
        <ol className="divide-y divide-rule overflow-hidden rounded-[var(--radius)] border border-rule bg-paper">
          {rows.slice(0, shown).map((e) => {
            const store = storeOf(e.storeId);
            return (
              <li key={e.id} className="grid grid-cols-[28px_minmax(0,1fr)] gap-x-3 gap-y-1 px-4 py-3 sm:grid-cols-[28px_120px_minmax(0,1fr)_auto] sm:items-center">
                <span
                  aria-label={e.direction === "in" ? "In" : "Out"}
                  title={e.direction === "in" ? "Into Local Edition" : "Out to the tool"}
                  className={cx(
                    "row-span-2 grid h-7 w-7 place-items-center rounded-full font-mono text-[14px] sm:row-span-1",
                    e.direction === "in" ? "bg-[color-mix(in_oklab,var(--info)_14%,transparent)] text-info" : "bg-[color-mix(in_oklab,var(--accent)_12%,transparent)] text-accent",
                  )}
                >
                  {e.direction === "in" ? "↓" : "↑"}
                </span>
                <ProviderBadge provider={e.provider} className="sm:order-none" />
                <div className="col-start-2 min-w-0 sm:col-start-auto">
                  <p className={cx("text-[14px] leading-snug", e.ok ? "text-ink" : "text-flag")}>{e.summary}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11.5px] text-muted">
                    <span>{e.kind}</span>
                    {store ? (
                      <span className="inline-flex items-center gap-1">
                        <StoreSwatch colorIndex={store.colorIndex} />
                        {e.editionId ? (
                          <Link href={`/app/stores/${store.id}`} className="underline-offset-2 hover:underline">{store.name}</Link>
                        ) : store.name}
                      </span>
                    ) : null}
                  </p>
                </div>
                <div className="col-start-2 flex items-center gap-2 sm:col-start-auto sm:justify-end">
                  {e.ok ? null : <Chip tone="flag" dot>Failed</Chip>}
                  <time dateTime={e.at} title={formatDateTime(e.at)} className="whitespace-nowrap font-mono text-[12px] text-muted">
                    {relativeTime(e.at)}
                  </time>
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {rows.length > shown ? (
        <button type="button" onClick={() => setShown((n) => n + PAGE)} className="justify-self-start text-[13.5px] font-semibold text-ink underline underline-offset-4">
          Show {Math.min(PAGE, rows.length - shown)} older
        </button>
      ) : null}
    </section>
  );
}
