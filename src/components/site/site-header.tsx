"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { StartLink } from "@/components/account/session-links";
import { useSession } from "@/components/account/session-context";
import { Chevron, Lockup, buttonClass, cx } from "@/components/ui";

export const NAV = [
  { href: "/#how-it-works", label: "How it works" },
  { href: "/#edition", label: "The edition" },
  { href: "/#integrations", label: "Integrations" },
  { href: "/proof", label: "Proof" },
  { href: "/limits", label: "Limits" },
];

/**
 * Sticky site header. At the top of the page it sits on the ground; after a few pixels of scroll a white rounded pill
 * fades in behind it. Below 768px the nav folds into a menu that grows inside the pill. Session-aware: signed out shows
 * "Sign in" + "Start free"; signed in or a guest shows one primary link back into the app.
 */
export function SiteHeader() {
  const { me } = useSession();
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 12);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const signedIn = Boolean(me?.session);
  return (
    <header className="sticky top-0 z-40 h-16">
      <div className="relative mx-auto max-w-[1190px] px-2 pt-1.5 sm:px-3 md:px-6">
        <div className="relative">
          <div
            aria-hidden
            className={cx(
              "pointer-events-none absolute inset-0 rounded-2xl bg-white shadow-ring-md transition-opacity duration-200 ease-quint",
              scrolled || open ? "opacity-100" : "opacity-0",
            )}
          />
          <div className="relative flex h-[52px] items-center gap-3 pl-3.5 pr-2.5 md:pr-2">
            <Link href="/" aria-label="Local Edition home" className="rounded-md transition-opacity hover:opacity-80" onClick={() => setOpen(false)}>
              <Lockup />
            </Link>
            <nav aria-label="Site" className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-1.5 lg:flex">
              {NAV.map((n) => (
                <Link key={n.href} href={n.href} className="rounded-md px-2.5 py-1.5 text-[16px] leading-6 text-stone-800 transition-colors duration-150 hover:bg-stone-900/[.04]">
                  {n.label}
                </Link>
              ))}
            </nav>
            <div className="ml-auto flex items-center gap-2">
              {signedIn ? (
                <StartLink data-testid="site-open-app" className={buttonClass("primary", "md", "h-9 text-[15px]")} />
              ) : (
                <>
                  <span className="hidden sm:contents"><StartLink data-testid="site-open-app" className={buttonClass("ghost", "sm", "h-8 px-3 text-[16px] font-normal text-stone-800 hover:bg-stone-900/[.04] hover:text-stone-800")} /></span>
                  <Link href="/signin" className={buttonClass("primary", "md", "h-9 gap-1.5 px-2.5 text-[16px]")}>
                    Start free<Chevron />
                  </Link>
                </>
              )}
              <button
                type="button"
                className="flex size-8 items-center justify-center rounded-md text-ink-2 transition-colors hover:bg-neutral-100 hover:text-ink lg:hidden"
                aria-expanded={open}
                aria-controls="site-menu"
                aria-label={open ? "Close menu" : "Open menu"}
                onClick={() => setOpen((v) => !v)}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden>
                  {open ? <path d="M4 4l8 8M12 4l-8 8" /> : <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" />}
                </svg>
              </button>
            </div>
          </div>
          {open ? (
            <div id="site-menu" className="le-label-in relative border-t border-rule-subtle p-1.5 lg:hidden">
              {NAV.map((n) => (
                <Link key={n.href} href={n.href} onClick={() => setOpen(false)} className="flex h-10 items-center rounded-[10px] px-2.5 text-[16px] text-ink-strong hover:bg-hover-tint">
                  {n.label}
                </Link>
              ))}
              {!signedIn ? (
                <>
                  <div className="mx-1 my-1.5 h-px bg-rule-subtle" />
                  <Link href="/signin" onClick={() => setOpen(false)} className="flex h-10 items-center rounded-[10px] px-2.5 text-[16px] text-ink-strong hover:bg-hover-tint">
                    Sign in
                  </Link>
                </>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
