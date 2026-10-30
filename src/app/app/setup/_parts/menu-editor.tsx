"use client";

import { useState } from "react";
import { MenuCategory, MenuItem } from "@/contract";
import { Button, Chip, EmptyState, Notice, cx } from "@/components/ui";
import { ChoiceSelect } from "@/components/app-ui/form-choice";
import { Icon } from "@/components/app-ui/icons";
import { newId } from "@/lib/ids";

/** Every menu item, editable in place: name, category, price, description. Square items say so; unreadable photo prices show amber. */

const CATEGORIES = MenuCategory.options;
const SOURCE: Record<MenuItem["source"], string> = { square: "Square", vl: "Photo", manual: "Typed" };
const input = "h-9 w-full min-w-0 rounded-lg bg-white px-3 text-[14px] text-ink outline-none placeholder:text-muted shadow-[inset_0_0_0_1px_#E5E5E5] transition-shadow hover:shadow-[inset_0_0_0_1px_var(--rule-strong)] focus:shadow-[inset_0_0_0_1px_var(--rule-strong)] aria-invalid:shadow-[inset_0_0_0_2px_var(--danger-ring)]";

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
        icon={<Icon name="list" size={20} />}
        title="No menu yet"
        body="Connect Square to bring the menu in, read a photo of your menu board, or add items by hand."
        action={<Button data-testid="menu-add" size="sm" onClick={add}>Add an item</Button>}
      />
    );
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[14px] text-ink-2">
          <span className="font-medium text-ink tnum">{items.length}</span> items. Every field is editable; the edition adapts one of these each week.
        </p>
        {unreadable ? <Chip tone="warn" dot>{unreadable} {unreadable === 1 ? "price" : "prices"} to check</Chip> : null}
      </div>

      <div className="hidden grid-cols-[minmax(0,1.3fr)_120px_96px_minmax(0,2fr)_72px_36px] gap-2 px-3 text-[12px] font-medium text-muted lg:grid">
        <span>Item</span><span>Category</span><span>Price</span><span>Description</span><span>From</span><span className="sr-only">Remove</span>
      </div>
      <ul className="grid gap-2 lg:gap-0 lg:overflow-hidden lg:rounded-lg lg:bg-white lg:shadow-ring-xs">
        {visible.map((m) => {
          const problem = rowProblem(m);
          const amber = m.priceLegible === false || m.seen === false;
          return (
            <li key={m.id} data-testid="menu-row" data-id={m.id} data-source={m.source} className={cx("grid gap-2 rounded-lg bg-white p-3 shadow-ring-xs lg:grid-cols-[minmax(0,1.3fr)_120px_96px_minmax(0,2fr)_72px_36px] lg:items-center lg:rounded-none lg:border-b lg:border-rule-row lg:px-3 lg:py-2 lg:shadow-none lg:last:border-0", problem && "bg-flag-bg/40")}>
              <label className="grid gap-1">
                <span className="text-[12px] font-medium text-muted lg:sr-only">Item</span>
                <input data-testid="menu-name" className={input} value={m.name} maxLength={80} onChange={(e) => set(m.id, { name: e.target.value })} placeholder="Cortado" aria-invalid={!m.name.trim()} />
              </label>
              <div className="grid grid-cols-2 gap-2 lg:contents">
                <div className="grid gap-1">
                  <span className="text-[12px] font-medium text-muted lg:sr-only">Category</span>
                  <ChoiceSelect testId="menu-category" label="Category" value={m.category} onChange={(v) => set(m.id, { category: v as MenuItem["category"] })}
                    options={CATEGORIES.map((c) => ({ value: c, label: c[0].toUpperCase() + c.slice(1) }))} className="[&_button]:h-9" />
                </div>
                <label className="grid gap-1">
                  <span className="text-[12px] font-medium text-muted lg:sr-only">Price (USD)</span>
                  <input
                    key={`${m.id}:${m.price}`}
                    data-testid="menu-price"
                    className={cx(input, "tnum", amber && "bg-warn-bg shadow-[inset_0_0_0_1px_var(--warn)]")}
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
                <span className="text-[12px] font-medium text-muted lg:sr-only">Description</span>
                <input data-testid="menu-description" className={input} value={m.description ?? ""} maxLength={240} placeholder="What a regular would say about it"
                  onChange={(e) => set(m.id, { description: e.target.value || null })} />
              </label>
              <div className="flex items-center justify-between gap-2 lg:contents">
                <Chip tone={m.source === "square" ? "info" : "neutral"}>{SOURCE[m.source]}</Chip>
                <button data-testid="menu-remove" type="button" onClick={() => remove(m.id)} aria-label={`Remove ${m.name || "this item"}`}
                  className="grid size-9 place-items-center rounded-md text-faint transition-colors hover:bg-flag-bg hover:text-flag"><Icon name="trash" size={14} /></button>
              </div>
              {problem ? <p data-testid="menu-problem" className="text-[13px] text-flag lg:col-span-6">{problem}</p> : null}
            </li>
          );
        })}
      </ul>
      {items.length > 12 ? (
        <button data-testid="menu-show-all" type="button" onClick={() => setShowAll((s) => !s)} className="inline-flex items-center gap-1 justify-self-start rounded-md px-2 py-1 text-[14px] font-medium text-ink-2 hover:bg-hover-tint hover:text-ink">
          {showAll ? "Show fewer" : `Show all ${items.length} items`}
        </button>
      ) : null}

      <div className="flex flex-wrap items-center gap-3 pt-1">
        <Button data-testid="menu-add" size="sm" onClick={add} icon={<Icon name="plus" size={14} />}>Add an item</Button>
        <Button data-testid="menu-save" size="sm" variant="primary" onClick={onSave} loading={saving} disabled={problems > 0}>Save menu</Button>
        {problems ? <span className="text-[13px] text-flag">{problems} {problems === 1 ? "row needs" : "rows need"} a fix before saving.</span> : null}
        {savedAt && !problems ? <span data-testid="menu-saved" className="text-[13px] font-medium text-ok-ink">Saved {savedAt}.</span> : null}
      </div>
      {items.some((m) => m.source === "square") ? (
        <Notice tone="info">Edits here change the edition&apos;s copy of the menu. Square stays the source: a change made in Square syncs back in.</Notice>
      ) : null}
    </div>
  );
}
