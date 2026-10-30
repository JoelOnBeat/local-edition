import type { ComponentProps, ReactNode } from "react";
import { cx } from "./cx";

/** Plain white card: 12px radius, hairline ring. `inset` gives the stone-50 well tone. */
export function Card({ className, inset, ...rest }: ComponentProps<"div"> & { inset?: boolean }) {
  return (
    <div
      className={cx("rounded-xl shadow-ring-xs", inset ? "bg-paper-2" : "bg-white", className)}
      {...rest}
    />
  );
}

/**
 * Header-band card (ByDefault's table and rank cards): a stone-50 frame with a title row, a white plate body and an
 * optional footer strip. `flush` removes the body padding (tables, lists). `elevated` uses the larger hero shadow.
 */
export function CardBand({
  title, icon, actions, footer, flush, elevated, className, bodyClassName, children, ...rest
}: Omit<ComponentProps<"section">, "title"> & {
  title: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
  flush?: boolean;
  elevated?: boolean;
  bodyClassName?: string;
}) {
  return (
    <section
      className={cx(
        "flex min-w-0 flex-col overflow-hidden rounded-xl bg-paper-2 p-1 pt-0",
        elevated ? "shadow-ring-md" : "shadow-ring-xs",
        className,
      )}
      {...rest}
    >
      <header className="-mb-1 flex min-h-[48px] items-center gap-2 px-3 pb-3.5 pt-4">
        {icon ? <span className="flex size-4 shrink-0 items-center justify-center text-faint" aria-hidden>{icon}</span> : null}
        <h3 className="min-w-0 flex-1 truncate text-[14px] font-medium leading-5 text-ink-strong">{title}</h3>
        {actions ? <div className="-my-1.5 flex shrink-0 items-center gap-1.5">{actions}</div> : null}
      </header>
      <div className={cx("relative z-10 min-w-0 rounded-lg bg-white shadow-ring-xs", !flush && "p-4", bodyClassName)}>{children}</div>
      {footer ? (
        <footer className="-mt-1 flex items-center justify-between gap-3 px-3 pb-1 pt-3 text-[14px] leading-5 text-ink-2">{footer}</footer>
      ) : null}
    </section>
  );
}

/** Small label above a block. The old small-caps kicker, now plain 13/500 muted text (no uppercase eyebrows). */
export function Kicker({ className, ...rest }: ComponentProps<"p">) {
  return <p className={cx("text-[13px] font-medium leading-5 text-muted", className)} {...rest} />;
}

/**
 * A frame band (signature layout): full-bleed hairlines above and below, a white 12px card inside with the smooth ring.
 * Use for page headers and landing sections.
 */
export function Frame({ className, innerClassName, children, ...rest }: ComponentProps<"section"> & { innerClassName?: string }) {
  return (
    <section className={cx("relative border-y border-rule", className)} {...rest}>
      <div className="mx-auto max-w-[1190px] p-2 sm:p-3">
        <div className={cx("ring-after relative rounded-xl bg-white", innerClassName)}>{children}</div>
      </div>
    </section>
  );
}

/** Note box: honest-limit notices and "Sample data" labels. */
export function NoteBox({ icon, className, children }: { icon?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <div className={cx("rounded-2xl bg-black/[.055] p-1", className)}>
      <div className="flex items-start gap-3 rounded-xl bg-white px-4 py-3.5 text-[15px] leading-6 text-ink-2 shadow-plate">
        <span className="mt-1 shrink-0 text-faint" aria-hidden>
          {icon ?? (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.5" /><path d="M8 7.2v3.8M8 5h.01" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
          )}
        </span>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
