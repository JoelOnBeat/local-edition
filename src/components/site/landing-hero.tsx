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
          <h1 className="max-w-[720px] text-[34px] font-medium leading-[1.12] tracking-[-0.02em] text-ink sm:text-[46px] sm:leading-[1.1] lg:text-[56px] lg:leading-[61.6px]">
            Every store&apos;s week, planned from <InlineChip brand="qloo" tilt="l">Qloo</InlineChip> taste and written by{" "}
            <InlineChip brand="nvidia" tilt="r" accent>Nemotron</InlineChip>
          </h1>
          <p className="mt-7 max-w-[440px] text-[17px] leading-6 text-ink-2 sm:text-[18px]">
            Each Monday, every location gets its own special, sound brief, local partner and event night, with the evidence behind each line.
          </p>

          <form action="/signin" method="get" className="mt-10 w-full max-w-[420px]">
            <div className="group/combo rounded-[14px] shadow-raised transition-shadow duration-150 focus-within:shadow-[0_0_0_2px_var(--accent)] hover:shadow-[0_0_0_1px_var(--stone-300),0_1px_2px_#00000014]">
              <div className="flex h-12 items-center rounded-[14px] bg-white">
                <span className="flex w-11 shrink-0 items-center justify-center text-faint [&_svg]:size-4" aria-hidden>{Icon.mail}</span>
                <label htmlFor="hero-email" className="sr-only">Work email</label>
                <input
                  id="hero-email" name="email" type="email" autoComplete="email" placeholder="you@yourchain.com"
                  className="h-full min-w-0 flex-1 bg-transparent pr-2 text-[15px] text-ink outline-none placeholder:text-muted"
                />
                <button
                  type="submit"
                  className={cx(
                    "group/btn mr-1.5 hidden h-9 shrink-0 items-center gap-1.5 rounded-lg pl-4 pr-3 text-[15px] font-medium text-white sm:inline-flex",
                    "bg-[linear-gradient(to_bottom,var(--accent-grad-top),var(--accent-grad-bot))] shadow-primary-lg transition-[background-image,scale] duration-150",
                    "hover:bg-[linear-gradient(to_bottom,var(--accent-grad-top-h),var(--accent-grad-bot-h))] active:scale-[.96]",
                  )}
                >
                  Get started<Chevron />
                </button>
              </div>
            </div>
            <button
              type="submit"
              className="group/btn mt-2.5 inline-flex h-12 w-full items-center justify-center gap-1.5 rounded-[12px] bg-[linear-gradient(to_bottom,var(--accent-grad-top),var(--accent-grad-bot))] text-[16px] font-medium text-white shadow-primary-lg active:scale-[.98] sm:hidden"
            >
              Get started, free<Chevron />
            </button>
          </form>

          <div className="mt-5 flex items-center gap-2">
            <span className="flex -space-x-1.5" aria-hidden>
              {stack.map((s) => <StoreTile key={s.id} colorIndex={s.colorIndex} name={s.name} className="ring-2 ring-white" />)}
            </span>
            <SampleChainLink
              data-testid="landing-open-app"
              signedOutLabel="Try the sample chain"
              className="text-[15px] font-medium text-ink-2 underline-offset-[3px] decoration-stone-300 transition-colors hover:text-ink hover:underline disabled:opacity-60"
            />
          </div>
          <p className="mt-3 text-[13px] leading-5 text-muted">Free to use. The sample chain opens without an account.</p>
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
      <p className="px-4 py-6 text-center text-[16px] leading-6 text-ink-2">Built on the taste graph and the open models behind every edition</p>
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
            <span className="flex size-7 shrink-0 items-center justify-center rounded-[7px] bg-white shadow-ring-xs">
              <BrandGlyph brand={c.brand} className="size-4" />
            </span>
            <span className="min-w-0">
              <span className="block text-[16px] font-medium leading-5 text-ink">{c.title}</span>
              <span className="mt-1 block truncate text-[16px] leading-5 text-ink-2">{c.body}</span>
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
