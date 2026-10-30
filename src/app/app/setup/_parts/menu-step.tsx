"use client";

import Link from "next/link";
import { useState } from "react";
import type { MenuItem, Store } from "@/contract";
import { Button, Chip, ErrorState, Notice, ProviderBadge, Skeleton, StoreSwatch } from "@/components/ui";
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
      <div className="grid gap-3 rounded-[var(--radius)] border border-ink/15 bg-paper-2 p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <ProviderBadge provider="square" label="Square" className="text-[16px] font-semibold text-ink" />
          {sq.loading && !sq.data ? <Skeleton className="h-6 w-24" /> : connected ? (
            <span className="flex gap-1.5">
              {sq.data?.connection.mode === "sandbox" ? <Chip tone="warn" mono>Sandbox</Chip> : null}
              <Chip tone="ok" dot>Connected</Chip>
            </span>
          ) : <Chip dot>Not connected</Chip>}
        </div>
        {sq.error && !sq.data ? (
          <ErrorState title="Square status did not load" message={sq.error.message} onRetry={sq.reload} className="py-4" />
        ) : connected && sq.data ? (
          <>
            <p className="text-[14.5px] text-ink-2">
              <span className="font-mono text-[13px]">{sq.data.connection.accountLabel}</span>. {sq.data.menuItemCount} menu items and{" "}
              {sq.data.locations.length} locations come from Square, and stay in sync when the menu changes there.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="primary" loading={busy === "sync"} onClick={doSync}>Sync now</Button>
              <Link href="/app/connections" className="inline-flex h-8 items-center px-2 text-[13px] font-medium text-ink-2 underline underline-offset-4">See the sync log</Link>
            </div>
          </>
        ) : (
          <>
            <p className="text-[14.5px] text-ink-2">
              Connect the point of sale your stores already use. Local Edition reads your menu and locations from it, and puts each
              approved special back on the right store&apos;s menu. Nothing to type.
            </p>
            <div className="flex flex-wrap gap-2">
              {sq.data?.sandboxAvailable !== false ? (
                <Button variant="primary" loading={busy === "sandbox"} onClick={() => doConnect("sandbox")}>Connect the sample chain&apos;s Square sandbox</Button>
              ) : null}
              {sq.data?.oauthAvailable ? <Button loading={busy === "oauth"} onClick={() => doConnect("oauth")}>Connect your own Square</Button> : null}
            </div>
          </>
        )}
        {note ? <Notice tone="ok">{note}</Notice> : null}
      </div>

      <details className="group rounded-[var(--radius)] border border-rule" open={!connected && !sq.loading && menu.length === 0 ? true : undefined}>
        <summary className="cursor-pointer list-none px-4 py-3 text-[14px] font-medium text-ink-2">
          <span className="mr-1.5 inline-block transition-transform group-open:rotate-90" aria-hidden>›</span>
          No Square? Use a photo of the menu board and a store list instead
        </summary>
        <div className="border-t border-rule p-4">
          <FallbackImport onMenu={(m) => { setDraft(m); setSavedAt(null); }} onStores={(s) => onStores([...stores, ...s])} />
        </div>
      </details>

      {error ? <Notice tone="flag">{error}</Notice> : null}

      <div className="grid gap-2">
        <h3 className="font-display text-[18px] font-bold">Menu</h3>
        <MenuEditor items={items} onChange={(m) => { setDraft(m); setSavedAt(null); }} onSave={save} saving={saving} savedAt={savedAt} />
      </div>

      <div className="grid gap-2">
        <h3 className="font-display text-[18px] font-bold">Stores <span className="font-mono text-[13px] font-normal text-muted">{stores.length}</span></h3>
        {stores.length === 0 ? (
          <p className="text-[14px] text-muted">No stores yet. Connect Square or add a store list above.</p>
        ) : (
          <ul className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2 lg:grid-cols-3">
            {stores.map((s) => (
              <li key={s.id} className="flex min-w-0 items-baseline gap-2 text-[14px]">
                <StoreSwatch colorIndex={s.colorIndex} name={s.name} className="font-medium" />
                <span className="truncate text-[12.5px] text-muted">{s.addressLabel}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
