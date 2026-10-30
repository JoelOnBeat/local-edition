import Link from "next/link";
import type { ReactNode } from "react";
import { BrandGlyph, Lockup, Pill, StoreTile, cx } from "@/components/ui";
import { MEASURED, STORE_ROWS } from "./landing-data";
import { Icon } from "./section";

function Joint({ className }: { className: string }) {
  return (
    <svg width="25" height="25" viewBox="0 0 25 25" className={cx("absolute hidden lg:block", className)} aria-hidden>
      <rect width="25" height="25" fill="var(--paper)" />
      <path d="M12.5 4v17M4 12.5h17" stroke="#E7E5E4" />
    </svg>
  );
}

/** The product visual on the right: a dark band with this week's stores and one store's staff card. */
function AuthVisual() {
  const rows = STORE_ROWS.slice(0, 4);
  return (
    <aside className="band-dither relative m-2 hidden flex-col overflow-hidden rounded-[22px] text-band-ink shadow-[inset_0_0_0_1px_rgb(255_255_255/.06)] lg:flex">
      <div aria-hidden className="pointer-events-none absolute -right-40 top-24 size-[560px] rounded-full border border-white/[.05]" />
      <div aria-hidden className="pointer-events-none absolute -right-24 top-40 size-[400px] rounded-full border border-white/[.05]" />
      <div className="relative px-12 pt-14 xl:px-16">
        <Pill dark icon={Icon.doc}>This week · Kettle &amp; Kiln (sample chain)</Pill>
        <p className="mt-6 max-w-[440px] text-[30px] font-medium leading-10 tracking-[-0.02em] text-band-ink">
          Every store gets its own front page, every Monday.
        </p>
      </div>
      <div className="relative mt-12 flex-1 px-12 xl:px-16">
        <div className="w-full max-w-[400px] rounded-xl bg-band-card shadow-[0_0_0_1px_rgb(255_255_255/.08)]">
          <p className="border-b border-white/[.06] px-4 py-3 text-[13px] font-medium text-band-ink-2">Editions this week</p>
          {rows.map((r) => (
            <div key={r.id} className="flex items-center gap-3 border-b border-white/[.04] px-4 py-2.5 text-[14px] last:border-0">
              <StoreTile colorIndex={r.colorIndex} name={r.name} />
              <span className="min-w-0 flex-1 truncate">{r.name}<span className="text-band-ink-3"> · {r.special}</span></span>
              <span className={cx("rounded-md px-2 py-0.5 text-[12px] font-medium", r.status === "flagged" ? "bg-[#3a1d1f] text-[#ff8a8f]" : "bg-white/[.06] text-band-ink-2")}>
                {r.status === "flagged" ? "Flagged" : "Draft"}
              </span>
            </div>
          ))}
        </div>
        <div className="absolute right-10 top-24 w-[248px] rotate-[1.5deg] rounded-[18px] bg-white p-1.5 text-ink shadow-ring-xl xl:right-16">
          <div className="flex items-center gap-2 px-2.5 py-2">
            <StoreTile colorIndex={1} name="Williamsburg" size="sm" />
            <span className="text-[12px] font-medium">Williamsburg staff card</span>
          </div>
          {[["This week's special", "Orange Peel Cortado"], ["On the speakers", "Big Thief, Yo La Tengo"], ["Event", "Vinyl and Cortado Night, Thu 19:00"]].map(([k, v]) => (
            <div key={k} className="border-t border-rule-subtle px-2.5 py-2">
              <p className="text-[11px] font-medium text-muted">{k}</p>
              <p className="text-[13px] font-medium leading-5">{v}</p>
            </div>
          ))}
        </div>
      </div>
      <div className="relative flex items-center justify-between gap-6 border-t border-white/[.06] px-12 py-6 text-[13px] text-band-ink-3 xl:px-16">
        <span className="flex items-center gap-3 text-band-ink-2">
          {(["qloo", "nvidia", "nebius"] as const).map((b) => <BrandGlyph key={b} brand={b} className="size-4" />)}
          <span className="text-band-ink-3">Qloo · NVIDIA Nemotron · Nebius</span>
        </span>
        <span className="tnum">One store built in {MEASURED.buildSeconds} s for {MEASURED.buildCost}</span>
      </div>
    </aside>
  );
}

/**
 * Full-screen auth layout (no site header or footer): the form column on the left, framed by rails and hairlines like
 * ByDefault's sign-in, and the product visual on the right from 1024px.
 */
export function AuthLayout({ title, lede, children, below }: { title: string; lede?: ReactNode; children: ReactNode; below?: ReactNode }) {
  return (
    <div className="grid min-h-dvh bg-paper lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="relative flex min-w-0 flex-col overflow-hidden">
        <div aria-hidden className="pointer-events-none absolute inset-y-0 left-1/2 hidden w-[512px] -translate-x-1/2 border-x border-rule sm:block" />
        <div className="relative flex h-14 items-center px-4 sm:px-6">
          <Link href="/" className="-ml-2 inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-[14px] text-ink-2 transition-colors hover:bg-hover-tint hover:text-ink">
            <span className="size-4" aria-hidden>{Icon.arrowLeft}</span>Back to home
          </Link>
        </div>
        <main className="relative flex flex-1 flex-col items-center justify-center px-2 pb-16 pt-6 sm:px-0">
          <Link href="/" aria-label="Local Edition home" className="rounded-md"><Lockup size="sm" /></Link>
          <h1 className="mt-6 text-center text-[24px] font-medium leading-8 tracking-[-0.02em] text-ink">{title}</h1>
          {lede ? <p className="mt-1.5 max-w-[400px] px-4 text-center text-[15px] leading-6 text-ink-2">{lede}</p> : null}
          <div className="relative mt-8 w-full sm:w-[488px]">
            <span aria-hidden className="absolute -left-[50vw] -right-[50vw] -top-3 hidden h-px bg-rule sm:block" />
            <span aria-hidden className="absolute -bottom-3 -left-[50vw] -right-[50vw] hidden h-px bg-rule sm:block" />
            <Joint className="-left-[24.5px] -top-[24.5px]" />
            <Joint className="-right-[24.5px] -top-[24.5px]" />
            <Joint className="-bottom-[24.5px] -left-[24.5px]" />
            <Joint className="-bottom-[24.5px] -right-[24.5px]" />
            <div className="ring-after relative rounded-xl bg-white px-5 pb-8 pt-7 sm:px-9 sm:pb-9 sm:pt-9">{children}</div>
          </div>
          <div className="mt-8 grid max-w-[440px] justify-items-center gap-3 px-4 text-center text-[14px] leading-5 text-muted">{below}</div>
        </main>
      </div>
      <AuthVisual />
    </div>
  );
}

/** The terms line under every auth card. */
export function TermsLine() {
  return (
    <p>
      By continuing you agree to our{" "}
      <Link href="/terms" className="text-ink-2 underline decoration-stone-300 underline-offset-[3px] hover:text-ink">Terms</Link> and{" "}
      <Link href="/privacy" className="text-ink-2 underline decoration-stone-300 underline-offset-[3px] hover:text-ink">Privacy Policy</Link>.
    </p>
  );
}
