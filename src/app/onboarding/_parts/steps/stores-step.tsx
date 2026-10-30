"use client";

import { useState } from "react";
import { ErrorLine, Field } from "@/components/account/plain";
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

  const run = async (fn: () => Promise<string>) => {
    setError(undefined);
    setNote(null);
    try {
      setNote(await fn());
      refresh();
    } catch (e) {
      setError(toShownError(e));
    }
  };
  return (
    <div>
      <ul data-testid="stores-list">
        {bundle.stores.map((s) => <li key={s.id} data-testid="store-row">{s.name} - {s.addressLabel}</li>)}
      </ul>
      <h3>Store CSV</h3>
      <input data-testid="stores-file" type="file" accept=".csv,text/csv" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setCsv(await f.text()); }} />
      <textarea data-testid="stores-csv" rows={5} cols={60} placeholder={CSV_EXAMPLE} value={csv} onChange={(e) => setCsv(e.target.value)} />
      <button data-testid="stores-import" type="button" disabled={!csv.trim()} onClick={() => run(async () => { const added = await api.importStores(csv); setCsv(""); return `Added ${added.length} stores.`; })}>
        Import stores
      </button>
      <h3>Add one store</h3>
      <form onSubmit={(e) => { e.preventDefault(); void run(async () => {
        await api.createStore({ name: one.name, addressLabel: one.addressLabel, lat: Number(one.lat), lon: Number(one.lon) });
        setOne({ name: "", addressLabel: "", lat: "", lon: "" });
        return "Store added.";
      }); }}>
        <Field label="Neighbourhood"><input data-testid="store-name" value={one.name} onChange={(e) => setOne({ ...one, name: e.target.value })} /></Field>
        <Field label="Address"><input data-testid="store-address" value={one.addressLabel} onChange={(e) => setOne({ ...one, addressLabel: e.target.value })} /></Field>
        <Field label="Latitude"><input data-testid="store-lat" inputMode="decimal" value={one.lat} onChange={(e) => setOne({ ...one, lat: e.target.value })} /></Field>
        <Field label="Longitude"><input data-testid="store-lon" inputMode="decimal" value={one.lon} onChange={(e) => setOne({ ...one, lon: e.target.value })} /></Field>
        <button data-testid="store-add" type="submit">Add store</button>
      </form>
      {note ? <p data-testid="stores-note">{note}</p> : null}
      <ErrorLine error={error} testId="stores-error" />
    </div>
  );
}
