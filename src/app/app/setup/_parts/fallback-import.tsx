"use client";

import { useState } from "react";
import type { MenuItem, Store } from "@/contract";
import { Button, Notice, Textarea } from "@/components/ui";
import { Dropzone, type DropFile } from "@/components/app-ui/form-dropzone";
import { getApi } from "@/lib/api-client";

/** For chains without Square: a photo of the menu board read by Nemotron VL, and a store list as CSV. */

const MAX_BYTES = 5 * 1024 * 1024;
const CSV_EXAMPLE = "name,address,lat,lon\nWilliamsburg,Bedford Ave & N 7th St,40.7175,-73.9573\nPark Slope,7th Ave & 9th St,40.6683,-73.9806";

export function FallbackImport({ onMenu, onStores }: { onMenu: (items: MenuItem[]) => void; onStores: (stores: Store[]) => void }) {
  const api = getApi();
  const [reading, setReading] = useState(false);
  const [photo, setPhoto] = useState<DropFile | null>(null);
  const [photoMsg, setPhotoMsg] = useState<{ tone: "ok" | "flag"; text: string } | null>(null);
  const [csv, setCsv] = useState("");
  const [csvFile, setCsvFile] = useState<DropFile | null>(null);
  const [importing, setImporting] = useState(false);
  const [csvMsg, setCsvMsg] = useState<{ tone: "ok" | "flag"; text: string } | null>(null);

  const readPhoto = async (file: File) => {
    setPhotoMsg(null);
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return setPhotoMsg({ tone: "flag", text: "Use a JPG, PNG or WebP photo." });
    if (file.size > MAX_BYTES) return setPhotoMsg({ tone: "flag", text: "That photo is over 5 MB. Take it again at a lower resolution." });
    setReading(true);
    setPhoto({ name: file.name, size: file.size, detail: "Reading…" });
    try {
      const items = await api.readMenu(file);
      onMenu(items);
      const check = items.filter((m) => m.priceLegible === false || m.seen === false).length;
      setPhoto({ name: file.name, size: file.size, detail: `Read ${items.length} items`, tone: "ok" });
      setPhotoMsg({ tone: "ok", text: `Read ${items.length} items from the photo.${check ? ` ${check} marked amber: check those prices.` : ""} Review them below, then save.` });
    } catch (e) {
      setPhoto({ name: file.name, size: file.size, detail: "Could not read it", tone: "flag" });
      setPhotoMsg({ tone: "flag", text: (e as Error).message || "The photo could not be read. Try a sharper, straighter shot." });
    } finally {
      setReading(false);
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
      setCsvFile(null);
    } catch (e) {
      setCsvMsg({ tone: "flag", text: (e as Error).message || "The CSV could not be read." });
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="grid gap-5 md:grid-cols-2">
      <div className="grid content-start gap-3">
        <p className="text-[14px] font-medium leading-5 text-ink">Menu photo</p>
        <Dropzone
          inputTestId="setup-photo-input"
          accept="image/jpeg,image/png,image/webp"
          icon="image"
          title="Drop a menu photo, or click to choose"
          hint="JPG, PNG or WebP, up to 5 MB"
          busy={reading}
          busyLabel="Reading the menu board…"
          onFile={readPhoto}
          file={photo}
          onRemove={reading ? undefined : () => { setPhoto(null); setPhotoMsg(null); }}
        />
        <p className="text-[13px] leading-5 text-muted">Nemotron 3.5 Super VL reads every item and price, then checks its own reading; anything unclear is marked amber.</p>
        {photoMsg ? <div data-testid="setup-photo-message" data-tone={photoMsg.tone}><Notice tone={photoMsg.tone}>{photoMsg.text}</Notice></div> : null}
      </div>

      <div className="grid content-start gap-3">
        <p className="text-[14px] font-medium leading-5 text-ink">Store list</p>
        <Dropzone
          compact
          inputTestId="setup-csv-file"
          accept=".csv,text/csv"
          icon="file"
          title="Drop a .csv, or click to choose"
          file={csvFile}
          onRemove={() => { setCsvFile(null); setCsv(""); }}
          onFile={async (f) => {
            const text = await f.text();
            setCsv(text);
            setCsvFile({ name: f.name, size: f.size, detail: `${Math.max(0, text.trim().split(/\r?\n/).length - 1)} rows` });
          }}
        />
        <Textarea data-testid="setup-csv-input" value={csv} onChange={(e) => setCsv(e.target.value)} rows={4} placeholder={CSV_EXAMPLE} spellCheck={false} className="font-mono text-[12.5px] leading-5" />
        <div>
          <Button data-testid="setup-csv-submit" size="sm" variant="primary" loading={importing} onClick={() => importCsv(csv)}>Add stores</Button>
        </div>
        {csvMsg ? <div data-testid="setup-csv-message" data-tone={csvMsg.tone}><Notice tone={csvMsg.tone}>{csvMsg.text}</Notice></div> : null}
      </div>
    </div>
  );
}
