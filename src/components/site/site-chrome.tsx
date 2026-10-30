import Link from "next/link";
import type { ReactNode } from "react";
import { SampleChainLink, StartLink } from "@/components/account/session-links";
import { BrandGlyph, LogoMark, Lockup, buttonClass, cx, type Brand } from "@/components/ui";
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

const ORBIT: Array<{ brand: Brand; x: number; y: number }> = [
  { brand: "qloo", x: -260, y: 96 },
  { brand: "nvidia", x: -130, y: 24 },
  { brand: "nebius", x: 0, y: 0 },
  { brand: "tavily", x: 130, y: 24 },
  { brand: "cloudflare", x: 260, y: 96 },
];

/** Dark closing band: an arc of the partners' marks over our tile, the last call to action. */
function ClosingCta() {
  return (
    <section className="relative overflow-hidden pt-20 md:pt-24" aria-labelledby="cta-title">
      <div aria-hidden className="pointer-events-none absolute left-1/2 top-[60px] -translate-x-1/2">
        {[904, 816, 732].map((d, i) => (
          <div key={d} className="absolute left-1/2 -translate-x-1/2 rounded-full border border-white/[.05]" style={{ width: d, height: d, top: i * 44 }} />
        ))}
      </div>
      <Container className="relative flex flex-col items-center px-4 text-center">
        <div className="relative h-[150px] w-full max-w-[600px] scale-[.62] sm:scale-100" aria-hidden>
          {ORBIT.map((o) => (
            <span
              key={o.brand}
              className="absolute left-1/2 top-0 flex size-[60px] -translate-x-1/2 items-center justify-center rounded-full bg-band-chip text-band-ink shadow-[0_0_0_1px_rgb(255_255_255/.06),0_8px_24px_rgb(0_0_0/.35)]"
              style={{ marginLeft: o.x, top: o.y }}
            >
              <BrandGlyph brand={o.brand} className="size-6" />
            </span>
          ))}
          <span className="absolute left-1/2 top-[98px] flex size-[53px] -translate-x-1/2 items-center justify-center rounded-[14px] bg-band-chip-2 shadow-[inset_0_1px_0_rgb(255_255_255/.08),0_0_0_1px_rgb(255_255_255/.04)]">
            <LogoMark size={26} dark />
          </span>
        </div>
        <h2 id="cta-title" className="mt-8 max-w-[640px] text-[32px] font-medium leading-[35.2px] tracking-[-0.02em] text-band-ink sm:text-[44px] sm:leading-[48.4px]">
          Give every store its own week.
        </h2>
        <p className="mt-3 max-w-[460px] text-[16px] leading-6 text-band-ink-2">Free to use. Open the sample chain first, or start with your own stores.</p>
        <div className="mt-8 flex flex-wrap justify-center gap-2.5 pb-14">
          <StartLink signedOutLabel="Get started" className={buttonClass("primary", "md")} />
          <SampleChainLink className={buttonClass("dark", "md")} signedOutLabel="Try the sample chain" />
        </div>
      </Container>
    </section>
  );
}

function FooterLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="text-[16px] leading-6 text-band-ink-2 transition-colors duration-150 hover:text-band-ink-hover">
      {children}
    </Link>
  );
}

export function SiteFooter({ cta = true }: { cta?: boolean }) {
  return (
    <footer className="band-dither relative mt-auto overflow-hidden text-band-ink">
      <Rails dark />
      {cta ? <ClosingCta /> : null}
      {cta ? <Rule dark /> : null}
      <Container className="relative grid gap-x-10 gap-y-12 px-6 pb-10 pt-14 md:grid-cols-[2.55fr_1fr_1.35fr] md:px-10">
        <div>
          <Lockup size="sm" dark />
          <p className="mt-5 max-w-[360px] text-[16px] leading-[26px] text-band-ink-2">
            A weekly edition for every store in a chain: a special, a sound brief, a neighbour to partner with and an event night,
            each written from the taste of the store&apos;s block and shipped with its evidence.
          </p>
        </div>
        <nav aria-label="Product" className="grid content-start gap-2">
          <p className="mb-2 text-[16px] font-medium leading-6 text-band-ink">Product</p>
          <FooterLink href="/#how-it-works">How it works</FooterLink>
          <FooterLink href="/#edition">The edition</FooterLink>
          <FooterLink href="/#integrations">Integrations</FooterLink>
          <FooterLink href="/proof">Proof</FooterLink>
          <FooterLink href="/limits">Limits</FooterLink>
        </nav>
        <nav aria-label="Legal" className="grid content-start gap-2">
          <p className="mb-2 text-[16px] font-medium leading-6 text-band-ink">Company</p>
          <FooterLink href="/privacy">Privacy</FooterLink>
          <FooterLink href="/terms">Terms</FooterLink>
          <FooterLink href="/signin">Sign in</FooterLink>
          <a href={`mailto:${CONTACT_EMAIL}`} className="break-all text-[16px] leading-6 text-band-ink-2 transition-colors hover:text-band-ink-hover">
            {CONTACT_EMAIL}
          </a>
        </nav>
      </Container>
      <Container className="relative -mb-[3.2%] px-0">
        <svg viewBox="0 0 1190 150" className="block w-full" aria-hidden>
          <text x="595" y="140" textAnchor="middle" textLength="1180" lengthAdjust="spacingAndGlyphs" fill="rgb(255 255 255 / .04)"
            style={{ font: "500 172px var(--font-geist), Geist, sans-serif", letterSpacing: "-0.02em" }}>
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

