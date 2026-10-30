import { SiteShell } from "./site-chrome";

/** Shared layout for the privacy and terms pages: a plain document with a dated header. */

export const LEGAL_UPDATED = "30 October 2026";

export function LegalPage({ title, intro, children }: { title: string; intro: string; children: React.ReactNode }) {
  return (
    <SiteShell>
      <article className="mx-auto max-w-[760px] px-4 py-12 sm:px-6 md:py-16">
        <p className="font-(family-name:--font-mono) text-[12px] uppercase tracking-[0.08em] text-(--muted)">
          Last updated {LEGAL_UPDATED}
        </p>
        <h1 className="mt-2 font-(family-name:--font-display) text-[clamp(36px,6vw,56px)] font-extrabold leading-none tracking-[-0.03em]">
          {title}
        </h1>
        <p className="mt-5 border-b border-(--rule) pb-6 text-[18px] leading-[1.55] text-(--ink-2)">{intro}</p>
        <div className="grid gap-8 pt-8">{children}</div>
      </article>
    </SiteShell>
  );
}

export function LegalSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-3">
      <h2 className="font-(family-name:--font-display) text-[22px] font-bold leading-tight">{title}</h2>
      <div className="grid gap-3 text-[16px] leading-[1.65] text-(--ink-2) [&_li]:ml-5 [&_li]:list-disc [&_li]:pl-1 [&_ul]:grid [&_ul]:gap-1.5 [&_a]:font-semibold [&_a]:text-(--ink) [&_a]:underline [&_a]:underline-offset-4 [&_strong]:font-semibold [&_strong]:text-(--ink)">
        {children}
      </div>
    </section>
  );
}
