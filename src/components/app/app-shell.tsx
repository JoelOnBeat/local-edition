"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { AccountMenu } from "../account/account-menu";
import { StoreTile, cx } from "../ui";
import { Icon } from "../app-ui/icons";
import { StatusDot, WeekPicker, WorkspaceSwitcher } from "./shell-controls";
import { useWorkspace } from "./workspace-context";

const NAV = [
  { href: "/app", label: "Portfolio", id: "portfolio", match: (p: string) => p === "/app" || p.startsWith("/app/stores") || p.startsWith("/app/runs") },
  { href: "/app/compare", label: "Compare", id: "compare", match: (p: string) => p.startsWith("/app/compare") },
  { href: "/app/connections", label: "Connections", id: "connections", match: (p: string) => p.startsWith("/app/connections") },
  { href: "/proof", label: "Proof", id: "proof", match: (p: string) => p.startsWith("/proof") },
  { href: "/app/settings", label: "Settings", id: "settings", match: (p: string) => p.startsWith("/app/settings") || p.startsWith("/app/setup") },
];

/** The head-office frame (ByDefault header): logo, workspace, the five places a head office works, week and account. */
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "/app";
  const [scrolled, setScrolled] = useState(false);
  const [menu, setMenu] = useState(false);
  const { bundle } = useWorkspace();

  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 12);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMenu(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu]);

  return (
    <div className="flex min-h-dvh flex-col bg-paper">
      <header data-scrolled={scrolled || menu} className="sticky top-0 z-40">
        <div className="mx-auto w-full max-w-[1192px] border-rule px-2 pt-1.5 sm:px-3 xl:border-x">
          <div className="relative">
            <div className={cx("le-header-pill pointer-events-none absolute inset-0 rounded-2xl bg-white shadow-ring-md", menu && "!opacity-100")} aria-hidden />
            <div className="relative flex h-[52px] items-center gap-1.5 pl-3 pr-1.5 sm:pl-3.5 sm:pr-2">
              <Link href="/app" className="flex shrink-0 items-center rounded-md" aria-label="Local Edition, portfolio">
                <Image src="/brand/logo-light.svg" alt="Local Edition" width={107} height={22} priority className="hidden h-[22px] w-auto xl:block" />
                <Image src="/brand/mark-light.svg" alt="" width={22} height={22} priority className="size-[22px] xl:hidden" />
              </Link>
              <span className="mx-1 hidden h-5 w-px rotate-[18deg] bg-stone-300 sm:block" aria-hidden />
              <WorkspaceSwitcher />
              <nav aria-label="Head office" className="ml-3 hidden items-center gap-0.5 lg:flex">
                {NAV.map((n) => <NavLink key={n.href} item={n} active={n.match(pathname)} />)}
              </nav>
              <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
                <div className="hidden sm:block"><WeekPicker /></div>
                <AccountMenu />
                <button
                  type="button"
                  onClick={() => setMenu((m) => !m)}
                  aria-expanded={menu}
                  aria-controls="app-menu"
                  aria-label={menu ? "Close menu" : "Open menu"}
                  className="flex size-8 items-center justify-center rounded-md text-ink-2 transition-colors duration-150 hover:bg-hover-tint hover:text-ink lg:hidden"
                >
                  <Icon name={menu ? "x" : "menu"} strokeWidth={1.5} />
                </button>
              </div>
            </div>
            {menu ? (
              <div id="app-menu" className="le-pop relative border-t border-rule-subtle p-1.5 lg:hidden">
                <div className="px-1 pb-2 pt-1 sm:hidden"><WeekPicker block /></div>
                {NAV.map((n) => (
                  <Link
                    key={n.href}
                    href={n.href}
                    onClick={() => setMenu(false)}
                    aria-current={n.match(pathname) ? "page" : undefined}
                    className={cx("flex h-10 items-center rounded-[10px] px-2.5 text-[16px] text-stone-800 transition-colors hover:bg-hover-tint", n.match(pathname) && "bg-active-tint text-stone-950")}
                  >
                    {n.label}
                  </Link>
                ))}
                {bundle?.stores.length ? (
                  <>
                    <div className="mx-1 my-1.5 h-px bg-rule-subtle" />
                    <p className="px-2.5 pb-1 pt-1 text-[12px] font-medium text-ink-2">Stores</p>
                    <StoreLinks onPick={() => setMenu(false)} />
                  </>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </header>
      <main className="relative flex-1 pb-16">{children}</main>
    </div>
  );
}

function NavLink({ item, active }: { item: (typeof NAV)[number]; active: boolean }) {
  return (
    <Link
      href={item.href}
      data-testid={`nav-${item.id}`}
      aria-current={active ? "page" : undefined}
      className={cx(
        "rounded-md px-2.5 py-1.5 text-[15px] leading-5 transition-colors duration-150",
        active ? "bg-active-tint text-stone-950" : "text-stone-800 hover:bg-hover-tint",
      )}
    >
      {item.label}
    </Link>
  );
}

function StoreLinks({ onPick }: { onPick: () => void }) {
  const { bundle, editionForStore } = useWorkspace();
  const pathname = usePathname();
  return (
    <div className="grid gap-0.5 sm:grid-cols-2">
      {bundle?.stores.map((s) => {
        const status = editionForStore(s.id)?.status;
        const href = `/app/stores/${s.id}`;
        return (
          <Link key={s.id} href={href} onClick={onPick} className={cx("flex h-11 items-center gap-2.5 rounded-[10px] px-2.5 text-[15px] text-stone-800 hover:bg-hover-tint", pathname === href && "bg-active-tint")}>
            <StoreTile colorIndex={s.colorIndex} name={s.name} size="lg" />
            <span className="min-w-0 flex-1 truncate">{s.name}</span>
            <StatusDot status={status} />
          </Link>
        );
      })}
    </div>
  );
}
