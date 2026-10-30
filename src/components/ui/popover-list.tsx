"use client";

import { useEffect, useLayoutEffect, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { cx } from "./cx";

export interface ListOption {
  value: string;
  label: ReactNode;
  /** Plain text for typeahead and filtering (defaults to the label when it is a string). */
  text?: string;
  icon?: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
}

export const optionText = (o: ListOption): string => o.text ?? (typeof o.label === "string" ? o.label : o.value);

/** Fixed-position coordinates under (or above, when there is no room) an anchor, kept in sync on scroll and resize. */
export function useAnchorRect(anchor: RefObject<HTMLElement | null>, open: boolean, maxHeight = 296) {
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number; width: number; up: boolean } | null>(null);
  useLayoutEffect(() => {
    if (!open) return;
    const measure = () => {
      const el = anchor.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const below = window.innerHeight - r.bottom;
      const up = below < Math.min(maxHeight, 220) && r.top > below;
      setPos(up ? { left: r.left, bottom: window.innerHeight - r.top + 6, width: r.width, up } : { left: r.left, top: r.bottom + 6, width: r.width, up });
    };
    const raf = requestAnimationFrame(measure);
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
    };
  }, [open, anchor, maxHeight]);
  return pos;
}

/**
 * The popup list shared by Select and Combobox: white, 10px radius, ring-lg, rows h-8 with a check on the chosen one.
 * Rendered in a portal so cards with overflow-hidden never clip it.
 */
export function PopoverList({
  id, open, anchor, options, value, active, onPick, onHover, empty = "No matches", listRef,
}: {
  id: string;
  open: boolean;
  anchor: RefObject<HTMLElement | null>;
  options: ListOption[];
  value: string | undefined;
  active: number;
  onPick: (o: ListOption) => void;
  onHover: (i: number) => void;
  empty?: ReactNode;
  listRef?: RefObject<HTMLUListElement | null>;
}) {
  const pos = useAnchorRect(anchor, open);
  useEffect(() => {
    if (!open || active < 0) return;
    document.getElementById(`${id}-opt-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [open, active, id]);
  if (!open || !pos || typeof document === "undefined") return null;
  return createPortal(
    <ul
      ref={listRef}
      id={id}
      role="listbox"
      tabIndex={-1}
      className={cx(
        "le-pop fixed z-[60] max-h-[296px] overflow-y-auto rounded-[10px] bg-white p-1 text-[14px] shadow-ring-lg outline-none",
        pos.up ? "origin-bottom" : "origin-top",
      )}
      style={{ left: Math.min(pos.left, window.innerWidth - Math.max(pos.width, 180) - 8), top: pos.top, bottom: pos.bottom, minWidth: Math.max(pos.width, 180), maxWidth: "calc(100vw - 16px)" }}
      onMouseDown={(e) => e.preventDefault()}
    >
      {options.length === 0 ? <li className="px-2 py-2 text-muted">{empty}</li> : null}
      {options.map((o, i) => {
        const selected = o.value === value;
        return (
          <li
            key={o.value}
            id={`${id}-opt-${i}`}
            role="option"
            aria-selected={selected}
            aria-disabled={o.disabled || undefined}
            onMouseEnter={() => onHover(i)}
            onClick={() => { if (!o.disabled) onPick(o); }}
            className={cx(
              "flex min-h-8 cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-ink-strong",
              i === active && "bg-stone-100",
              o.disabled && "cursor-not-allowed opacity-50",
            )}
          >
            {o.icon ? <span className="flex shrink-0 items-center">{o.icon}</span> : null}
            <span className="min-w-0 flex-1">
              <span className="block truncate">{o.label}</span>
              {o.description ? <span className="block truncate text-[13px] text-ink-2">{o.description}</span> : null}
            </span>
            <svg className={cx("size-4 shrink-0 text-ink", selected ? "opacity-100" : "opacity-0")} viewBox="0 0 16 16" fill="none" aria-hidden>
              <path d="M3.5 8.5 6.5 11.5 12.5 4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </li>
        );
      })}
    </ul>,
    document.body,
  );
}
