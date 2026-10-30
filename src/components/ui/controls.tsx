"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { cx } from "./cx";

interface ToggleProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  id?: string;
  className?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "data-testid"?: string;
  /** Optional inline label; clicking it toggles too. */
  children?: ReactNode;
}

function Labelled({ control, children, disabled, className }: { control: ReactNode; children?: ReactNode; disabled?: boolean; className?: string }) {
  if (!children) return <>{control}</>;
  return (
    <span className={cx("inline-flex items-start gap-2.5 text-[14px] leading-5 text-ink-2", disabled && "opacity-50", className)}>
      {control}
      {children}
    </span>
  );
}

/** Switch: 36×20 stone track, flame when on, white thumb with a small stretch on press. role="switch". */
export function Switch({ checked, onCheckedChange, disabled, id, className, children, ...aria }: ToggleProps) {
  const control = (
    <button
      type="button" role="switch" id={id} aria-checked={checked} disabled={disabled}
      aria-label={aria["aria-label"]} aria-labelledby={aria["aria-labelledby"]} data-testid={aria["data-testid"]}
      onClick={() => onCheckedChange(!checked)}
      className={cx(
        "group/sw relative inline-flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors duration-200 ease-quint",
        "focus-visible:shadow-[0_0_0_2px_var(--paper),0_0_0_4px_var(--accent)] focus-visible:outline-none disabled:cursor-not-allowed",
        checked ? "bg-accent" : "bg-stone-200 hover:bg-stone-300",
        !children && className,
      )}
    >
      <span
        className={cx(
          "block h-4 w-4 rounded-full bg-white shadow-ring-sm transition-[translate,width] duration-200 ease-quint group-active/sw:w-5",
          checked ? "translate-x-4 group-active/sw:translate-x-3" : "translate-x-0",
        )}
      />
    </button>
  );
  return (
    <Labelled control={control} disabled={disabled} className={className}>
      {children ? <span className="cursor-pointer select-none" onClick={() => !disabled && onCheckedChange(!checked)}>{children}</span> : null}
    </Labelled>
  );
}

/** Checkbox: 16px, 4px radius, inset ring; flame fill with a white check when on. role="checkbox" (Playwright .check() works). */
export function Checkbox({ checked, onCheckedChange, disabled, id, className, children, ...aria }: ToggleProps) {
  const control = (
    <button
      type="button" role="checkbox" id={id} aria-checked={checked} disabled={disabled}
      aria-label={aria["aria-label"]} aria-labelledby={aria["aria-labelledby"]} data-testid={aria["data-testid"]}
      onClick={() => onCheckedChange(!checked)}
      className={cx(
        "mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-[4px] transition-[background-color,box-shadow,scale] duration-150 ease-quint active:scale-[.92]",
        "focus-visible:shadow-[0_0_0_2px_var(--paper),0_0_0_4px_var(--accent)] focus-visible:outline-none disabled:cursor-not-allowed",
        checked ? "bg-accent shadow-[inset_0_0_0_1px_var(--accent-hover)]" : "bg-white shadow-[inset_0_0_0_1px_#D4D4D4] hover:shadow-[inset_0_0_0_1px_var(--faint)]",
        !children && className,
      )}
    >
      <svg viewBox="0 0 16 16" fill="none" className={cx("size-3 text-white transition-opacity duration-150", checked ? "opacity-100" : "opacity-0")} aria-hidden>
        <path d="M3.5 8.5 6.5 11.5 12.5 4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
  return (
    <Labelled control={control} disabled={disabled} className={className}>
      {children ? <span className="cursor-pointer select-none" onClick={() => !disabled && onCheckedChange(!checked)}>{children}</span> : null}
    </Labelled>
  );
}

/**
 * Segmented control: a rounded stone track with a sliding white thumb (200ms quint). Use for two to four views
 * (This week / Last week, Phone / Desktop, Square / Menu photo). role="radiogroup", arrow keys move.
 */
export function Segmented<T extends string>({
  options, value, onValueChange, size = "md", className, "aria-label": ariaLabel, "data-testid": testId,
}: {
  options: Array<{ value: T; label: ReactNode; icon?: ReactNode }>;
  value: T;
  onValueChange: (value: T) => void;
  size?: "sm" | "md";
  className?: string;
  "aria-label"?: string;
  "data-testid"?: string;
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const [thumb, setThumb] = useState<{ left: number; width: number } | null>(null);
  const idx = Math.max(0, options.findIndex((o) => o.value === value));
  useLayoutEffect(() => {
    const el = refs.current[idx];
    if (el) setThumb({ left: el.offsetLeft, width: el.offsetWidth });
  }, [idx, options.length]);
  const move = (d: number) => {
    const n = (idx + d + options.length) % options.length;
    onValueChange(options[n]!.value);
    refs.current[n]?.focus();
  };
  return (
    <div
      role="radiogroup" aria-label={ariaLabel} data-testid={testId}
      className={cx("relative inline-flex items-center rounded-full bg-neutral-200/50 p-1", size === "sm" ? "h-8" : "h-10", className)}
    >
      {thumb ? (
        <span
          aria-hidden
          className="absolute inset-y-1 rounded-full bg-white shadow-[0_0_0_1px_rgb(0_0_0/.12),0_1px_2px_rgb(0_0_0/.06)] transition-[left,width] duration-200 ease-quint"
          style={{ left: thumb.left, width: thumb.width }}
        />
      ) : null}
      {options.map((o, i) => {
        const on = o.value === value;
        return (
          <button
            key={o.value} ref={(el) => { refs.current[i] = el; }} type="button" role="radio" aria-checked={on} tabIndex={on ? 0 : -1}
            data-testid={testId ? `${testId}-${o.value}` : undefined}
            onClick={() => onValueChange(o.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); move(1); }
              if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); move(-1); }
            }}
            className={cx(
              "relative z-10 inline-flex h-full items-center gap-1.5 rounded-full font-medium transition-colors duration-200 ease-quint focus-visible:shadow-[0_0_0_2px_var(--accent)] focus-visible:outline-none",
              size === "sm" ? "px-2.5 text-[13px]" : "px-3 text-[14px]",
              on ? "text-[#151515]" : "text-[#797979] hover:text-[#151515]",
              !thumb && on && "bg-white",
            )}
          >
            {o.icon}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
