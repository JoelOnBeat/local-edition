"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Chip, cx, Skeleton } from "../ui";
import { formatDate, previousWeeks } from "../lib/format";
import { useWorkspace } from "./workspace-context";

const NAV = [
  { href: "/app", label: "Portfolio", match: (p: string) => p === "/app" || p.startsWith("/app/stores") || p.startsWith("/app/runs") },
  { href: "/app/compare", label: "Compare", match: (p: string) => p.startsWith("/app/compare") },
  { href: "/app/setup", label: "Setup", match: (p: string) => p.startsWith("/app/setup") },
  { href: "/app/connections", label: "Connections", match: (p: string) => p.startsWith("/app/connections") },
  { href: "/proof", label: "Proof", match: (p: string) => p.startsWith("/proof") },
];

/** The head-office frame: chain, week, and the five places a head office works. */
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "/app";
  const { bundle, loading } = useWorkspace();
  const chainName = bundle?.chain.name ?? "";
  const sample = bundle?.chain.isSample ?? false;
  const shortName = chainName.replace(/\s*\(sample chain\)\s*$/i, "");

  return (
    <div className="flex min-h-dvh flex-col bg-paper">
      <header className="sticky top-0 z-30 border-b border-rule bg-[color-mix(in_oklab,var(--paper)_92%,transparent)] backdrop-blur">
        <div className="mx-auto flex w-full max-w-[1320px] flex-wrap items-center gap-x-4 gap-y-2 px-4 pt-3 sm:px-6">
          <Link href="/" className="font-display text-[17px] font-bold tracking-tight text-ink">
            Local&nbsp;Edition
          </Link>
          <span className="text-rule" aria-hidden>/</span>
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {loading ? (
              <Skeleton className="h-4 w-44" />
            ) : (
              <>
                <span className="truncate text-[15px] font-medium text-ink" title={chainName}>{shortName || "Your chain"}</span>
                {sample ? <span className="hidden sm:inline"><Chip tone="warn">Sample chain</Chip></span> : null}
              </>
            )}
          </div>
          <WeekSelect />
        </div>
        <nav aria-label="Head office" className="mx-auto w-full max-w-[1320px] overflow-x-auto px-4 sm:px-6">
          <ul className="flex min-w-max gap-5 pt-2">
            {NAV.map((n) => {
              const active = n.match(pathname);
              return (
                <li key={n.href}>
                  <Link
                    href={n.href}
                    aria-current={active ? "page" : undefined}
                    className={cx(
                      "-mb-px inline-block border-b-2 pb-2 text-[14px] transition-colors",
                      active ? "border-ink font-semibold text-ink" : "border-transparent text-muted hover:text-ink",
                    )}
                  >
                    {n.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </header>
      <main className="mx-auto w-full max-w-[1320px] flex-1 px-4 pb-16 pt-6 sm:px-6">{children}</main>
    </div>
  );
}

function WeekSelect() {
  const { currentWeek, week, setWeek, loading } = useWorkspace();
  if (loading) return <Skeleton className="h-8 w-36" />;
  const weeks = previousWeeks(currentWeek, 4);
  return (
    <label className="relative inline-flex items-center">
      <span className="sr-only">Week</span>
      <select
        value={week}
        onChange={(e) => setWeek(e.target.value)}
        className="h-8 appearance-none rounded-[var(--radius)] border border-rule bg-paper pl-3 pr-8 text-[13px] font-medium text-ink hover:border-ink-2"
      >
        {weeks.map((w, i) => (
          <option key={w} value={w}>
            {i === 0 ? "This week" : `w/c ${formatDate(w, { year: false })}`}
          </option>
        ))}
      </select>
      <svg className="pointer-events-none absolute right-2.5 h-3 w-3 text-muted" viewBox="0 0 12 12" aria-hidden>
        <path d="M2.5 4.5 6 8l3.5-3.5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
      </svg>
    </label>
  );
}
