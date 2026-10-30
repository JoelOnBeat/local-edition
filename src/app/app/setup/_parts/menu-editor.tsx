"use client";

import { useState } from "react";
import { MenuCategory, MenuItem } from "@/contract";
import { Button, Chip, EmptyState, Notice, cx } from "@/components/ui";
import { newId } from "@/lib/ids";

/** Every menu item, editable in place: name, category, price, description. Square items say so; unreadable photo prices show amber. */

const CATEGORIES = MenuCategory.options;
const SOURCE: Record<MenuItem["source"], string> = { square: "Square", vl: "Photo", manual: "Typed" };
const input = "h-9 w-full min-w-0 rounded-[var(--radius)] border border-rule bg-paper px-2.5 text-[14px] text-ink placeholder:text-muted focus:border-ink-2";

export function rowProblem(m: MenuItem): string | null {
  const r = MenuItem.safeParse(m);
  if (r.success) return null;
  const path = r.error.issues[0]?.path[0];
  if (path === "name") return m.name.trim() ? "Name is too long (80 characters at most)." : "Give the item a name.";
  if (path === "price") return "Price must be zero or more.";
  if (path === "description") return "Description is too long (240 characters at most).";
  return "Check this row.";
}

export function MenuEditor({ items, onChange, onSave, saving, savedAt }: {
  items: MenuItem[];
  onChange: (items: MenuItem[]) => void;
  onSave: () => void;
  saving: boolean;
  savedAt: string | null;
}) {
  const [showAll, setShowAll] = useState(false);
  const set = (id: string, patch: Partial<MenuItem>) => onChange(items.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  const remove = (id: string) => onChange(items.filter((m) => m.id !== id));
  const add = () =>
    onChange([...items, { id: newId("menu"), name: "", category: "coffee", price: null, currency: "USD", description: null, source: "manual" }]);
  const problems = items.map(rowProblem).filter(Boolean).length;
  const unreadable = items.filter((m) => m.priceLegible === false || m.seen === false).length;
  const visible = showAll ? items : items.slice(0, 12);

  if (items.length === 0) {
    return (
      <EmptyState
        title="No menu yet"
        body="Connect Square to bring the menu in, read a photo of your menu board, or add items by hand."
        action={<Button size="sm" onClick={add}>Add an item</Button>}
      />
    );
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13.5px] text-muted">
          {items.length} items. Every field is editable; the edition adapts one of these each week.
        </p>
        {unreadable ? <Chip tone="warn" dot>{unreadable} {unreadable === 1 ? "price" : "prices"} to check</Chip> : null}
      </div>

      <div className="hidden grid-cols-[minmax(0,1.3fr)_120px_96px_minmax(0,2fr)_72px_36px] gap-2 px-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted lg:grid">
        <span>Item</span><span>Category</span><span>Price</span><span>Description</span><span>From</span><span className="sr-only">Remove</span>
      </div>
      <ul className="grid gap-2">
        {visible.map((m) => {
          const problem = rowProblem(m);
          const amber = m.priceLegible === false || m.seen === false;
          return (
            <li key={m.id} className={cx("grid gap-2 rounded-[var(--radius)] border p-2.5 lg:grid-cols-[minmax(0,1.3fr)_120px_96px_minmax(0,2fr)_72px_36px] lg:items-center lg:border-transparent lg:p-1", problem ? "border-flag" : "border-rule")}>
              <label className="grid gap-1">
                <span className="text-[11px] text-muted lg:sr-only">Item</span>
                <input className={input} value={m.name} maxLength={80} onChange={(e) => set(m.id, { name: e.target.value })} placeholder="Cortado" aria-invalid={!m.name.trim()} />
              </label>
              <div className="grid grid-cols-2 gap-2 lg:contents">
                <label className="grid gap-1">
                  <span className="text-[11px] text-muted lg:sr-only">Category</span>
                  <select className={input} value={m.category} onChange={(e) => set(m.id, { category: e.target.value as MenuItem["category"] })}>
                    {CATEGORIES.map((c) => <option key={c} value={c}>{c[0].toUpperCase() + c.slice(1)}</option>)}
                  </select>
                </label>
                <label className="grid gap-1">
                  <span className="text-[11px] text-muted lg:sr-only">Price (USD)</span>
                  <input
                    key={`${m.id}:${m.price}`}
                    className={cx(input, "font-mono", amber && "border-warn bg-[color-mix(in_oklab,var(--warn)_10%,var(--paper))]")}
                    inputMode="decimal" defaultValue={m.price === null ? "" : m.price.toFixed(2)} placeholder={amber ? "Check" : "4.75"}
                    title={amber ? "The photo was hard to read here. Check this price." : undefined}
                    onBlur={(e) => {
                      const v = e.target.value.trim().replace(/^\$/, "");
                      const n = Number(v);
                      if (v === "") set(m.id, { price: null });
                      else if (Number.isFinite(n) && n >= 0) set(m.id, { price: Math.round(n * 100) / 100, priceLegible: true, seen: true });
                      else e.target.value = m.price === null ? "" : m.price.toFixed(2);
                    }}
                  />
                </label>
              </div>
              <label className="grid gap-1">
                <span className="text-[11px] text-muted lg:sr-only">Description</span>
                <input className={input} value={m.description ?? ""} maxLength={240} placeholder="What a regular would say about it"
                  onChange={(e) => set(m.id, { description: e.target.value || null })} />
              </label>
              <div className="flex items-center justify-between gap-2 lg:contents">
                <Chip tone={m.source === "square" ? "info" : "neutral"} mono>{SOURCE[m.source]}</Chip>
                <button type="button" onClick={() => remove(m.id)} aria-label={`Remove ${m.name || "this item"}`}
                  className="grid h-9 w-9 place-items-center rounded-[var(--radius)] text-muted hover:bg-paper-2 hover:text-flag">×</button>
              </div>
              {problem ? <p className="text-[12.5px] text-flag lg:col-span-6">{problem}</p> : null}
            </li>
          );
        })}
      </ul>
      {items.length > 12 ? (
        <button type="button" onClick={() => setShowAll((s) => !s)} className="justify-self-start text-[13.5px] font-semibold underline underline-offset-4">
          {showAll ? "Show fewer" : `Show all ${items.length} items`}
        </button>
      ) : null}

      <div className="flex flex-wrap items-center gap-3 border-t border-rule pt-3">
        <Button size="sm" onClick={add}>Add an item</Button>
        <Button size="sm" variant="primary" onClick={onSave} loading={saving} disabled={problems > 0}>Save menu</Button>
        {problems ? <span className="text-[13px] text-flag">{problems} {problems === 1 ? "row needs" : "rows need"} a fix before saving.</span> : null}
        {savedAt && !problems ? <span className="text-[13px] text-ok">Saved {savedAt}.</span> : null}
      </div>
      {items.some((m) => m.source === "square") ? (
        <Notice tone="info">Edits here change the edition&apos;s copy of the menu. Square stays the source: a change made in Square syncs back in.</Notice>
      ) : null}
    </div>
  );
}
