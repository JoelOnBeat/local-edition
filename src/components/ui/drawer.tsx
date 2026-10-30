"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cx } from "./cx";

/**
 * Right sheet (ByDefault geometry): inset 8px from the edges, 16px radius, slides in over a 40% backdrop. Full width minus
 * 16px on phones. Escape and the backdrop close it; focus moves in on open and returns to the opener on close.
 */
export function Drawer({ open, onClose, title, kicker, children, footer, width = 560 }: {
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
      <div className="le-fade absolute inset-0 bg-black/40" onClick={onClose} aria-hidden />
      <div
        ref={panel}
        role="dialog"
        data-testid="drawer"
        aria-modal="true"
        tabIndex={-1}
        className={cx(
          "le-slide absolute top-2 right-2 bottom-2 flex w-[calc(100vw-1rem)] flex-col rounded-2xl bg-[#FAFAFA] text-ink shadow-ring-lg outline-none",
          "sm:w-[var(--drawer-w)]",
        )}
        style={{ ["--drawer-w" as string]: `min(${width}px, 88vw)` }}
      >
        <div className="mx-5 flex items-center gap-3 border-b border-rule pb-4 pt-5">
          <div className="min-w-0 flex-1">
            {kicker ? <p className="text-[13px] font-medium leading-5 text-muted">{kicker}</p> : null}
            <h2 className="truncate text-[19px] font-medium leading-7 tracking-[-0.02em] text-ink">{title}</h2>
          </div>
          <button type="button" data-testid="drawer-close" onClick={onClose} className="-mr-1.5 flex size-9 shrink-0 items-center justify-center rounded-md text-ink-2 transition-colors hover:bg-stone-100 hover:text-ink active:scale-[.96]" aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer ? <div className="mx-5 border-t border-rule py-3.5">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}
