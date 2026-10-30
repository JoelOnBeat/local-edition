import Link from "next/link";
import type { ReactNode } from "react";
import { SampleChainLink } from "@/components/account/session-links";
import { BrandGlyph, Chevron, StoreTile, cx, type Brand } from "@/components/ui";
import { STORE_ROWS } from "./landing-data";
import { Container, Icon, Rule } from "./section";

/** A brand chip set inline in the headline, tilted a degree (ByDefault's H1 chips). */
function InlineChip({ brand, tilt, children, accent }: { brand: Brand; tilt: "l" | "r"; children: ReactNode; accent?: boolean }) {
  return (
    <span
      className={cx(
        "inline-flex h-[1.08em] items-center gap-[.18em] rounded-[.18em] bg-white pl-[.16em] pr-[.24em] align-[-.06em] shadow-raised",
        "-my-[.04em] whitespace-nowrap",
        tilt === "l" ? "-rotate-1" : "rotate-1",
        accent ? "text-[#5f8f00]" : "text-ink",
      )}
    >
      <BrandGlyph brand={brand} className="size-[.72em] shrink-0" />
      {children}
    </span>
  );
}

export function LandingHero() {
  const stack = STORE_ROWS.slice(0, 3);
  return (
    <section className="relative border-y border-rule">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 -top-14 bottom-0 hidden overflow-hidden lg:block">
        <div className="absolute left-1/2 top-[-300px] size-[1460px] -translate-x-1/2 rounded-full border border-[color:var(--arc)]" />
      </div>
      <div className="relative mx-auto max-w-[1190px] p-2 sm:p-3"><div className="ring-after relative rounded-xl bg-white">
        <Container className="flex flex-col items-center px-5 pb-16 pt-14 text-center md:px-10 md:pb-24 md:pt-24">
          <h1 className="max-w-[720px] text-[30px] font-medium leading-[33px] tracking-[-0.02em] text-ink [text-wrap:pretty] sm:text-[44px] sm:leading-[48.4px] lg:text-[56px] lg:leading-[61.6px]">
            Every store&apos;s week, planned from <br className="sm:hidden" /><InlineChip brand="qloo" tilt="l">Qloo</InlineChip> taste <br className="sm:hidden" />and written by{" "}
            <InlineChip brand="nvidia" tilt="r" accent>Nemotron</InlineChip>
          </h1>
          <p className="mt-7 max-w-[420px] text-[18px] leading-6 text-ink-2 [text-wrap:balance]">
            Each Monday, every location gets its own special, sound brief, local partner and event night, with the evidence behind each line.
          </p>

          <form action="/signin" method="get" className="mt-10 grid w-full max-w-[400px] gap-3">
            <div className="group/combo rounded-[14px] shadow-raised transition-shadow duration-150 ease-quint focus-within:shadow-[0_0_0_1px_var(--stone-300),0_1px_2px_#00000014] hover:shadow-[0_0_0_1px_var(--stone-300),0_1px_2px_#00000014]">
              <div className="flex h-12 items-center rounded-[14px] bg-white pr-1">
                <span className="flex w-11 shrink-0 items-center justify-center text-faint [&_svg]:size-4" aria-hidden>{Icon.mail}</span>
                <label htmlFor="hero-email" className="sr-only">Work email</label>
                <input
                  id="hero-email" name="email" type="email" autoComplete="email" placeholder="you@yourchain.com"
                  className="h-full min-w-0 flex-1 bg-transparent pr-2 text-[15px] text-ink outline-none placeholder:text-muted"
                />
                <button
                  type="submit"
                  className={cx(
                    "group/btn mr-0.5 hidden h-9 shrink-0 items-center gap-2 rounded-lg px-3 text-[15px] font-medium leading-[21.4px] text-white sm:inline-flex",
                    "bg-accent bg-[linear-gradient(to_bottom,var(--accent-grad-top),var(--accent-grad-bot))] shadow-primary-lg transition-[background-image,box-shadow,scale] duration-150 ease-quint",
                    "hover:bg-[linear-gradient(to_bottom,var(--accent-grad-top-h),var(--accent-grad-bot-h))] active:scale-[.96]",
                  )}
                >
                  Start free<Chevron className="size-3.5" />
                </button>
              </div>
            </div>
            <button
              type="submit"
              className="group/btn inline-flex h-12 w-full items-center justify-center gap-2 rounded-[14px] bg-accent bg-[linear-gradient(to_bottom,var(--accent-grad-top),var(--accent-grad-bot))] px-4 text-[15px] font-medium text-white shadow-primary-lg active:scale-[.96] sm:hidden"
            >
              Start free<Chevron className="size-3.5" />
            </button>
          </form>

          <div className="relative mt-3 w-full max-w-[400px]">
            <SampleChainLink
              data-testid="landing-open-app"
              signedOutLabel="Try the sample chain"
              className="flex h-12 w-full items-center rounded-[14px] bg-white pl-[88px] pr-6 text-left text-[15px] font-medium text-ink-strong shadow-raised transition-[background-color,scale] duration-150 ease-quint hover:bg-paper-2 active:scale-[.98] disabled:opacity-60 sm:pl-[92px]"
            />
            <span className="pointer-events-none absolute left-3.5 top-1/2 flex -translate-y-1/2 -space-x-1.5" aria-hidden>
              {stack.map((s) => <StoreTile key={s.id} colorIndex={s.colorIndex} name={s.name} className="ring-2 ring-white" />)}
            </span>
            <span className="pointer-events-none absolute right-4 top-1/2 hidden -translate-y-1/2 text-[13px] text-muted sm:block" aria-hidden>8 NYC stores</span>
          </div>
          <p className="mt-5 text-[13px] leading-5 text-muted">Free to use. The sample chain opens without an account.</p>
        </Container>
      </div></div>
    </section>
  );
}

