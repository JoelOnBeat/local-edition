"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cx } from "./cx";

/**
 * Side drawer on wide screens, bottom sheet on phones. Escape and the backdrop close it; focus moves into it on open
 * and returns to the opener on close.
 */
export function Drawer({ open, onClose, title, kicker, children, footer, width = 480 }: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  kicker?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
      opener?.focus?.();
    };
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-[color-mix(in_oklab,var(--ink)_35%,transparent)]" onClick={onClose} aria-hidden />
      <div
        ref={panel}
        role="dialog"
        data-testid="drawer"
        aria-modal="true"
        tabIndex={-1}
        className={cx(
          "le-slide absolute flex flex-col bg-paper text-ink shadow-[var(--shadow)] outline-none",
          "inset-x-0 bottom-0 max-h-[88dvh] rounded-t-[12px] border-t border-rule",
          "sm:inset-y-0 sm:right-0 sm:left-auto sm:max-h-none sm:w-[var(--drawer-w)] sm:rounded-none sm:border-t-0 sm:border-l",
        )}
        style={{ ["--drawer-w" as string]: `min(${width}px, 92vw)` }}
      >
        <div className="flex items-start justify-between gap-4 border-b border-rule px-5 pb-3 pt-4">
          <div className="min-w-0">
            {kicker ? <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">{kicker}</p> : null}
            <h2 className="mt-0.5 font-display text-xl font-semibold leading-tight tracking-tight">{title}</h2>
          </div>
          <button type="button" data-testid="drawer-close" onClick={onClose} className="-mr-2 rounded-[var(--radius)] p-2 text-muted hover:bg-paper-2 hover:text-ink" aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden><path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer ? <div className="border-t border-rule px-5 py-3">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}
