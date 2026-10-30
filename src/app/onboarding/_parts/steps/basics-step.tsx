"use client";

import { useState } from "react";
import { ChainCategory } from "@/contract";
import { ErrorLine } from "@/components/account/plain";
import { Button, FormField, Input } from "@/components/ui";
import { ChoiceSelect } from "@/components/app-ui/form-choice";
import { toShownError, type ShownError } from "@/components/lib/use-async";
import type { StepProps } from "../step-props";

const CATEGORY_LABEL: Record<ChainCategory, string> = { coffee: "Coffee shops", restaurant: "Restaurants", gym: "Gyms", hotel: "Hotels" };

/** Chain basics: name, category, home city. Saving confirms the step even when nothing changed. */
export function BasicsStep({ bundle, update, refresh }: StepProps) {
  const { chain } = bundle;
  const [name, setName] = useState(chain.name);
  const [category, setCategory] = useState(chain.category);
  const [city, setCity] = useState(chain.city.name);
  const [lat, setLat] = useState(String(chain.city.lat));
  const [lon, setLon] = useState(String(chain.city.lon));
  const [error, setError] = useState<ShownError | undefined>();
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setError(undefined);
    setBusy(true);
    try {
      const ok = await update({ basics: { name, category, city: { name: city, lat: Number(lat), lon: Number(lon) } } });
      if (ok) refresh();
    } catch (e) {
      setError(toShownError(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form data-testid="basics-form" className="grid gap-4" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <FormField label="Chain name" htmlFor="basics-name">
        <Input id="basics-name" data-testid="basics-name" maxLength={80} required value={name} onChange={(e) => setName(e.target.value)} />
      </FormField>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Category" htmlFor="basics-category">
          <ChoiceSelect
            id="basics-category"
            label="Category"
            testId="basics-category-choice"
            nativeTestId="basics-category"
            value={category}
            onChange={setCategory}
            options={ChainCategory.options.map((c) => ({ value: c, label: CATEGORY_LABEL[c] }))}
          />
        </FormField>
        <FormField label="Home city" htmlFor="basics-city">
          <Input id="basics-city" data-testid="basics-city" maxLength={80} required value={city} onChange={(e) => setCity(e.target.value)} />
        </FormField>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <FormField label="Latitude" htmlFor="basics-lat">
          <Input id="basics-lat" data-testid="basics-lat" inputMode="decimal" className="font-mono text-[13px] tnum" value={lat} onChange={(e) => setLat(e.target.value)} />
        </FormField>
        <FormField label="Longitude" htmlFor="basics-lon">
          <Input id="basics-lon" data-testid="basics-lon" inputMode="decimal" className="font-mono text-[13px] tnum" value={lon} onChange={(e) => setLon(e.target.value)} />
        </FormField>
      </div>
      <p className="-mt-1 text-[13px] leading-5 text-muted">The city centre sets the baseline each block&apos;s taste is measured against.</p>
      <ErrorLine error={error} testId="basics-error" />
      <div>
        <Button data-testid="basics-save" type="submit" variant="primary" size="sm" loading={busy} className="h-10 w-full px-6">Save chain basics</Button>
      </div>
    </form>
  );
}
