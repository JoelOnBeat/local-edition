"use client";

import { useRef, useState } from "react";
import type { MenuItem } from "@/contract";
import { ErrorLine } from "@/components/account/plain";
import { connect } from "@/components/connections/connections-api";
import { toShownError, type ShownError } from "@/components/lib/use-async";
import { getApi } from "@/lib/api-client";
import type { StepProps } from "../step-props";

/** Menu source: connect Square (the menu comes from the POS), or read a photo of the menu board and save what was read. */
export function MenuStep({ bundle, refresh }: StepProps) {
  const api = getApi();
  const photo = useRef<HTMLInputElement>(null);
  const [read, setRead] = useState<MenuItem[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<ShownError | undefined>();

  const run = async (what: string, fn: () => Promise<void>) => {
    setBusy(what);
    setError(undefined);
    setNote(null);
    try {
      await fn();
    } catch (e) {
      setError(toShownError(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <p data-testid="menu-count">{bundle.menu.length} menu items saved.</p>
      <h3>Connect Square</h3>
      <button
        data-testid="menu-connect-square"
        type="button"
        disabled={busy !== null}
        onClick={() => run("square", async () => {
          const url = await connect("square", "sandbox");
          if (url) return void window.location.assign(url);
          setNote("Square is connected; the menu and locations were imported.");
          refresh();
        })}
      >
        Connect Square (sandbox)
      </button>
      <h3>Or read a photo of the menu board</h3>
      <input data-testid="menu-photo" ref={photo} type="file" accept="image/jpeg,image/png,image/webp" disabled={busy !== null}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void run("photo", async () => { setRead(await api.readMenu(file)); });
        }} />
      {read ? (
        <div data-testid="menu-read" data-count={read.length}>
          <p>Read {read.length} items.</p>
          <ul>{read.map((m) => <li key={m.id}>{m.name}{m.price !== null ? ` - $${m.price}` : ""}</li>)}</ul>
          <button data-testid="menu-save" type="button" disabled={busy !== null}
            onClick={() => run("save", async () => { await api.putMenu(read); setRead(null); setNote("Menu saved."); refresh(); })}>
            Save this menu
          </button>
        </div>
      ) : null}
      {busy ? <p data-testid="menu-busy">Working on {busy}...</p> : null}
      {note ? <p data-testid="menu-note">{note}</p> : null}
      <ErrorLine error={error} testId="menu-error" />
    </div>
  );
}
