"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { IdentityBlock } from "../account/identity-block";
import { SampleBadge, cx } from "../ui";
import { Icon, type IconName } from "../app-ui/icons";
import { SidebarConnectors } from "./sidebar-connectors";
import { useWorkspace } from "./workspace-context";

interface NavItem { href: string; label: string; id: string; icon: IconName; match: (p: string) => boolean }

const GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: "Overview",
    items: [
      { href: "/app", label: "Portfolio", id: "portfolio", icon: "grid", match: (p) => p === "/app" || p.startsWith("/app/stores") },
      { href: "/app/compare", label: "Compare", id: "compare", icon: "columns", match: (p) => p.startsWith("/app/compare") },
    ],
  },
  {
    label: "Work",
    items: [
      { href: "/app/runs", label: "Runs", id: "runs", icon: "terminal", match: (p) => p.startsWith("/app/runs") },
      { href: "/app/connections", label: "Connections", id: "connections", icon: "plug", match: (p) => p.startsWith("/app/connections") },
    ],
  },
  {
    label: "Proof",
    items: [
      { href: "/app/proof", label: "Proof", id: "proof", icon: "shield", match: (p) => p.startsWith("/app/proof") },
      { href: "/app/limits", label: "Limits", id: "limits", icon: "gauge", match: (p) => p.startsWith("/app/limits") },
    ],
  },
  {
    label: "Help",
    items: [
      { href: "/app/how-it-works", label: "How it works", id: "how-it-works", icon: "layers", match: (p) => p.startsWith("/app/how-it-works") },
      { href: "/app/help", label: "Help", id: "help", icon: "info", match: (p) => p.startsWith("/app/help") },
    ],
  },
];

/** The head-office app frame: a grouped sidebar (a drawer on phones) with the one identity block at the bottom left. */
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "/app";
  const [open, setOpen] = useState(false);
  const { bundle } = useWorkspace();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <div className="min-h-dvh bg-paper">
      <aside aria-label="App" className="fixed inset-y-0 left-0 z-30 hidden w-[248px] border-r border-rule bg-paper lg:block">
        <SidebarBody pathname={pathname} />
      </aside>

      {/* Phones and tablets: a slim bar with the menu button; the sidebar opens as a drawer. */}
      <div className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-rule bg-paper/90 px-3 backdrop-blur lg:hidden">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open menu"
          aria-expanded={open}
          className="flex size-9 items-center justify-center rounded-md text-ink-2 transition-colors hover:bg-hover-tint hover:text-ink"
        >
          <Icon name="menu" strokeWidth={1.5} />
        </button>
        <Link href="/app" className="flex items-center" aria-label="Local Edition, portfolio">
          <Image src="/brand/logo-light.svg" alt="Local Edition" width={107} height={22} priority className="h-[22px] w-auto" />
        </Link>
        {bundle?.chain.isSample ? <SampleBadge className="ml-auto" /> : null}
      </div>
      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="le-fade absolute inset-0 bg-black/40" onClick={() => setOpen(false)} aria-hidden />
          <div className="le-drawer-left absolute inset-y-2 left-2 w-[min(288px,calc(100vw-48px))] overflow-hidden rounded-2xl bg-paper shadow-ring-lg">
            <button type="button" onClick={() => setOpen(false)} aria-label="Close menu" className="absolute right-2.5 top-3.5 z-10 flex size-8 items-center justify-center rounded-md text-ink-2 hover:bg-hover-tint">
              <Icon name="x" strokeWidth={1.5} />
            </button>
            <SidebarBody pathname={pathname} onNavigate={() => setOpen(false)} />
          </div>
        </div>
      ) : null}

      <main className="relative flex min-h-dvh flex-col lg:pl-[248px]">{children}</main>
    </div>
  );
}

function SidebarBody({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-16 shrink-0 items-center px-5">
        <Link href="/app" onClick={onNavigate} className="flex items-center rounded-md" aria-label="Local Edition, portfolio">
          <Image src="/brand/logo-light.svg" alt="Local Edition" width={107} height={22} priority className="h-[22px] w-auto" />
        </Link>
      </div>
      <nav aria-label="Head office" className="min-h-0 flex-1 overflow-y-auto px-3 pb-3 no-scrollbar">
        {GROUPS.map((g) => (
          <div key={g.label} className="pt-3 first:pt-1">
            <p className="px-2.5 pb-1 text-[12px] font-medium leading-4 text-ink-2">{g.label}</p>
            <ul className="grid gap-0.5">
              {g.items.map((n) => {
                const active = n.match(pathname);
                return (
                  <li key={n.href}>
                    <Link
                      href={n.href}
                      onClick={onNavigate}
                      data-testid={`nav-${n.id}`}
                      aria-current={active ? "page" : undefined}
                      className={cx(
                        "flex h-[34px] items-center gap-2.5 rounded-lg px-2.5 text-[14px] leading-5 transition-colors duration-150",
                        active ? "bg-active-tint font-medium text-stone-950" : "text-stone-800 hover:bg-hover-tint",
                      )}
                    >
                      <Icon name={n.icon} className={active ? "text-ink" : "text-faint"} />
                      {n.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
      <div className="shrink-0 border-t border-rule px-3 pb-3 pt-3">
        <SidebarConnectors onNavigate={onNavigate} />
        <IdentityBlock onNavigate={onNavigate} />
      </div>
    </div>
  );
}
