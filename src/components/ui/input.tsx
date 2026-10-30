import type { ComponentProps, ReactNode } from "react";
import { cx } from "./cx";

const field =
  "w-full rounded-lg bg-white px-3.5 text-[14px] leading-5 text-ink caret-ink outline-none placeholder:text-muted " +
  "shadow-[inset_0_0_0_1px_#E5E5E5] transition-shadow duration-150 ease-quint hover:shadow-[inset_0_0_0_1px_var(--rule-strong)] " +
  "focus:shadow-[inset_0_0_0_2px_var(--accent)] focus-visible:outline-none " +
  "disabled:cursor-not-allowed disabled:bg-paper-2 disabled:text-muted " +
  "aria-invalid:shadow-[inset_0_0_0_2px_var(--danger-ring)]";

/** Text input: h-10, 8px radius, inset ring, flame focus ring, red ring when aria-invalid. */
export function Input({ className, ...rest }: ComponentProps<"input">) {
  return <input className={cx(field, "h-10", className)} {...rest} />;
}

export function Textarea({ className, ...rest }: ComponentProps<"textarea">) {
  return <textarea className={cx(field, "min-h-24 py-2.5", className)} {...rest} />;
}

/** Label + control + help or error. */
export function FormField({ label, help, error, htmlFor, className, children }: { label: ReactNode; help?: ReactNode; error?: ReactNode; htmlFor?: string; className?: string; children: ReactNode }) {
  return (
    <div className={cx("grid gap-2", className)}>
      <label htmlFor={htmlFor} className="flex select-none items-center gap-1 text-[14px] font-medium leading-[14px] text-ink-strong">{label}</label>
      {children}
      {error ? <p className="text-[13px] leading-5 text-flag" role="alert">{error}</p> : help ? <p className="text-[13px] leading-5 text-muted">{help}</p> : null}
    </div>
  );
}
