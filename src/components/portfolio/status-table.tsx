"use client";

import Link from "next/link";
import type { Edition, Store } from "@/contract";
import { StatusChip, StoreTile } from "../ui";
import { Cell, DataRow, DataTable } from "../app-ui/data-table";
import { IconTag, ItemPills, Dash } from "../app-ui/status";
import { relativeTime } from "../connections/time";
import { STATUS_ORDER, countApproved, type StoreWeekStatus } from "./status-meta";

/**
 * Columns drop by breakpoint: phones keep store, status and items. The special has its own column while the table is full
 * width (md to xl) and sits under the store name otherwise (phones, and xl where the table shares the row with the map).
 */
const GRID =
  "grid-cols-[minmax(0,1fr)_96px_44px] sm:grid-cols-[minmax(0,1fr)_100px_72px] md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)_100px_72px] " +
  "lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_100px_72px_112px_80px] xl:grid-cols-[minmax(0,1fr)_100px_60px_116px_84px]";

/** The most recent thing that happened to an edition: built, reviewed, or its source changed in Square. */
export function lastChange(e: Edition): string {
  return [e.createdAt, e.review?.at, e.sourceChange?.at].filter((x): x is string => !!x).sort().at(-1)!;
}

const specialOf = (e: Edition | undefined) => {
  const s = e?.items.find((i) => i.kind === "special");
  return s && s.kind === "special" ? s.name : null;
};

/** One row per store: this week's special, where the edition stands, items approved, the reviewer's verdict, last change. */
export function StatusTable({ stores, editionFor, hot, onHot, onOpen, loading }: {
  stores: Store[];
  editionFor: (storeId: string) => Edition | undefined;
  hot: string | null;
  onHot: (id: string | null) => void;
  onOpen: (id: string) => void;
  loading?: boolean;
}) {
  const statusOf = (id: string): StoreWeekStatus => editionFor(id)?.status ?? "none";
  const rows = [...stores].sort((a, b) => STATUS_ORDER[statusOf(a.id)] - STATUS_ORDER[statusOf(b.id)] || a.colorIndex - b.colorIndex);
  const built = stores.filter((s) => editionFor(s.id)).length;
  const approved = stores.filter((s) => editionFor(s.id)?.status === "approved").length;

  return (
    <DataTable
      label="This week's editions"
      testId="status-table"
      grid={GRID}
      head={[
        { label: <>Store<span className="hidden xl:inline"> · special</span></> },
        { label: "This week's special", className: "hidden md:block xl:hidden" },
        { label: "Status" },
        { label: <><span className="sm:hidden xl:inline">Items</span><span className="hidden sm:inline xl:hidden">Approved</span></>, className: "text-right sm:text-left" },
        { label: "Reviewer", className: "hidden lg:block" },
        { label: "Last change", className: "hidden text-right lg:block" },
      ]}
      footer={
        <>
          <span>Showing {stores.length} {stores.length === 1 ? "store" : "stores"}</span>
          <span className="tnum">{built ? `${approved} of ${built} editions approved` : "No editions built"}</span>
        </>
      }
    >
      {rows.map((s) => {
        const e = editionFor(s.id);
        const special = specialOf(e);
        const n = e ? countApproved(e) : 0;
        return (
          <DataRow
            key={s.id}
            grid={GRID}
            data-testid={`store-row-${s.id}`}
            data-status={e?.status ?? "none"}
            onMouseEnter={() => onHot(s.id)}
            onMouseLeave={() => onHot(null)}
            onClick={() => onOpen(s.id)}
            selected={hot === s.id}
          >
            <Cell className="flex items-center gap-3">
              <StoreTile colorIndex={s.colorIndex} name={s.name} size="md" />
              <span className="min-w-0">
                <Link href={`/app/stores/${s.id}`} onClick={(ev) => ev.stopPropagation()} className="block truncate rounded-sm text-ink-strong">
                  {s.name}
                </Link>
                <span className="block truncate text-[13px] font-normal text-muted md:hidden xl:block" title={special ?? undefined}>{special ?? s.addressLabel}</span>
                <span className="hidden truncate text-[13px] font-normal text-muted md:block xl:hidden">{s.addressLabel}</span>
              </span>
            </Cell>
            <Cell className="hidden truncate md:block xl:hidden" title={special ?? undefined}>
              {loading ? <span className="le-skeleton block h-2.5 w-32 rounded-full" /> : special ?? <Dash />}
            </Cell>
            <Cell>{e ? <StatusChip status={e.status} /> : <span className="inline-flex h-6 items-center rounded-md bg-white px-2 text-[12px] font-medium text-muted shadow-ring-xs">No edition</span>}</Cell>
            <Cell className="flex items-center justify-end gap-2 sm:justify-start" title={e ? `${n} of ${e.items.length} items approved` : undefined}>
              {e ? (
                <>
                  <ItemPills statuses={e.items.map((i) => i.status)} className="hidden sm:inline-flex" />
                  <span className="tnum text-ink-2">{n}/{e.items.length}</span>
                </>
              ) : <Dash />}
            </Cell>
            <Cell className="hidden lg:block">
              {e?.review ? (
                e.review.verdict === "approve" ? <IconTag tone="ok" icon="check">Clears</IconTag> : <IconTag tone="warn" icon="pencil">Wants a change</IconTag>
              ) : (
                <span className="text-[13px] font-normal text-muted">Not reviewed</span>
              )}
            </Cell>
            <Cell className="hidden text-right text-[13px] font-normal text-ink-2 tnum lg:block">
              {e ? <time dateTime={lastChange(e)} title={new Date(lastChange(e)).toLocaleString("en-GB", { timeZone: "America/New_York" })}>{relativeTime(lastChange(e))}</time> : <Dash />}
            </Cell>
          </DataRow>
        );
      })}
    </DataTable>
  );
}
