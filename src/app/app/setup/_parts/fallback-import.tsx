"use client";

import { useRef, useState } from "react";
import type { MenuItem, Store } from "@/contract";
import { Button, Notice, Spinner } from "@/components/ui";
import { getApi } from "@/lib/api-client";

/** For chains without Square: a photo of the menu board read by Nemotron VL, and a store list as CSV. */

const MAX_BYTES = 5 * 1024 * 1024;
const CSV_EXAMPLE = "name,address,lat,lon\nWilliamsburg,Bedford Ave & N 7th St,40.7175,-73.9573\nPark Slope,7th Ave & 9th St,40.6683,-73.9806";

export function FallbackImport({ onMenu, onStores }: { onMenu: (items: MenuItem[]) => void; onStores: (stores: Store[]) => void }) {
  const api = getApi();
  const photoRef = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState<string | null>(null);
  const [photoMsg, setPhotoMsg] = useState<{ tone: "ok" | "flag"; text: string } | null>(null);
  const [csv, setCsv] = useState("");
  const [importing, setImporting] = useState(false);
  const [csvMsg, setCsvMsg] = useState<{ tone: "ok" | "flag"; text: string } | null>(null);

  const readPhoto = async (file: File | undefined) => {
    if (!file) return;
    setPhotoMsg(null);
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return setPhotoMsg({ tone: "flag", text: "Use a JPG, PNG or WebP photo." });
    if (file.size > MAX_BYTES) return setPhotoMsg({ tone: "flag", text: "That photo is over 5 MB. Take it again at a lower resolution." });
    setReading(file.name);
    try {
      const items = await api.readMenu(file);
      onMenu(items);
      const check = items.filter((m) => m.priceLegible === false || m.seen === false).length;
      setPhotoMsg({ tone: "ok", text: `Read ${items.length} items from the photo.${check ? ` ${check} marked amber: check those prices.` : ""} Review them below, then save.` });
    } catch (e) {
      setPhotoMsg({ tone: "flag", text: (e as Error).message || "The photo could not be read. Try a sharper, straighter shot." });
    } finally {
      setReading(null);
      if (photoRef.current) photoRef.current.value = "";
    }
  };

  const importCsv = async (text: string) => {
    setCsvMsg(null);
    if (!text.trim()) return setCsvMsg({ tone: "flag", text: "Paste or upload a CSV with the columns name, address, lat, lon." });
    setImporting(true);
    try {
      const added = await api.importStores(text);
      onStores(added);
      setCsvMsg({ tone: "ok", text: `Added ${added.length} ${added.length === 1 ? "store" : "stores"}.` });
      setCsv("");
    } catch (e) {
      setCsvMsg({ tone: "flag", text: (e as Error).message || "The CSV could not be read." });
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="grid content-start gap-3 rounded-[var(--radius)] border border-rule p-4">
        <p className="font-semibold">Menu photo</p>
        <p className="text-[13.5px] text-muted">
          A clear photo of the menu board. Nemotron 3.5 Super VL reads every item and price, then checks its own reading against the
          photo; anything it could not read is marked amber.
        </p>
        <input ref={photoRef} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" id="menu-photo" data-testid="setup-photo-input"
          onChange={(e) => readPhoto(e.target.files?.[0])} />
        <label htmlFor="menu-photo"
          className="flex cursor-pointer items-center justify-center gap-2 rounded-[var(--radius)] border border-dashed border-rule bg-paper-2 px-4 py-6 text-[14px] text-ink-2 hover:border-ink-2">
          {reading ? <><Spinner /> Reading {reading}…</> : "Choose a photo (JPG, PNG or WebP, up to 5 MB)"}
        </label>
        {photoMsg ? <div data-testid="setup-photo-message" data-tone={photoMsg.tone}><Notice tone={photoMsg.tone}>{photoMsg.text}</Notice></div> : null}
      </div>

      <div className="grid content-start gap-3 rounded-[var(--radius)] border border-rule p-4">
        <p className="font-semibold">Store list</p>
        <p className="text-[13.5px] text-muted">One row per store: its neighbourhood, the corner it sits on, and its coordinates.</p>
        <textarea data-testid="setup-csv-input" value={csv} onChange={(e) => setCsv(e.target.value)} rows={4} placeholder={CSV_EXAMPLE} spellCheck={false}
          className="w-full rounded-[var(--radius)] border border-rule bg-paper p-2.5 font-mono text-[12.5px] text-ink placeholder:text-muted" />
        <div className="flex flex-wrap gap-2">
          <Button data-testid="setup-csv-submit" size="sm" variant="primary" loading={importing} onClick={() => importCsv(csv)}>Add stores</Button>
          <label className="inline-flex h-8 cursor-pointer items-center rounded-[var(--radius)] border border-rule px-3 text-[13px] hover:border-ink-2">
            Upload a .csv
            <input data-testid="setup-csv-file" type="file" accept=".csv,text/csv" className="sr-only"
              onChange={async (e) => { const f = e.target.files?.[0]; if (f) await importCsv(await f.text()); e.target.value = ""; }} />
          </label>
        </div>
        {csvMsg ? <div data-testid="setup-csv-message" data-tone={csvMsg.tone}><Notice tone={csvMsg.tone}>{csvMsg.text}</Notice></div> : null}
      </div>
    </div>
  );
}
