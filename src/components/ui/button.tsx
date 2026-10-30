import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { cx } from "./cx";

/**
 * Buttons in the ByDefault system. One primary (flame) per view region.
 * `ok` is kept for older call sites and renders as primary; `dark` is the secondary for dark bands.
 */
type Variant = "primary" | "secondary" | "ghost" | "danger" | "ok" | "dark";
type Size = "sm" | "md" | "lg";

const base =
  "group/btn relative inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium select-none " +
  "transition-[background-color,background-image,color,box-shadow,scale] duration-150 ease-quint " +
  "disabled:pointer-events-none disabled:opacity-50 aria-busy:pointer-events-none " +
  "focus-visible:outline-none focus-visible:shadow-[0_0_0_2px_var(--paper),0_0_0_4px_var(--accent)]";

const sizes: Record<Size, string> = {
  sm: "h-8 rounded-md px-3 text-[14px] leading-5 active:scale-[.97]",
  md: "h-9 rounded-[10px] px-3.5 text-[14px] leading-5 active:scale-[.96]",
  lg: "h-10 rounded-[10px] px-4 text-[16px] leading-6 active:scale-[.96]",
};

const primarySm = "bg-accent text-accent-ink shadow-primary-sm hover:bg-accent-hover";
const primaryLg =
  "text-accent-ink shadow-primary-lg bg-[linear-gradient(to_bottom,var(--accent-grad-top),var(--accent-grad-bot))] " +
  "hover:bg-[linear-gradient(to_bottom,var(--accent-grad-top-h),var(--accent-grad-bot-h))]";

function variantClass(variant: Variant, size: Size): string {
  switch (variant) {
    case "primary":
    case "ok":
      return size === "sm" ? primarySm : primaryLg;
    case "secondary":
      return "bg-white text-ink-strong shadow-raised hover:bg-paper-2";
    case "ghost":
      return "bg-transparent text-ink-2 hover:bg-hover-tint hover:text-ink";
    case "danger":
      return "bg-white text-flag shadow-raised hover:bg-flag-bg";
    case "dark":
      return "bg-white/[.06] text-band-ink shadow-[inset_0_0_0_1px_rgb(255_255_255/.12)] hover:bg-white/10";
  }
}

interface Common {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
  /** A trailing chevron that nudges right on hover (hero and header CTAs). */
  chevron?: boolean;
}

export function buttonClass(variant: Variant = "secondary", size: Size = "md", extra?: string): string {
  return cx(base, sizes[size], variantClass(variant, size), extra);
}

export function Chevron({ className }: { className?: string }) {
  return (
    <svg
      className={cx("size-4 shrink-0 -mr-1 transition-transform duration-200 ease-quint group-hover/btn:translate-x-0.5", className)}
      viewBox="0 0 16 16" fill="none" aria-hidden
    >
      <path d="M6.5 4.5 10 8l-3.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Button({
  variant = "secondary", size = "md", icon, chevron, loading, className, children, disabled, type = "button", ...rest
}: Common & ComponentProps<"button"> & { loading?: boolean }) {
  return (
    <button type={type} className={buttonClass(variant, size, className)} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      <span className={cx("inline-flex items-center gap-2", loading && "invisible")}>
        {icon}
        {children}
        {chevron ? <Chevron /> : null}
      </span>
      {loading ? <Spinner className="absolute inset-0 m-auto" /> : null}
    </button>
  );
}

export function ButtonLink({ variant = "secondary", size = "md", icon, chevron, className, children, ...rest }: Common & ComponentProps<typeof Link>) {
  return (
    <Link className={buttonClass(variant, size, className)} {...rest}>
      {icon}
      {children}
      {chevron ? <Chevron /> : null}
    </Link>
  );
}

/** Square icon-only button (close, more, pager). Give it an aria-label. */
export function IconButton({ className, size = "md", type = "button", ...rest }: ComponentProps<"button"> & { size?: "sm" | "md" }) {
  return (
    <button
      type={type}
      className={cx(
        "inline-flex shrink-0 items-center justify-center rounded-md text-ink-2 transition-[background-color,color,scale] duration-150 ease-quint",
        "hover:bg-stone-200/60 hover:text-ink active:scale-[.96] disabled:pointer-events-none disabled:opacity-50",
        size === "sm" ? "size-7" : "size-8",
        className,
      )}
      {...rest}
    />
  );
}

/** 8-spoke spinner, 16px. */
export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cx("size-4 animate-spin [animation-duration:900ms]", className)} viewBox="0 0 16 16" fill="none" aria-hidden>
      {Array.from({ length: 8 }, (_, i) => (
        <path
          key={i} d="M8 1.5v3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"
          opacity={0.25 + (i / 8) * 0.75} transform={`rotate(${i * 45} 8 8)`}
        />
      ))}
    </svg>
  );
}
