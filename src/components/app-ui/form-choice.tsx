"use client";

import { cx } from "@/components/ui";
import { Icon } from "./icons";
import { Dropdown, MenuItem } from "./menu";

/**
 * A designed select (no OS popup): an input-shaped trigger opening a Dropdown of options. A visually hidden native
 * <select> mirrors the value so forms, screen-reader form modes and test drivers (`selectOption`) keep working.
 */
export function ChoiceSelect<T extends string>({ id, value, options, onChange, label, testId, nativeTestId, className }: {
  id?: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
  /** On the designed trigger; each option gets `${testId}-${value}`. */
  testId?: string;
  /** On the hidden native select. */
  nativeTestId?: string;
  className?: string;
}) {
  const current = options.find((o) => o.value === value);
  return (
    <div className={cx("relative", className)}>
      <select id={id} data-testid={nativeTestId} aria-label={label} tabIndex={-1} className="sr-only" value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <Dropdown
        label={label}
        width="w-full"
        className="w-full"
        testId={testId}
        triggerClassName="flex h-10 w-full items-center gap-2 rounded-lg bg-white px-3.5 text-left text-[14px] text-ink shadow-[inset_0_0_0_1px_#E5E5E5] transition-shadow duration-150 hover:shadow-[inset_0_0_0_1px_var(--rule-strong)] aria-expanded:shadow-[inset_0_0_0_2px_var(--accent)]"
        trigger={() => (
          <>
            <span className="min-w-0 flex-1 truncate">{current?.label ?? "Choose"}</span>
            <Icon name="chevronsUpDown" size={16} className="shrink-0 text-faint" />
          </>
        )}
      >
        {(close) => options.map((o) => (
          <MenuItem key={o.value} testId={testId ? `${testId}-${o.value}` : undefined} active={o.value === value} onClick={() => { onChange(o.value); close(); }} className="py-1.5">
            <span className="flex-1">{o.label}</span>
            {o.value === value ? <Icon name="check" size={14} className="text-ink-2" /> : null}
          </MenuItem>
        ))}
      </Dropdown>
    </div>
  );
}
