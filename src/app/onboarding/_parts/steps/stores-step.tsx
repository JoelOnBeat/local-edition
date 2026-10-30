"use client";

import { useState } from "react";
import { ErrorLine } from "@/components/account/plain";
import { Button, FormField, Input, Notice, StoreTile, Textarea } from "@/components/ui";
import { Dropzone, type DropFile } from "@/components/app-ui/form-dropzone";
import { toShownError, type ShownError } from "@/components/lib/use-async";
import { getApi } from "@/lib/api-client";
import type { StepProps } from "../step-props";

const CSV_EXAMPLE = "name,address,lat,lon\nWilliamsburg,Bedford Ave & N 7th St,40.7175,-73.9573";

/** Stores: paste or upload the store CSV (name,address,lat,lon), or add one by hand. Square locations arrive with the Square connection. */
export function StoresStep({ bundle, refresh }: StepProps) {
  const api = getApi();
  const [csv, setCsv] = useState("");
  const [one, setOne] = useState({ name: "", addressLabel: "", lat: "", lon: "" });
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<ShownError | undefined>();
  const [busy, setBusy] = useState<"csv" | "one" | null>(null);
  const [file, setFile] = useState<DropFile | null>(null);

  const run = async (kind: "csv" | "one", fn: () => Promise<string>) => {
    setError(undefined);
    setNote(null);
    setBusy(kind);
    try {
      setNote(await fn());
      refresh();
    } catch (e) {
      setError(toShownError(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="grid gap-5">
      <div className="overflow-hidden rounded-xl bg-paper-2 p-1 pt-0 shadow-ring-xs">
        <p className="flex items-center justify-between px-3 pb-2.5 pt-3 text-[14px] font-medium text-ink-strong">
          Stores<span className="text-[13px] font-normal text-muted tnum">{bundle.stores.length}</span>
        </p>
        {bundle.stores.length === 0 ? (
          <p className="rounded-lg bg-white px-4 py-6 text-center text-[14px] text-ink-2 shadow-ring-xs">No stores yet. Import a list below or add one by hand.</p>
        ) : (
          <ul data-testid="stores-list" className="max-h-[300px] overflow-y-auto rounded-lg bg-white shadow-ring-xs">
            {bundle.stores.map((s) => (
              <li key={s.id} data-testid="store-row" className="flex items-center gap-3 border-b border-rule-row px-3.5 py-2.5 last:border-0">
                <StoreTile colorIndex={s.colorIndex} name={s.name} size="md" />
                <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-ink-strong">{s.name}</span>
                <span className="hidden min-w-0 truncate text-[13px] text-muted sm:block">{s.addressLabel}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="grid gap-2">
        <span className="text-[14px] font-medium text-ink">Import a store list</span>
        <Dropzone
          compact
          inputTestId="stores-file"
          accept=".csv,text/csv"
          icon="file"
          title="Drop a .csv, or click to choose one"
          file={file}
          onRemove={() => { setFile(null); setCsv(""); }}
          onFile={async (f) => {
            const text = await f.text();
            setCsv(text);
            const rows = text.trim().split(/\r?\n/).length - 1;
            setFile({ name: f.name, size: f.size, detail: `${Math.max(0, rows)} ${rows === 1 ? "row" : "rows"}, ready to import` });
          }}
        />
        <Textarea data-testid="stores-csv" rows={5} spellCheck={false} placeholder={CSV_EXAMPLE} value={csv} onChange={(e) => setCsv(e.target.value)} className="font-mono text-[12.5px] leading-5" />
        <p className="text-[13px] leading-5 text-muted">Or paste it above. Columns: name, address, lat, lon; one row per store.</p>
        <div>
          <Button data-testid="stores-import" variant="primary" size="sm" disabled={!csv.trim()} loading={busy === "csv"}
            onClick={() => run("csv", async () => { const added = await api.importStores(csv); setCsv(""); setFile(null); return `Added ${added.length} stores.`; })}>
            Import stores
          </Button>
        </div>
      </div>

      <form className="grid gap-3 border-t border-rule-subtle pt-5" onSubmit={(e) => { e.preventDefault(); void run("one", async () => {
        await api.createStore({ name: one.name, addressLabel: one.addressLabel, lat: Number(one.lat), lon: Number(one.lon) });
        setOne({ name: "", addressLabel: "", lat: "", lon: "" });
        return "Store added.";
      }); }}>
        <span className="text-[14px] font-medium text-ink">Or add one store</span>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="Neighbourhood"><Input data-testid="store-name" placeholder="Williamsburg" value={one.name} onChange={(e) => setOne({ ...one, name: e.target.value })} /></FormField>
          <FormField label="Address"><Input data-testid="store-address" placeholder="Bedford Ave & N 7th St" value={one.addressLabel} onChange={(e) => setOne({ ...one, addressLabel: e.target.value })} /></FormField>
          <FormField label="Latitude"><Input data-testid="store-lat" inputMode="decimal" className="font-mono text-[13px]" placeholder="40.7175" value={one.lat} onChange={(e) => setOne({ ...one, lat: e.target.value })} /></FormField>
          <FormField label="Longitude"><Input data-testid="store-lon" inputMode="decimal" className="font-mono text-[13px]" placeholder="-73.9573" value={one.lon} onChange={(e) => setOne({ ...one, lon: e.target.value })} /></FormField>
        </div>
        <div><Button data-testid="store-add" type="submit" size="sm" loading={busy === "one"}>Add store</Button></div>
      </form>
      {note ? <div data-testid="stores-note"><Notice tone="ok">{note}</Notice></div> : null}
      <ErrorLine error={error} testId="stores-error" />
    </div>
  );
}
