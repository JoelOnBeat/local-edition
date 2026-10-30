"use client";

import {
  type ComponentProps,
  Children, isValidElement, useId, useMemo, useRef, useState,
  type ChangeEvent, type KeyboardEvent, type ReactElement, type ReactNode,
} from "react";
import { cx } from "./cx";
import { PopoverList, optionText, type ListOption } from "./popover-list";

type OptionEl = ReactElement<{ value?: string | number; children?: ReactNode; disabled?: boolean }>;

/** Reads `<option>` children so older call sites (`<Select><option value="a">A</option></Select>`) keep working. */
function fromChildren(children: ReactNode): ListOption[] {
  const out: ListOption[] = [];
  Children.forEach(children, (c) => {
    if (!isValidElement(c)) return;
    const el = c as OptionEl;
    if (el.type === "option") {
      const label = el.props.children;
      out.push({ value: String(el.props.value ?? (typeof label === "string" ? label : "")), label, disabled: el.props.disabled });
    } else if (el.props.children) out.push(...fromChildren(el.props.children));
  });
  return out;
}

const fakeEvent = (value: string) => ({ target: { value }, currentTarget: { value } }) as unknown as ChangeEvent<HTMLSelectElement>;

export interface SelectProps {
  value?: string;
  defaultValue?: string;
  /** Native-style handler: receives `{ target: { value } }`, so code written for `<select>` keeps working. */
  onChange?: (e: ChangeEvent<HTMLSelectElement>) => void;
  onValueChange?: (value: string) => void;
  options?: ListOption[];
  children?: ReactNode;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  name?: string;
  id?: string;
  className?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  /** Goes on a visually hidden native select that mirrors the value (forms, tests); the trigger gets `<id>-trigger`. */
  "data-testid"?: string;
}

/**
 * Designed select: a pill trigger and a popover list (never the OS popup). Keyboard: arrows, Home/End, Enter, Escape,
 * typeahead. Accepts `options` or `<option>` children; `onChange` gets a select-like event.
 */
export function Select(props: SelectProps & Omit<ComponentProps<"select">, keyof SelectProps | "ref">) {
  const { value: controlled, defaultValue, onChange, onValueChange, placeholder = "Choose…", disabled, required, name, id, className } = props;
  const options = useMemo(() => props.options ?? fromChildren(props.children), [props.options, props.children]);
  const [inner, setInner] = useState(defaultValue ?? options[0]?.value ?? "");
  const value = controlled ?? inner;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const trigger = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const typed = useRef({ q: "", t: 0 });
  const current = options.find((o) => o.value === value);

  const pick = (o: ListOption) => {
    setInner(o.value);
    if (o.value !== value) { onValueChange?.(o.value); onChange?.(fakeEvent(o.value)); }
    setOpen(false);
    trigger.current?.focus();
  };
  const show = () => { setActive(Math.max(0, options.findIndex((o) => o.value === value))); setOpen(true); };
  const step = (d: number) => {
    let i = active;
    for (let n = 0; n < options.length; n++) { i = (i + d + options.length) % options.length; if (!options[i]?.disabled) break; }
    setActive(i);
  };

  const onKey = (e: KeyboardEvent) => {
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) { e.preventDefault(); show(); }
      return;
    }
    if (e.key === "Escape") { e.preventDefault(); setOpen(false); }
    else if (e.key === "ArrowDown") { e.preventDefault(); step(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); step(-1); }
    else if (e.key === "Home") { e.preventDefault(); setActive(0); }
    else if (e.key === "End") { e.preventDefault(); setActive(options.length - 1); }
    else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); const o = options[active]; if (o && !o.disabled) pick(o); }
    else if (e.key === "Tab") setOpen(false);
    else if (e.key.length === 1) {
      const now = Date.now();
      typed.current = { q: (now - typed.current.t < 600 ? typed.current.q : "") + e.key.toLowerCase(), t: now };
      const i = options.findIndex((o) => optionText(o).toLowerCase().startsWith(typed.current.q));
      if (i >= 0) setActive(i);
    }
  };

  const testId = props["data-testid"];
  return (
    <span className={cx("relative inline-flex", className?.includes("w-full") && "w-full")}>
      <button
        ref={trigger}
        id={id}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && active >= 0 ? `${listId}-opt-${active}` : undefined}
        aria-label={props["aria-label"]}
        aria-labelledby={props["aria-labelledby"]}
        aria-required={required || undefined}
        data-testid={testId ? `${testId}-trigger` : undefined}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={onKey}
        onBlur={() => setOpen(false)}
        className={cx(
          "group/sel inline-flex h-9 w-full min-w-0 items-center gap-2 rounded-lg bg-white pl-3 pr-2.5 text-left text-[14px] text-stone-900 shadow-ring-xs",
          "transition-[background-color,box-shadow] duration-150 ease-quint hover:bg-stone-50 focus-visible:shadow-[0_0_0_2px_var(--accent)] focus-visible:outline-none",
          "disabled:cursor-not-allowed disabled:opacity-50",
          open && "bg-stone-50",
          className,
        )}
      >
        {current?.icon ? <span className="flex shrink-0 items-center">{current.icon}</span> : null}
        <span className={cx("min-w-0 flex-1 truncate", !current && "text-muted")}>{current ? current.label : placeholder}</span>
        <svg className={cx("size-4 shrink-0 text-faint transition-transform duration-200 ease-quint", open && "rotate-180")} viewBox="0 0 16 16" fill="none" aria-hidden>
          <path d="m4.5 6.5 3.5 3.5 3.5-3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <select
        aria-hidden tabIndex={-1} name={name} required={required} disabled={disabled} data-testid={testId}
        value={value} onChange={(e) => { const o = options.find((x) => x.value === e.target.value); if (o) pick(o); }}
        className="pointer-events-none absolute bottom-0 left-0 h-px w-px opacity-0"
      >
        {options.map((o) => <option key={o.value} value={o.value}>{optionText(o)}</option>)}
      </select>
      <PopoverList id={listId} open={open} anchor={trigger} options={options} value={value} active={active} onPick={pick} onHover={setActive} />
    </span>
  );
}

