import Link from "next/link";

/** Public-site header and footer for the landing, privacy and terms pages. */

export const CONTACT_EMAIL = "defiusmaximus@gmail.com";

export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <Link href="/" className={`inline-flex items-baseline gap-2 text-(--ink) no-underline ${className}`} aria-label="Local Edition home">
      <span aria-hidden className="grid size-7 place-items-center self-center rounded-[6px] bg-(--ink) font-(family-name:--font-display) text-[15px] font-extrabold leading-none text-(--paper)">
        L
      </span>
      <span className="font-(family-name:--font-display) text-[19px] font-extrabold tracking-[-0.02em]">Local Edition</span>
    </Link>
  );
}

const NAV = [
  { href: "/#how", label: "How it works" },
  { href: "/#connects", label: "Connections" },
  { href: "/#built-on", label: "Built on" },
];

export function SiteHeader() {
  return (
    <header className="border-b border-(--rule) bg-(--paper)">
      <div className="mx-auto flex max-w-[1180px] items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <Wordmark />
        <nav aria-label="Site" className="flex items-center gap-1 text-[14px] sm:gap-5">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className="hidden text-(--ink-2) hover:text-(--ink) md:inline">
              {n.label}
            </Link>
          ))}
          <Link
            href="/app"
            className="rounded-(--radius) bg-(--accent) px-3 py-2 text-[14px] font-semibold text-(--accent-ink) hover:opacity-90"
          >
            Open the sample chain
          </Link>
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-(--rule) bg-(--paper-2)">
      <div className="mx-auto grid max-w-[1180px] gap-6 px-4 py-10 text-[14px] text-(--muted) sm:px-6 md:grid-cols-[1.4fr_1fr_1fr]">
        <div className="grid gap-2">
          <Wordmark />
          <p className="max-w-[46ch]">
            A weekly edition for every store in a chain, written from the taste of each store&apos;s block. Built for the Qloo
            and NVIDIA hackathons in October 2026.
          </p>
        </div>
        <div className="grid content-start gap-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-[0.09em]">Product</span>
          <Link href="/app" className="hover:text-(--ink)">Sample chain</Link>
          <Link href="/proof" className="hover:text-(--ink)">Proof</Link>
          <Link href="/limits" className="hover:text-(--ink)">Limits</Link>
        </div>
        <div className="grid content-start gap-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-[0.09em]">Legal</span>
          <Link href="/privacy" className="hover:text-(--ink)">Privacy</Link>
          <Link href="/terms" className="hover:text-(--ink)">Terms</Link>
          <a href={`mailto:${CONTACT_EMAIL}`} className="break-all hover:text-(--ink)">{CONTACT_EMAIL}</a>
        </div>
      </div>
    </footer>
  );
}

/** Page shell for public pages: header, main, footer. */
export function SiteShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-(--paper) font-(family-name:--font-body) text-(--ink)">
      <SiteHeader />
      <main className="flex-1">{children}</main>
      <SiteFooter />
    </div>
  );
}
