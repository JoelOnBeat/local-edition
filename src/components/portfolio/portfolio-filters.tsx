"use client";

import type { Edition, Store } from "@/contract";
import { cx } from "../ui";
import { Icon } from "../app-ui/icons";

export type Filter = "all" | "draft" | "flagged" | "approved";

const FILTERS: { id: Filter; label: string; dot?: string }[] = [
  { id: "all", label: "All" },
  { id: "draft", label: "Draft", dot: "bg-warn" },
  { id: "flagged", label: "Flagged", dot: "bg-flag" },
  { id: "approved", label: "Approved", dot: "bg-ok" },
];

export function matches(filter: Filter, e: Edition | undefined): boolean {
  if (filter === "all") return true;
  if (!e) return false;
  if (filter === "draft") return e.status === "draft" || e.status === "drafting";
  return e.status === filter;
}

/** Status counts that double as filters (a segmented control), and a search over the stores. */
export function PortfolioFilters({ stores, editionFor, filter, onFilter, query, onQuery }: {
  stores: Store[];
  editionFor: (id: string) => Edition | undefined;
  filter: Filter;
  onFilter: (f: Filter) => void;
  query: string;
  onQuery: (q: string) => void;
}) {
  const count = (f: Filter) => stores.filter((s) => matches(f, editionFor(s.id))).length;
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div role="tablist" aria-label="Filter stores by status" className="flex h-10 max-w-full items-center gap-0.5 overflow-x-auto rounded-full bg-neutral-200/50 p-1 no-scrollbar">
        {FILTERS.map((f) => {
          const on = filter === f.id;
          const n = count(f.id);
          return (
            <button
              key={f.id}
              type="button"
              role="tab"
              aria-selected={on}
              data-testid={f.id === "all" ? "count-all" : `count-${f.id}`}
              data-value={n}
              onClick={() => onFilter(f.id)}
              className={cx(
                "flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-[14px] font-medium transition-[background-color,color,box-shadow] duration-200 ease-quint",
                on ? "bg-white text-[#151515] shadow-[0_0_0_1px_rgb(0_0_0/.12),0_1px_2px_rgb(0_0_0/.06)]" : "text-[#797979] hover:text-ink",
              )}
            >
              {f.dot ? <span className={cx("size-1.5 rounded-full", f.dot)} aria-hidden /> : null}
              {f.label}
              <span className={cx("tnum", on ? "text-ink-2" : "text-faint")}>{n}</span>
            </button>
          );
        })}
      </div>
      <label className="relative flex h-10 w-full items-center sm:w-72">
        <Icon name="search" size={16} className="pointer-events-none absolute left-3 text-faint" />
        <span className="sr-only">Search stores</span>
        <input
          data-testid="store-search"
          type="search"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="Search stores, streets or specials"
          className="h-10 w-full rounded-lg bg-white pl-9 pr-3 text-[14px] text-ink outline-none shadow-[inset_0_0_0_1px_#E5E5E5] transition-shadow duration-150 placeholder:text-muted hover:shadow-[inset_0_0_0_1px_var(--rule-strong)] focus:shadow-[inset_0_0_0_1px_var(--rule-strong)] [&::-webkit-search-cancel-button]:hidden"
        />
        {query ? (
          <button type="button" onClick={() => onQuery("")} aria-label="Clear search" className="absolute right-2 flex size-6 items-center justify-center rounded-md text-faint hover:bg-hover-tint hover:text-ink">
            <Icon name="x" size={14} />
          </button>
        ) : null}
      </label>
    </div>
  );
}