/**
 * Combobox: a text field that filters a popover list. `onQueryChange` lets the caller search a server instead.
 */
export function Combobox({
  options, value, onValueChange, onQueryChange, placeholder = "Search…", empty = "No matches", id, className, disabled, "aria-label": ariaLabel, "data-testid": testId,
}: {
  options: ListOption[];
  value?: string;
  onValueChange: (value: string, option: ListOption) => void;
  onQueryChange?: (q: string) => void;
  placeholder?: string;
  empty?: ReactNode;
  id?: string;
  className?: string;
  disabled?: boolean;
  "aria-label"?: string;
  "data-testid"?: string;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const shown = onQueryChange ? options : options.filter((o) => optionText(o).toLowerCase().includes(q.trim().toLowerCase()));
  const pick = (o: ListOption) => { onValueChange(o.value, o); setQ(""); setOpen(false); };
  return (
    <span className={cx("relative block", className)}>
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" aria-hidden>
        <svg className="size-4" viewBox="0 0 16 16" fill="none"><circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.5" /><path d="m10.5 10.5 3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
      </span>
      <input
        ref={input} id={id} data-testid={testId} disabled={disabled} value={q} placeholder={placeholder} aria-label={ariaLabel}
        role="combobox" aria-expanded={open} aria-controls={open ? listId : undefined} aria-autocomplete="list"
        aria-activedescendant={open && shown[active] ? `${listId}-opt-${active}` : undefined}
        onChange={(e) => { setQ(e.target.value); onQueryChange?.(e.target.value); setOpen(true); setActive(0); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive((a) => Math.min(shown.length - 1, a + 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
          else if (e.key === "Enter" && open && shown[active]) { e.preventDefault(); pick(shown[active]!); }
          else if (e.key === "Escape") setOpen(false);
        }}
        className={cx(
          "h-10 w-full rounded-lg bg-white pl-9 pr-3.5 text-[14px] text-ink outline-none placeholder:text-muted shadow-[inset_0_0_0_1px_#E5E5E5]",
          "transition-shadow duration-150 hover:shadow-[inset_0_0_0_1px_var(--rule-strong)] focus:shadow-[inset_0_0_0_1px_var(--rule-strong)] disabled:cursor-not-allowed disabled:bg-paper-2",
        )}
      />
      <PopoverList id={listId} open={open} anchor={input} options={shown} value={value} active={active} onPick={pick} onHover={setActive} empty={empty} />
    </span>
  );
}
