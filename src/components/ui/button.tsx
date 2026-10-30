import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { cx } from "./cx";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "ok";
type Size = "sm" | "md" | "lg";

const base =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium transition-colors select-none " +
  "disabled:cursor-not-allowed disabled:opacity-50 rounded-[var(--radius)] border";

const variants: Record<Variant, string> = {
  primary: "bg-ink text-paper border-ink hover:bg-ink-2 hover:border-ink-2",
  secondary: "bg-paper text-ink border-rule hover:border-ink-2 hover:bg-paper-2",
  ghost: "bg-transparent text-ink-2 border-transparent hover:bg-paper-2 hover:text-ink",
  danger: "bg-transparent text-flag border-[color-mix(in_oklab,var(--flag)_45%,transparent)] hover:bg-[color-mix(in_oklab,var(--flag)_10%,transparent)]",
  ok: "bg-ok text-paper border-ok hover:opacity-90",
};

const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-[13px]",
  md: "h-10 px-4 text-sm",
  lg: "h-12 px-5 text-[15px]",
};

interface Common {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
}

export function buttonClass(variant: Variant = "secondary", size: Size = "md", extra?: string): string {
  return cx(base, variants[variant], sizes[size], extra);
}

export function Button({
  variant = "secondary", size = "md", icon, loading, className, children, disabled, type = "button", ...rest
}: Common & ComponentProps<"button"> & { loading?: boolean }) {
  return (
    <button type={type} className={buttonClass(variant, size, className)} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading ? <Spinner /> : icon}
      {children}
    </button>
  );
}

export function ButtonLink({ variant = "secondary", size = "md", icon, className, children, ...rest }: Common & ComponentProps<typeof Link>) {
  return (
    <Link className={buttonClass(variant, size, className)} {...rest}>
      {icon}
      {children}
    </Link>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cx("h-4 w-4 animate-spin", className)} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
