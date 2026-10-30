"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { cx } from "@/components/ui";

/**
 * Segmented toggle (DESIGN-SYSTEM §9): track `rounded-full bg-neutral-200/50 p-1` (40px), items `h-8 px-4 14/500`,
 * inactive #797979, active #151515, and a white thumb (ring black/12%) that slides to the active item in 200ms.
 */
export function Segmented<T extends string>({ value, options, onChange, label, className, testId }: {
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (v: T) => void;
  label: string;
  className?: string;
  testId?: string;
}) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [thumb, setThumb] = useState<{ left: number; width: number } | null>(null);
  useLayoutEffect(() => {
    const el = refs.current[value];
    if (el) setThumb({ left: el.offsetLeft, width: el.offsetWidth });
  }, [value, options.length]);
  return (
    <div role="radiogroup" aria-label={label} data-testid={testId} className={cx("relative inline-flex w-fit gap-0 rounded-full bg-neutral-200/50 p-1", className)}>
      {thumb ? (
        <span
          aria-hidden
          className="absolute top-1 h-8 rounded-full bg-white shadow-[0_0_0_1px_rgb(0_0_0/.12),0_1px_2px_rgb(0_0_0/.06)] transition-[left,width] duration-200 ease-quint"
          style={{ left: thumb.left, width: thumb.width }}
        />
      ) : null}
      {options.map((o) => (
        <button
          key={o.value}
          ref={(el) => { refs.current[o.value] = el; }}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={cx(
            "relative z-[1] inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-full px-4 py-1.5 text-[14px] font-medium transition-colors duration-150",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 focus-visible:ring-offset-2",
            o.value === value ? "text-[#151515]" : "text-[#797979] hover:text-ink-2",
            !thumb && o.value === value && "bg-white",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
