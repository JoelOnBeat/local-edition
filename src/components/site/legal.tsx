import { Pill } from "@/components/ui";
import { Icon } from "./section";
import { SiteShell } from "./site-chrome";

/** Shared layout for the privacy and terms pages: an inner-hero frame, then the text in a two-column content frame. */

export const LEGAL_UPDATED = "30 October 2026";

export function LegalPage({ title, intro, children }: { title: string; intro: string; children: React.ReactNode }) {
  return (
    <SiteShell cta={false}>
      <section className="relative border-b border-rule">
        <div className="mx-auto max-w-[1190px] p-2 sm:p-3">
          <div className="ring-after relative rounded-xl bg-white px-6 pb-14 pt-14 text-center md:px-10 md:pb-16 md:pt-20">
            <Pill icon={Icon.doc}>Legal</Pill>
            <h1 className="mx-auto mt-8 max-w-[680px] text-[36px] font-medium leading-[39.6px] tracking-[-0.02em] text-ink [text-wrap:balance] sm:text-[44px] sm:leading-[48.4px]">
              {title}
            </h1>
            <p className="mx-auto mt-[26px] max-w-[560px] text-[18px] leading-7 text-ink-2 [text-wrap:pretty]">{intro}</p>
            <p className="mt-6 text-[14px] leading-5 text-muted">Last updated {LEGAL_UPDATED}</p>
          </div>
        </div>
      </section>
      <div className="h-12" aria-hidden />
      <section className="relative border-y border-rule">
        <div className="mx-auto max-w-[1190px] p-2 sm:p-3">
          <article className="ring-after relative rounded-xl bg-white px-6 py-8 md:px-8 md:py-10">
            <div className="mx-auto max-w-[880px]">{children}</div>
          </article>
        </div>
      </section>
      <div className="h-24" aria-hidden />
    </SiteShell>
  );
}

export function LegalSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-x-8 gap-y-3 border-t border-rule-subtle pt-7 first:border-t-0 first:pt-0 [&:not(:first-child)]:mt-7 md:grid-cols-[220px_minmax(0,1fr)]">
      <h2 className="text-[18px] font-medium leading-[26px] tracking-[-0.01em] text-ink">{title}</h2>
      <div className="grid gap-4 text-[16px] leading-[26px] text-ink-2 [overflow-wrap:anywhere] [&_a]:text-ink [&_a]:underline [&_a]:decoration-rule-strong [&_a]:underline-offset-4 hover:[&_a]:decoration-accent [&_li]:pl-1 [&_strong]:font-medium [&_strong]:text-ink [&_ul]:grid [&_ul]:list-disc [&_ul]:gap-2 [&_ul]:pl-5 [&_ul]:marker:text-faint">
        {children}
      </div>
    </section>
  );
}
