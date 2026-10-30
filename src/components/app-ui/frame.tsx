import Link from "next/link";
import type { ReactNode } from "react";
import { cx } from "@/components/ui";
import { Icon } from "./icons";
import "./app-ui.css";

/**
 * The page frame for app pages. With the sidebar present only the horizontal hairline rules stay (no rails or
 * joints, DESIGN-SYSTEM §10.4): white frame cards inside bands, and header-band cards for data.
 */

/** A full-bleed band between two rules. `pad` "frame" holds a white frame card; "data" holds header-band cards. */
export function Band({ children, pad = "data", className, inner, top = true, grow }: { children: ReactNode; pad?: "frame" | "data" | "none"; className?: string; inner?: string; top?: boolean; grow?: boolean }) {
  return (
    <section className={cx("relative border-b border-rule", top && "border-t", grow && "flex flex-1 flex-col", className)}>
      <div
        className={cx(
          "relative mx-auto w-full max-w-[1192px]",
          grow && "flex flex-1 flex-col",
          pad === "frame" && "p-2 sm:p-3",
          pad === "data" && "px-2 py-4 sm:px-3 md:px-7 md:py-7",
          inner,
        )}
      >
        {children}
      </div>
    </section>
  );
}

/** A page inside the app: fills the viewport height so the last `Band grow` reaches the bottom. */
export function Page({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("flex min-h-dvh flex-col pt-2", className)}>{children}</div>;
}

/** The 48px gap between bands; the rails run through it. */
export function Gap({ size = "md" }: { size?: "sm" | "md" }) {
  return <div aria-hidden className={cx("mx-auto w-full max-w-[1192px]", size === "md" ? "h-6 md:h-10" : "h-4 md:h-6")} />;
}

/** White frame card (rounded-xl + ring-md drawn above the fill). */
export function FrameCard({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("ring-after relative rounded-xl bg-white", className)}>{children}</div>;
}

export interface Crumb { href?: string; label: ReactNode }

/** The page header: a white frame with breadcrumbs, pill, H1, lede and actions, left-aligned. */
export function PageHeader({ crumbs, pill, title, lede, actions, aside, children }: {
  crumbs?: Crumb[];
  pill?: ReactNode;
  title: ReactNode;
  lede?: ReactNode;
  actions?: ReactNode;
  aside?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <Band pad="frame" top={false}>
      <FrameCard className="px-5 pb-7 pt-5 sm:px-6 md:px-8 md:pb-9 md:pt-6">
        {crumbs?.length ? <Breadcrumbs crumbs={crumbs} /> : null}
        <div className={cx("flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between", crumbs?.length ? "mt-6 md:mt-8" : "mt-2")}>
          <div className="min-w-0 max-w-[720px]">
            {pill}
            <h1 className={cx("text-[30px] font-medium leading-[1.1] tracking-[-0.02em] text-ink [overflow-wrap:anywhere] md:text-[36px]", pill ? "mt-5" : "")}>{title}</h1>
            {lede ? <div className="mt-3 max-w-[560px] text-[16px] leading-6 text-ink-2">{lede}</div> : null}
          </div>
          {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2.5">{actions}</div> : null}
          {aside}
        </div>
        {children}
      </FrameCard>
    </Band>
  );
}

export function Breadcrumbs({ crumbs }: { crumbs: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-[13px] text-muted">
      {crumbs.map((c, i) => (
        <span key={i} className="flex min-w-0 items-center gap-1.5">
          {i > 0 ? <Icon name="chevronRight" size={12} className="shrink-0 text-faint" /> : null}
          {c.href ? (
            <Link href={c.href} className="truncate rounded-sm transition-colors duration-150 hover:text-ink">{c.label}</Link>
          ) : (
            <span className="truncate text-ink-2" aria-current="page">{c.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}
