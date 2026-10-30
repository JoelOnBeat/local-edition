"use client";

import { useState } from "react";
import type { MenuItem } from "@/contract";
import { ErrorLine } from "@/components/account/plain";
import { connect } from "@/components/connections/connections-api";
import { Button, Notice, cx } from "@/components/ui";
import { Dropzone, type DropFile } from "@/components/app-ui/form-dropzone";
import { Segmented } from "@/components/app-ui/form-segmented";
import { Icon } from "@/components/app-ui/icons";
import { LogoTile } from "@/components/app-ui/tiles";
import { toShownError, type ShownError } from "@/components/lib/use-async";
import { getApi } from "@/lib/api-client";
import type { StepProps } from "../step-props";

/** Menu source: connect Square (the menu comes from the POS), or read a photo of the menu board and save what was read. */
export function MenuStep({ bundle, refresh }: StepProps) {
  const api = getApi();
  const [source, setSource] = useState<"square" | "photo">(bundle.menu.some((m) => m.source === "vl") ? "photo" : "square");
  const [read, setRead] = useState<MenuItem[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<ShownError | undefined>();
  const [file, setFile] = useState<DropFile | null>(null);

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
  const readFile = (f: File) => {
    setSource("photo");
    setRead(null);
    setFile({ name: f.name, size: f.size, detail: "Reading the menu board…" });
    void run("photo", async () => {
      try {
        const items = await api.readMenu(f);
        setRead(items);
        setFile({ name: f.name, size: f.size, detail: `Read ${items.length} items`, tone: "ok" });
      } catch (e) {
        setFile({ name: f.name, size: f.size, detail: "Could not read this photo", tone: "flag" });
        throw e;
      }
    });
  };

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented label="Menu source" value={source} onChange={setSource} options={[
          { value: "square", label: <><LogoTile provider="square" size="xs" />Square</> },
          { value: "photo", label: <><Icon name="image" size={14} />Menu photo</> },
        ]} />
        <p data-testid="menu-count" className="text-[13px] text-muted tnum">{bundle.menu.length} menu items saved</p>
      </div>

      {source === "square" ? (
        <div className="flex flex-wrap items-center gap-4 rounded-[14px] bg-white p-4 shadow-ring-md">
          <LogoTile provider="square" size="lg" />
          <div className="min-w-0 flex-1">
            <p className="text-[16px] font-medium leading-6 text-ink">Connect Square</p>
            <p className="text-[14px] leading-5 text-ink-2">Menu and locations come in from the point of sale and stay in sync by webhook.</p>
          </div>
          <Button
            data-testid="menu-connect-square"
            variant="primary"
            size="sm"
            chevron
            loading={busy === "square"}
            disabled={busy !== null}
            onClick={() => run("square", async () => {
              const url = await connect("square", "sandbox");
              if (url) return void window.location.assign(url);
              setNote("Square is connected; the menu and locations were imported.");
              refresh();
            })}
          >
            Connect Square (sandbox)
          </Button>
        </div>
      ) : null}

      <div hidden={source !== "photo"}>
        <Dropzone
          inputTestId="menu-photo"
          accept="image/jpeg,image/png,image/webp"
          icon="image"
          title="Drop a menu photo, or click to choose one"
          hint="JPG, PNG or WebP. Nemotron Super VL reads every item and price."
          busy={busy === "photo"}
          busyLabel="Reading the menu board…"
          disabled={busy !== null}
          onFile={readFile}
          file={file}
          onRemove={busy === "photo" ? undefined : () => { setFile(null); setRead(null); }}
        />
      </div>

      {read ? (
        <div data-testid="menu-read" data-count={read.length} className="overflow-hidden rounded-xl bg-paper-2 p-1 pt-0 shadow-ring-xs">
          <p className="flex items-center justify-between px-3 pb-2.5 pt-3 text-[14px] font-medium text-ink-strong">
            Read {read.length} items<span className="text-[13px] font-normal text-muted">Check them, then save</span>
          </p>
          <ul className="max-h-[280px] overflow-y-auto rounded-lg bg-white shadow-ring-xs">
            {read.map((m) => (
              <li key={m.id} className="flex items-center gap-3 border-b border-rule-row px-3.5 py-2.5 text-[14px] last:border-0">
                <span className="min-w-0 flex-1 truncate font-medium text-ink-strong">{m.name}</span>
                <span className={cx("shrink-0 tnum", m.priceLegible === false ? "rounded bg-warn-bg px-1.5 text-warn-ink" : "text-ink-2")}>{m.price !== null ? `$${m.price.toFixed(2)}` : "—"}</span>
              </li>
            ))}
          </ul>
          <div className="px-2 pb-1.5 pt-2.5">
            <Button data-testid="menu-save" variant="primary" size="sm" disabled={busy !== null} loading={busy === "save"}
              onClick={() => run("save", async () => { await api.putMenu(read); setRead(null); setNote("Menu saved."); refresh(); })}>
              Save this menu
            </Button>
          </div>
        </div>
      ) : null}

      {busy ? <p data-testid="menu-busy" className="sr-only">Working on {busy}...</p> : null}
      {note ? <div data-testid="menu-note"><Notice tone="ok">{note}</Notice></div> : null}
      <ErrorLine error={error} testId="menu-error" />
    </div>
  );
}
