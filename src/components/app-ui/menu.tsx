"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { cx } from "@/components/ui";

/**
 * A small dropdown: a trigger and a panel that scales in (.95 → 1, 150ms quint). Outside click and Escape close it and
 * focus returns to the trigger. The panel stays mounted so test ids inside it exist; closed it is hidden from everyone.
 */
export function Dropdown({ trigger, children, align = "start", side = "bottom", width = "w-80", label, className, panelClassName, triggerClassName, testId }: {
  trigger: (open: boolean) => ReactNode;
  children: (close: () => void) => ReactNode;
  align?: "start" | "end";
  /** "top" opens upward (sidebar identity block). */
  side?: "top" | "bottom";
  width?: string;
  label: string;
  className?: string;
  panelClassName?: string;
  triggerClassName?: string;
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        btn.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={root} className={cx("relative", className)}>
      <button
        ref={btn}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        data-testid={testId}
        onClick={() => setOpen((o) => !o)}
        className={triggerClassName}
      >
        {trigger(open)}
      </button>
      <div
        role="menu"
        aria-label={label}
        hidden={!open}
        className={cx(
          "le-pop absolute z-50 max-w-[calc(100vw-16px)] rounded-2xl bg-white p-1.5 shadow-ring-lg",
          side === "top" ? "bottom-[calc(100%+8px)]" : "top-[calc(100%+8px)]",
          align === "end" ? (side === "top" ? "right-0 origin-bottom-right" : "right-0 origin-top-right") : side === "top" ? "left-0 origin-bottom-left" : "left-0 origin-top-left",
          width,
          panelClassName,
        )}
      >
        {open ? children(() => setOpen(false)) : null}
      </div>
    </div>
  );
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <p className="px-2.5 pb-1 pt-1.5 text-[12px] font-medium leading-4 text-ink-2">{children}</p>;
}

export function MenuDivider() {
  return <div className="mx-1 my-1.5 h-px bg-rule-subtle" aria-hidden />;
}

const itemCls = "flex w-full items-center gap-3 rounded-[10px] px-2.5 py-2 text-left text-[14px] font-medium text-ink-strong transition-colors duration-150 hover:bg-hover-tint focus-visible:bg-hover-tint focus-visible:outline-none";

export function MenuItem({ href, onClick, children, active, className, testId, danger }: { href?: string; onClick?: () => void; children: ReactNode; active?: boolean; className?: string; testId?: string; danger?: boolean }) {
  const cls = cx(itemCls, active && "bg-active-tint", danger && "text-flag hover:bg-flag-bg", className);
  if (href) return <Link role="menuitem" href={href} onClick={onClick} className={cls} data-testid={testId}>{children}</Link>;
  return <button role="menuitem" type="button" onClick={onClick} className={cls} data-testid={testId}>{children}</button>;
}
