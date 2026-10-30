"use client";

import Link from "next/link";
import { useState } from "react";
import type { MenuItem, Store } from "@/contract";
import { Button, Chip, ErrorState, Notice, Skeleton, StoreTile } from "@/components/ui";
import { Icon } from "@/components/app-ui/icons";
import { LogoTile } from "@/components/app-ui/tiles";
import { useAsync } from "@/components/lib/use-async";
import { connect, loadSquare, runAction } from "@/components/connections/connections-api";
import { getApi } from "@/lib/api-client";
import { FallbackImport } from "./fallback-import";
import { MenuEditor } from "./menu-editor";

/** Step 1: the menu and the stores. Square first; a photo and a CSV for chains without it. */

const clock = () => new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

export function MenuStep({ menu, stores, onSaved, onStores, reloadWorkspace }: {
  menu: MenuItem[];
  stores: Store[];
  onSaved: (items: MenuItem[]) => void;
  onStores: (stores: Store[]) => void;
  reloadWorkspace: () => void;
}) {
  const api = getApi();
  const sq = useAsync("setup:square", loadSquare);
  const [draft, setDraft] = useState<MenuItem[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"sandbox" | "oauth" | "sync" | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const items = draft ?? menu;
  const connected = sq.data?.connection.status === "connected";

  const doConnect = async (method: "sandbox" | "oauth") => {
    setBusy(method);
    setError(null);
    try {
      const url = await connect("square", method);
      if (url) return window.location.assign(url);
      sq.reload();
      reloadWorkspace();
      setDraft(null);
      setNote("Square is connected. The menu and locations below came from it.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const doSync = async () => {
    setBusy("sync");
    try {
      setNote(await runAction("square"));
      sq.reload();
      reloadWorkspace();
      setDraft(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const saved = await api.putMenu(items.map((m) => ({ ...m, name: m.name.trim() })));
      onSaved(saved);
      setDraft(null);
      setSavedAt(clock());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid gap-5">
      <div className="grid gap-3 rounded-[14px] bg-white p-4 shadow-ring-md sm:p-5" data-testid="setup-square" data-status={sq.data?.connection.status ?? (sq.error ? "error" : "loading")}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="flex items-center gap-3"><LogoTile provider="square" size="lg" /><span><span className="block text-[16px] font-medium leading-6 text-ink">Square</span><span className="block text-[13px] text-muted">Menu and locations, synced by webhook</span></span></span>
          {sq.loading && !sq.data ? <Skeleton className="h-6 w-24" /> : connected ? (
            <span className="flex gap-1.5">
              {sq.data?.connection.mode === "sandbox" ? <Chip tone="warn">Sandbox</Chip> : null}
              <Chip tone="ok" dot>Connected</Chip>
            </span>
          ) : <Chip dot>Not connected</Chip>}
        </div>
        {sq.error && !sq.data ? (
          <ErrorState title="Square status did not load" message={sq.error.message} onRetry={sq.reload} className="py-4" />
        ) : connected && sq.data ? (
          <>
            <p className="text-[14px] leading-[22px] text-ink-2">
              <span className="font-medium text-ink">{sq.data.connection.accountLabel}</span>. {sq.data.menuItemCount} menu items and{" "}
              {sq.data.locations.length} locations come from Square, and stay in sync when the menu changes there.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button data-testid="setup-square-sync" size="sm" variant="primary" loading={busy === "sync"} onClick={doSync}>Sync now</Button>
              <Link href="/app/connections" className="inline-flex h-8 items-center gap-1 rounded-md px-2.5 text-[14px] font-medium text-ink-2 transition-colors hover:bg-hover-tint hover:text-ink">See the sync log<Icon name="arrowUpRight" size={14} /></Link>
            </div>
          </>
        ) : (
          <>
            <p className="text-[14px] leading-[22px] text-ink-2">
              Connect the point of sale your stores already use. Local Edition reads your menu and locations from it, and puts each
              approved special back on the right store&apos;s menu. Nothing to type.
            </p>
            <div className="flex flex-wrap gap-2">
              {sq.data?.sandboxAvailable !== false ? (
                <Button data-testid="setup-square-connect" variant="primary" size="sm" chevron loading={busy === "sandbox"} onClick={() => doConnect("sandbox")}>Connect the sample chain&apos;s Square sandbox</Button>
              ) : null}
              {sq.data?.oauthAvailable ? <Button data-testid="setup-square-connect-oauth" size="sm" loading={busy === "oauth"} onClick={() => doConnect("oauth")}>Connect your own Square</Button> : null}
            </div>
          </>
        )}
        {note ? <div data-testid="setup-square-note"><Notice tone="ok">{note}</Notice></div> : null}
      </div>

      <details className="group overflow-hidden rounded-xl bg-paper-2 shadow-ring-xs" open={!connected && !sq.loading && menu.length === 0 ? true : undefined}>
        <summary data-testid="setup-fallback-toggle" className="flex cursor-pointer list-none items-center gap-2 px-4 py-3.5 text-[14px] font-medium text-ink-strong transition-colors hover:bg-stone-100/60 [&::-webkit-details-marker]:hidden">
          <Icon name="chevronRight" size={14} className="text-faint transition-transform duration-200 group-open:rotate-90" />
          No Square? Use a photo of the menu board and a store list instead
        </summary>
        <div className="border-t border-rule-subtle bg-white p-4">
          <FallbackImport onMenu={(m) => { setDraft(m); setSavedAt(null); }} onStores={(s) => onStores([...stores, ...s])} />
        </div>
      </details>

      {error ? <div data-testid="setup-error"><Notice tone="flag">{error}</Notice></div> : null}

      <div className="grid gap-2">
        <h3 className="text-[16px] font-medium leading-6 text-ink">Menu</h3>
        <MenuEditor items={items} onChange={(m) => { setDraft(m); setSavedAt(null); }} onSave={save} saving={saving} savedAt={savedAt} />
      </div>

      <div className="grid gap-2">
        <h3 className="flex items-baseline gap-2 text-[16px] font-medium leading-6 text-ink">Stores <span className="text-[13px] font-normal text-muted tnum">{stores.length}</span></h3>
        {stores.length === 0 ? (
          <p className="rounded-lg bg-paper-2 px-4 py-5 text-center text-[14px] text-ink-2 shadow-[inset_0_0_0_1px_var(--rule-subtle)]">No stores yet. Connect Square or add a store list above.</p>
        ) : (
          <ul data-testid="setup-stores" data-count={stores.length} className="grid overflow-hidden rounded-lg bg-white shadow-ring-xs sm:grid-cols-2">
            {stores.map((s) => (
              <li key={s.id} className="flex min-w-0 items-center gap-3 border-b border-rule-row px-3.5 py-2.5 sm:odd:border-r">
                <StoreTile colorIndex={s.colorIndex} name={s.name} size="md" />
                <span className="min-w-0"><span className="block truncate text-[14px] font-medium text-ink-strong">{s.name}</span><span className="block truncate text-[13px] text-muted">{s.addressLabel}</span></span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
