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

export function Select({ className, ...rest }: ComponentProps<"select">) {
  return (
    <select
      className={cx(
        "h-9 appearance-none rounded-lg bg-white bg-[url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' fill='none'%3E%3Cpath d='m4.5 6.5 3.5 3.5 3.5-3.5' stroke='%23A8A29E' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E\")]",
        "bg-[length:16px] bg-[right_10px_center] bg-no-repeat pl-3 pr-9 text-[14px] text-stone-900 shadow-ring-xs outline-none hover:bg-stone-50 focus-visible:shadow-[0_0_0_2px_var(--accent)]",
        className,
      )}
      {...rest}
    />
  );
}

/** Label + control + help or error. */
export function FormField({ label, help, error, htmlFor, className, children }: { label: ReactNode; help?: ReactNode; error?: ReactNode; htmlFor?: string; className?: string; children: ReactNode }) {
  return (
    <div className={cx("grid gap-2", className)}>
      <label htmlFor={htmlFor} className="text-[14px] font-medium leading-5 text-ink">{label}</label>
      {children}
      {error ? <p className="text-[13px] leading-5 text-flag" role="alert">{error}</p> : help ? <p className="text-[13px] leading-5 text-muted">{help}</p> : null}
    </div>
  );
}
