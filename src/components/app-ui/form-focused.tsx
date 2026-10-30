import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { cx } from "@/components/ui";
import "./app-ui.css";

/**
 * Chrome-less focused layout (the design system's sign-in page): a 56px top bar, one centred column framed by rails at xl, and
 * bands whose full-bleed rules meet the rails at small joints. `width` is the column's outer width in px.
 */

function Joint({ className }: { className: string }) {
  return (
    <svg width="25" height="25" viewBox="0 0 25 25" aria-hidden className={cx("pointer-events-none absolute z-[1] hidden xl:block", className)}>
      <rect width="25" height="25" fill="var(--paper)" />
      <path d="M12.5 4v17M4 12.5h17" stroke="#E7E5E4" />
    </svg>
  );
}

export function FocusedPage({ right, children, width = 744, home = "/" }: { right?: ReactNode; children: ReactNode; width?: number; home?: string }) {
  return (
    <div className="relative flex min-h-dvh flex-col bg-paper">
      <div aria-hidden className="pointer-events-none absolute inset-y-0 left-1/2 hidden -translate-x-1/2 border-x border-rule xl:block" style={{ width }} />
      <header className="relative z-[2] flex h-14 items-center justify-between gap-3 px-4 sm:px-6">
        <Link href={home} className="flex shrink-0 items-center rounded-md" aria-label="Local Edition">
          <Image src="/brand/logo-light.svg" alt="Local Edition" width={107} height={22} priority className="hidden h-[22px] w-auto sm:block" />
          <Image src="/brand/mark-light.svg" alt="" width={22} height={22} priority className="size-[22px] sm:hidden" />
        </Link>
        <div className="min-w-0">{right}</div>
      </header>
      <main className="relative z-[1] flex-1 pb-16">{children}</main>
    </div>
  );
}

/** The column's content without a band (headings, footers). */
export function FocusedColumn({ children, width = 744, className }: { children: ReactNode; width?: number; className?: string }) {
  return <div className={cx("mx-auto w-full px-4 sm:px-6", className)} style={{ maxWidth: width }}>{children}</div>;
}

/** A band: full-bleed hairlines above and below, the column inside with joints where the rules cross the rails. */
export function FocusedBand({ children, width = 744, className }: { children: ReactNode; width?: number; className?: string }) {
  return (
    <section className={cx("relative border-y border-rule", className)}>
      <div className="relative mx-auto w-full p-2 sm:p-3" style={{ maxWidth: width }}>
        <Joint className="-left-[13px] -top-[13px]" />
        <Joint className="-right-[13px] -top-[13px]" />
        <Joint className="-bottom-[13px] -left-[13px]" />
        <Joint className="-bottom-[13px] -right-[13px]" />
        {children}
      </div>
    </section>
  );
}
