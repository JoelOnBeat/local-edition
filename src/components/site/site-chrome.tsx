import Link from "next/link";
import type { ReactNode } from "react";
import { SampleChainLink, StartLink } from "@/components/account/session-links";
import { BrandGlyph, LogoMark, buttonClass, cx, type Brand } from "@/components/ui";
import { Container, Rule } from "./section";
import { SiteHeader } from "./site-header";

/** Public-site chrome for the landing, privacy and terms pages. */

export const CONTACT_EMAIL = "defiusmaximus@gmail.com";

/** The two hairline rails at ±596px that run behind the page (xl only). */
export function Rails({ dark }: { dark?: boolean }) {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 hidden xl:block">
      <div className={cx("mx-auto h-full w-[1192px] border-x", dark ? "border-band-rail" : "border-rule")} />
    </div>
  );
}

const ARC: Array<{ brand: Brand; cls: string; glyph: string }> = [
  { brand: "qloo", cls: "hidden sm:flex translate-y-[45px] md:translate-y-[94px]", glyph: "size-[22px] md:size-[26px]" },
  { brand: "nvidia", cls: "flex translate-y-[10px] md:translate-y-[21px]", glyph: "size-6 md:size-[30px]" },
  { brand: "nebius", cls: "flex", glyph: "size-6 md:size-[30px]" },
  { brand: "tavily", cls: "flex translate-y-[10px] md:translate-y-[21px]", glyph: "size-6 md:size-[30px]" },
  { brand: "cloudflare", cls: "hidden sm:flex translate-y-[45px] md:translate-y-[94px]", glyph: "size-[22px] md:size-[26px]" },
];

/** [diameter, top, mobile] of the three concentric circles behind the CTA. */
const CIRCLES: Array<[number, number, boolean]> = [[904, 59, false], [816, 103, false], [732, 145, false], [452, 66, true], [408, 88, true], [366, 109, true]];

/** Dark closing band: an arc of the partners' marks over our tile, the last call to action. */
function ClosingCta() {
  return (
    <section className="relative isolate overflow-hidden" aria-labelledby="cta-title">
      <div aria-hidden className="pointer-events-none absolute inset-0">
        {CIRCLES.map(([d, t, mobile]) => (
          <div key={`${d}-${t}`} className={cx("absolute left-1/2 -translate-x-1/2 rounded-full border border-white/[.05]", mobile ? "md:hidden" : "hidden md:block")} style={{ width: d, height: d, top: t }} />
        ))}
      </div>
      <Container className="relative flex flex-col items-center px-6 pb-16 pt-16 text-center md:px-10 md:pb-[72px] md:pt-[73px]">
        <div className="relative w-full" aria-hidden>
          <div className="flex items-start justify-center gap-4 md:gap-[70px]">
            {ARC.map((a) => (
              <span
                key={a.brand}
                className={cx(
                  "size-12 shrink-0 items-center justify-center rounded-full bg-band-chip text-[#E4E4E7] shadow-[0_0_0_1px_rgb(255_255_255/.06),0_18px_47px_rgb(0_0_0/.25),0_4px_10px_rgb(0_0_0/.2)] md:size-[60px]",
                  a.cls,
                )}
              >
                <BrandGlyph brand={a.brand} className={a.glyph} />
              </span>
            ))}
          </div>
          <div className="mt-6 flex justify-center md:mt-[67px]">
            <span className="flex size-[53px] items-center justify-center rounded-[14px] bg-band-chip-2 shadow-[inset_0_1px_0_rgb(255_255_255/.08),0_0_0_1px_rgb(255_255_255/.08),0_17px_23px_rgb(0_0_0/.25)]">
              <LogoMark size={28} dark />
            </span>
          </div>
        </div>
        <h2 id="cta-title" className="mt-7 max-w-[732px] text-[36px] font-medium leading-[41.4px] tracking-[-0.02em] text-zinc-100 [text-wrap:balance] md:text-[44px] md:leading-[47.52px]">
          Give every store its own week.
        </h2>
        <div className="mt-12 flex flex-wrap justify-center gap-2.5">
          <StartLink signedOutLabel="Start free" className={buttonClass("primary", "sm", "gap-1.5")} />
          <SampleChainLink className={buttonClass("dark", "sm")} signedOutLabel="Try the sample chain" />
        </div>
      </Container>
    </section>
  );
}

function FooterLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <li>
      <Link href={href} className="text-[16px] leading-6 text-[#9F9FA9] transition-colors duration-150 ease-quint hover:text-white">
        {children}
      </Link>
    </li>
  );
}

export function SiteFooter({ cta = true }: { cta?: boolean }) {
  return (
    <footer className="band-dither relative mt-auto overflow-hidden text-band-ink">
      <Rails dark />
      {cta ? <ClosingCta /> : null}
      {cta ? <Rule dark /> : null}
      <Container className="relative grid gap-x-10 gap-y-12 px-6 pb-12 pt-14 md:grid-cols-[2.55fr_1fr_1.35fr] md:px-10">
        <div>
          <span className="inline-flex items-center gap-2">
            <LogoMark size={22} dark />
            <span className="text-[16px] font-medium leading-6 tracking-tight text-white">Local Edition</span>
          </span>
          <p className="mt-4 max-w-[380px] text-[16px] leading-[26px] text-[#9F9FA9] [text-wrap:pretty]">
            A weekly edition for every store in a chain: a special, a sound brief, a neighbour to partner with and an event night,
            each written from the taste of the store&apos;s block and shipped with its evidence.
          </p>
        </div>
        <nav aria-label="Product">
          <h3 className="text-[16px] font-medium leading-6 text-white">Product</h3>
          <ul className="mt-5 space-y-2">
            <FooterLink href="/#how-it-works">How it works</FooterLink>
            <FooterLink href="/#edition">The edition</FooterLink>
            <FooterLink href="/#integrations">Integrations</FooterLink>
            <FooterLink href="/proof">Proof</FooterLink>
            <FooterLink href="/limits">Limits</FooterLink>
          </ul>
        </nav>
        <nav aria-label="Legal">
          <h3 className="text-[16px] font-medium leading-6 text-white">Legal</h3>
          <ul className="mt-5 space-y-2">
            <FooterLink href="/privacy">Privacy</FooterLink>
            <FooterLink href="/terms">Terms</FooterLink>
            <FooterLink href="/signin">Sign in</FooterLink>
            <li>
              <a href={`mailto:${CONTACT_EMAIL}`} className="break-all text-[16px] leading-6 text-[#9F9FA9] transition-colors duration-150 ease-quint hover:text-white">
                {CONTACT_EMAIL}
              </a>
            </li>
          </ul>
        </nav>
      </Container>
      <Container className="relative px-0">
        <svg viewBox="0 0 1190 161" className="block h-auto w-full" aria-hidden>
          <text x="595" y="196" textAnchor="middle" textLength="1186" lengthAdjust="spacingAndGlyphs" fill="rgb(255 255 255 / .04)"
            style={{ font: "600 228px var(--font-geist), Geist, sans-serif", letterSpacing: "-0.02em" }}>
            LOCAL EDITION
          </text>
        </svg>
      </Container>
    </footer>
  );
}

/** Page shell for public pages: rails, sticky header, main, dark footer. */
export function SiteShell({ children, cta = true }: { children: ReactNode; cta?: boolean }) {
  return (
    <div className="relative flex min-h-dvh flex-col overflow-x-clip bg-paper text-ink">
      <Rails />
      <SiteHeader />
      <main className="relative flex-1">{children}</main>
      <SiteFooter cta={cta} />
    </div>
  );
}