/** "Built on" strip: three honest cells under the hero (ByDefault's "trusted by" strip, without the claim). */
export function BuiltOnStrip() {
  const cells: Array<{ brand: Brand; title: string; body: string; href: string }> = [
    { brand: "qloo", title: "Qloo Taste AI", body: "The taste of each block, against the city", href: "https://www.qloo.com" },
    { brand: "nvidia", title: "NVIDIA Nemotron", body: "Plans, writes and reviews every edition", href: "https://www.nvidia.com/en-us/ai-data-science/foundation-models/nemotron/" },
    { brand: "nebius", title: "Nebius Token Factory", body: "Serves every model and the eval job", href: "https://nebius.com" },
  ];
  return (
    <div className="relative">
      <p className="px-6 py-6 text-center text-[16px] leading-6 text-ink-2 md:px-10">Built on the taste graph and the open models behind every edition</p>
      <Rule />
      <Container className="grid md:grid-cols-3">
        {cells.map((c, i) => (
          <Link
            key={c.brand} href={c.href} target="_blank" rel="noreferrer"
            className={cx(
              "group/cell relative flex h-24 items-center gap-3.5 pl-7 pr-8 transition-colors duration-150 hover:bg-white",
              i > 0 && "border-t border-rule md:border-l md:border-t-0",
            )}
          >
            <span className="flex size-7 shrink-0 items-center justify-center rounded-[7px] bg-white shadow-[0_0_0_1px_rgb(42_37_36/.08)]">
              <BrandGlyph brand={c.brand} className="size-4" />
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="block text-[16px] font-medium leading-5 text-ink">{c.title}</span>
              <span className="mt-0.5 block text-[16px] leading-5 text-stone-500">{c.body}</span>
            </span>
            <span className="absolute right-3.5 top-3.5 size-3.5 text-faint transition-[transform,color] duration-200 ease-quint group-hover/cell:-translate-y-0.5 group-hover/cell:translate-x-0.5 group-hover/cell:text-ink-2" aria-hidden>
              {Icon.arrowUpRight}
            </span>
          </Link>
        ))}
      </Container>
      <Rule />
    </div>
  );
}
