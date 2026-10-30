import type { ReactNode } from "react";
import { Pill, cx } from "@/components/ui";

/** The site container: 1190px, centred. */
export function Container({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx("mx-auto w-full max-w-[1190px]", className)}>{children}</div>;
}

/**
 * Full-bleed hairline rule with the ByDefault "joints" (small plus marks) where it crosses the 1192px rails (xl only).
 * `dark` for rules inside the dark bands.
 */
export function Rule({ dark, className }: { dark?: boolean; className?: string }) {
  const line = dark ? "bg-white/[.06]" : "bg-rule";
  const fill = dark ? "var(--band)" : "var(--paper)";
  const stroke = dark ? "rgb(255 255 255 / .1)" : "#E7E5E4";
  return (
    <div className={cx("relative h-px w-full", className)} aria-hidden>
      <div className={cx("absolute inset-0", line)} />
      {[-608, 583].map((x) => (
        <svg key={x} width="25" height="25" viewBox="0 0 25 25" className="absolute top-[-12px] hidden xl:block" style={{ left: `calc(50% + ${x}px)` }}>
          <rect width="25" height="25" fill={fill} />
          <path d="M12.5 4v17M4 12.5h17" stroke={stroke} />
        </svg>
      ))}
    </div>
  );
}

/** Pill → H2 → lede → actions, centred (ByDefault section header). */
export function SectionHeader({
  pill, pillIcon, pillBadge, title, lede, actions, dark, align = "center", className, id,
}: {
  pill?: ReactNode; pillIcon?: ReactNode; pillBadge?: ReactNode; title: ReactNode; lede?: ReactNode; actions?: ReactNode;
  dark?: boolean; align?: "center" | "left"; className?: string; id?: string;
}) {
  const center = align === "center";
  return (
    <div className={cx("flex flex-col", center ? "items-center text-center" : "items-start", className)}>
      {pill ? <Pill icon={pillIcon} badge={pillBadge} dark={dark}>{pill}</Pill> : null}
      <h2
        id={id}
        className={cx(
          "max-w-[760px] text-[32px] font-medium leading-[35.2px] tracking-[-0.02em] sm:text-[44px] sm:leading-[48.4px]",
          pill ? "mt-4" : "",
          dark ? "text-band-ink" : "text-ink",
        )}
      >
        {title}
      </h2>
      {lede ? (
        <p className={cx("mt-3 max-w-[560px] text-[16px] leading-6 sm:text-[18px] sm:leading-7", dark ? "text-band-ink-2" : "text-ink-2")}>{lede}</p>
      ) : null}
      {actions ? <div className={cx("mt-6 flex flex-wrap gap-2.5", center && "justify-center")}>{actions}</div> : null}
    </div>
  );
}

/** Lucide-style 16px line icons used in pills and labels (drawn here, ISC-style geometry, no brand marks). */
export const Icon = {
  grid: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="5" height="5" rx="1" /><rect x="9" y="2" width="5" height="5" rx="1" /><rect x="2" y="9" width="5" height="5" rx="1" /><rect x="9" y="9" width="5" height="5" rx="1" /></svg>,
  loop: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M2.5 8a5.5 5.5 0 0 1 9.6-3.6L13.5 6M13.5 8a5.5 5.5 0 0 1-9.6 3.6L2.5 10" /><path d="M13.5 2.5V6H10M2.5 13.5V10H6" /></svg>,
  plug: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 2v3M10 2v3M4 5h8v3a4 4 0 0 1-8 0V5ZM8 12v2" /></svg>,
  doc: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 1.8H4.5a1.5 1.5 0 0 0-1.5 1.5v9.4a1.5 1.5 0 0 0 1.5 1.5h7a1.5 1.5 0 0 0 1.5-1.5V5.8L9 1.8Z" /><path d="M9 1.8v4h4M5.5 9h5M5.5 11.5h3" /></svg>,
  check: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 8.5 6.5 12 13 4.5" /></svg>,
  help: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="8" cy="8" r="6.2" /><path d="M6.2 6.2a1.9 1.9 0 0 1 3.6.6c0 1.3-1.8 1.7-1.8 2.7M8 11.6h.01" /></svg>,
  gauge: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M2.5 13.5h11M4.5 11V8M8 11V4.5M11.5 11V6.5" /></svg>,
  store: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M2.5 6.5 3.5 2.5h9l1 4M2.5 6.5h11M2.5 6.5c0 1.1.9 2 2 2s2-.9 2-2c0 1.1.9 2 2 2s2-.9 2-2c0 1.1.9 2 2 2s1.5-.9 1.5-2M3.5 8.4v5.1h9V8.4M6.5 13.5V10.5h3v3" /></svg>,
  mail: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3.5" width="12" height="9" rx="1.5" /><path d="m2.5 4.5 5.5 4.2 5.5-4.2" /></svg>,
  arrowUpRight: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 11 11 5M6 5h5v5" /></svg>,
  arrowLeft: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M13 8H3M7 4 3 8l4 4" /></svg>,
};
