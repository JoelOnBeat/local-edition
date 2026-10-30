"use client";

import Link from "next/link";
import type { Edition, Store } from "@/contract";
import { Chip, StatusChip, StoreSwatch, TD, TH, THead, TR, Table, cx } from "../ui";
import { STATUS_ORDER, countApproved, type StoreWeekStatus } from "./status-meta";

/** One row per store: where its edition stands this week, how much is approved, and what the reviewer said. */
export function StatusTable({ stores, editionFor, hot, onHot, onOpen }: {
  stores: Store[];
  editionFor: (storeId: string) => Edition | undefined;
  hot: string | null;
  onHot: (id: string | null) => void;
  onOpen: (id: string) => void;
}) {
  const statusOf = (id: string): StoreWeekStatus => editionFor(id)?.status ?? "none";
  const rows = [...stores].sort((a, b) => STATUS_ORDER[statusOf(a.id)] - STATUS_ORDER[statusOf(b.id)] || a.colorIndex - b.colorIndex);
  return (
    <Table>
      <THead>
        <tr>
          <TH>Store</TH>
          <TH className="text-right sm:text-left">Status</TH>
          <TH className="hidden sm:table-cell">Approved</TH>
          <TH className="hidden md:table-cell">Reviewer</TH>
        </tr>
      </THead>
      <tbody>
        {rows.map((s) => {
          const e = editionFor(s.id);
          return (
            <TR
              key={s.id}
              data-testid={`store-row-${s.id}`}
              data-status={e?.status ?? "none"}
              interactive
              onMouseEnter={() => onHot(s.id)}
              onMouseLeave={() => onHot(null)}
              onClick={() => onOpen(s.id)}
              className={cx(hot === s.id && "bg-paper-2")}
            >
              <TD className="max-w-[220px]">
                <Link href={`/app/stores/${s.id}`} className="block min-w-0 font-medium text-ink" onClick={(ev) => ev.stopPropagation()}>
                  <StoreSwatch colorIndex={s.colorIndex} name={s.name} />
                </Link>
                <p className="mt-0.5 truncate pl-5 text-[12px] text-muted">{s.addressLabel}</p>
              </TD>
              <TD className="text-right sm:text-left">{e ? <StatusChip status={e.status} /> : <Chip>No edition</Chip>}</TD>
              <TD className="hidden sm:table-cell">{e ? <ItemsMeter edition={e} /> : <span className="text-muted">—</span>}</TD>
              <TD className="hidden md:table-cell">
                {e?.review ? (
                  e.review.verdict === "approve" ? (
                    <span className="text-[13px] text-ink-2">Clears</span>
                  ) : (
                    <span className="text-[13px] font-medium text-warn">Needs a change</span>
                  )
                ) : (
                  <span className="text-[13px] text-muted">Not reviewed</span>
                )}
              </TD>
            </TR>
          );
        })}
      </tbody>
    </Table>
  );
}

function ItemsMeter({ edition }: { edition: Edition }) {
  const n = countApproved(edition);
  return (
    <span className="inline-flex items-center gap-2" title={`${n} of ${edition.items.length} items approved`}>
      <span className="hidden gap-[3px] sm:inline-flex" aria-hidden>
        {edition.items.map((i) => (
          <span
            key={i.id}
            className="h-2.5 w-1.5 rounded-[1px]"
            style={{
              background: i.status === "approved" || i.status === "edited" ? "var(--ok)" : i.status === "flagged" ? "var(--flag)" : "var(--rule)",
            }}
          />
        ))}
      </span>
      <span className="font-mono text-[12.5px] text-ink-2">{n}/{edition.items.length}</span>
    </span>
  );
}
