"use client";

import { useState } from "react";
import { ChainCategory } from "@/contract";
import { ErrorLine, Field } from "@/components/account/plain";
import { toShownError, type ShownError } from "@/components/lib/use-async";
import type { StepProps } from "../step-props";

/** Chain basics: name, category, home city. Saving confirms the step even when nothing changed. */
export function BasicsStep({ bundle, update, refresh }: StepProps) {
  const { chain } = bundle;
  const [name, setName] = useState(chain.name);
  const [category, setCategory] = useState(chain.category);
  const [city, setCity] = useState(chain.city.name);
  const [lat, setLat] = useState(String(chain.city.lat));
  const [lon, setLon] = useState(String(chain.city.lon));
  const [error, setError] = useState<ShownError | undefined>();

  const save = async () => {
    setError(undefined);
    try {
      const ok = await update({ basics: { name, category, city: { name: city, lat: Number(lat), lon: Number(lon) } } });
      if (ok) refresh();
    } catch (e) {
      setError(toShownError(e));
    }
  };
  return (
    <form data-testid="basics-form" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <Field label="Chain name"><input data-testid="basics-name" value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label="Category">
        <select data-testid="basics-category" value={category} onChange={(e) => setCategory(e.target.value as typeof category)}>
          {ChainCategory.options.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </Field>
      <Field label="City"><input data-testid="basics-city" value={city} onChange={(e) => setCity(e.target.value)} /></Field>
      <Field label="Latitude"><input data-testid="basics-lat" inputMode="decimal" value={lat} onChange={(e) => setLat(e.target.value)} /></Field>
      <Field label="Longitude"><input data-testid="basics-lon" inputMode="decimal" value={lon} onChange={(e) => setLon(e.target.value)} /></Field>
      <ErrorLine error={error} testId="basics-error" />
      <button data-testid="basics-save" type="submit">Save chain basics</button>
    </form>
  );
}
