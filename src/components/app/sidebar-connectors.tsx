"use client";

import Link from "next/link";
import type { Connection } from "@/contract";
import { getApi } from "@/lib/api-client";
import { cx } from "../ui";
import { LogoTile, PROVIDER_NAME } from "../app-ui/tiles";
import { useAsync } from "../lib/use-async";

const DOT: Record<Connection["status"], string> = {
  connected: "bg-ok",
  connecting: "bg-warn",
  error: "bg-flag",
  not_connected: "bg-stone-300",
};
const WORD: Record<Connection["status"], string> = { connected: "connected", connecting: "connecting", error: "needs attention", not_connected: "not connected" };

/** Each tool's status at a glance, above the identity block: its official tile with a status dot. */
export function SidebarConnectors({ onNavigate }: { onNavigate?: () => void }) {
  const q = useAsync("sidebar:connections", () => getApi().getConnections());
  const list = (q.data?.connections ?? []).filter((c) => c.provider !== "eventbrite");
  const on = list.filter((c) => c.status === "connected").length;
  return (
    <Link
      href="/app/connections"
      onClick={onNavigate}
      data-testid="sidebar-connectors"
      className="mb-2 flex items-center gap-2 rounded-xl px-2.5 py-2 transition-colors duration-150 hover:bg-hover-tint"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-[12px] font-medium leading-4 text-ink-2">Tools</span>
        <span className="block text-[12px] leading-4 text-muted tnum">
          {q.data ? `${on} of ${list.length} connected` : q.error ? "Status unavailable" : "Checking…"}
        </span>
      </span>
      <span className="flex items-center -space-x-1">
        {list.map((c) => (
          <span key={c.provider} className="relative" title={`${PROVIDER_NAME[c.provider]}: ${WORD[c.status]}`} data-status={c.status}>
            <LogoTile provider={c.provider} size="sm" className={cx("ring-2 ring-paper", c.status !== "connected" && "opacity-60 grayscale")} />
            <span className={cx("absolute -right-0.5 -top-0.5 size-2 rounded-full ring-2 ring-paper", DOT[c.status])} aria-hidden />
          </span>
        ))}
      </span>
    </Link>
  );
}
