import Link from "next/link";
import type { ReactNode } from "react";
import { LogoMark, cx } from "@/components/ui";
import { AuthVisual } from "./auth-visual";
import { Icon } from "./section";

function Joint({ className }: { className: string }) {
  return (
    <svg width="25" height="25" viewBox="0 0 25 25" className={cx("absolute hidden sm:block", className)} aria-hidden>
      <rect width="25" height="25" fill="var(--paper)" />
      <path d="M12.5 4v17M4 12.5h17" stroke="#E7E5E4" />
    </svg>
  );
}

/**
 * Full-screen auth layout (no site header or footer): the form column on the left, framed by rails and hairlines like
 * ByDefault's sign-in, and the product visual on the right from 1024px.
 */
export function AuthLayout({ title, lede, children, below }: { title: string; lede?: ReactNode; children: ReactNode; below?: ReactNode }) {
  return (
    <div className="grid min-h-svh bg-paper lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="relative flex min-h-svh min-w-0 flex-col overflow-hidden">
        <div aria-hidden className="pointer-events-none absolute inset-y-0 left-1/2 hidden w-[560px] -translate-x-1/2 border-x border-stone-200 sm:block" />
        <div className="relative flex h-14 items-center px-4 sm:px-6">
          <Link href="/" className="-ml-2.5 inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[14px] text-ink-2 transition-colors duration-150 hover:bg-hover-tint hover:text-ink">
            <span className="size-4" aria-hidden>{Icon.arrowLeft}</span>Back to home
          </Link>
        </div>
        <main className="relative mx-auto flex w-full max-w-[560px] flex-1 flex-col justify-center pb-20 pt-4">
          <Link href="/" aria-label="Local Edition home" className="mx-auto inline-flex items-center gap-2 rounded-md">
            <LogoMark size={22} />
            <span className="text-[16px] font-medium leading-6 tracking-tight text-ink">Local Edition</span>
          </Link>
          <div className="relative mt-8 sm:border-y sm:border-stone-200 sm:p-3">
            <span aria-hidden className="absolute -top-px right-[calc(100%+12px)] hidden h-px w-[50vw] bg-stone-200 sm:block" />
            <span aria-hidden className="absolute -top-px left-[calc(100%+12px)] hidden h-px w-[50vw] bg-stone-200 sm:block" />
            <span aria-hidden className="absolute -bottom-px right-[calc(100%+12px)] hidden h-px w-[50vw] bg-stone-200 sm:block" />
            <span aria-hidden className="absolute -bottom-px left-[calc(100%+12px)] hidden h-px w-[50vw] bg-stone-200 sm:block" />
            <Joint className="-left-[12.5px] top-0 -translate-y-1/2" />
            <Joint className="-right-[12.5px] top-0 -translate-y-1/2" />
            <Joint className="-left-[12.5px] bottom-0 translate-y-1/2" />
            <Joint className="-right-[12.5px] bottom-0 translate-y-1/2" />
            <div className="ring-after relative mx-2 rounded-xl bg-white px-4 py-10 sm:mx-0 sm:px-[60px]">
              <h1 className="text-[20px] font-medium leading-7 tracking-[-0.02em] text-ink [text-wrap:balance]">{title}</h1>
              {lede ? <p className="mt-1 text-[14px] leading-5 text-ink-2">{lede}</p> : null}
              <div className="mt-7">{children}</div>
            </div>
          </div>
          <div className="mt-6 grid justify-items-center gap-3 px-6 text-center text-[14px] leading-5 text-muted">{below}</div>
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
