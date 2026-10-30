"use client";

import { useState } from "react";
import type { QlooEntityRef } from "@/contract";
import { ErrorLine } from "@/components/account/plain";
import { toShownError, type ShownError } from "@/components/lib/use-async";
import { getApi } from "@/lib/api-client";
import type { StepProps } from "../step-props";

/** Taste anchors: search brands, pick one to three, save. The search is cached and capped server-side. */
export function AnchorsStep({ bundle, refresh }: StepProps) {
  const api = getApi();
  const { chain } = bundle;
  const [q, setQ] = useState("");
  const [results, setResults] = useState<QlooEntityRef[]>([]);
  const [picked, setPicked] = useState<QlooEntityRef[]>(chain.anchors);
  const [error, setError] = useState<ShownError | undefined>();
  const [saved, setSaved] = useState(false);

  const guard = async (fn: () => Promise<void>) => {
    setError(undefined);
    try {
      await fn();
    } catch (e) {
      setError(toShownError(e));
    }
  };
  return (
    <div>
      <ul data-testid="anchors-picked">
        {picked.map((a) => (
          <li key={a.entityId} data-testid="anchor-picked">
            {a.name} <button data-testid="anchor-remove" type="button" onClick={() => setPicked(picked.filter((p) => p.entityId !== a.entityId))}>Remove</button>
          </li>
        ))}
      </ul>
      <form onSubmit={(e) => { e.preventDefault(); void guard(async () => setResults(await api.searchAnchors(q))); }}>
        <input data-testid="anchors-q" aria-label="Brand" placeholder="A brand your chain feels like" value={q} onChange={(e) => setQ(e.target.value)} />
        <button data-testid="anchors-search" type="submit" disabled={q.trim().length < 2}>Search</button>
      </form>
      <ul data-testid="anchors-results">
        {results.map((r, i) => (
          <li key={r.entityId}>
            {r.name}{" "}
            <button data-testid={`anchor-pick-${i}`} type="button" disabled={picked.length >= 3 || picked.some((p) => p.entityId === r.entityId)} onClick={() => setPicked([...picked, r])}>
              Pick
            </button>
          </li>
        ))}
      </ul>
      <ErrorLine error={error} testId="anchors-error" />
      {saved ? <p data-testid="anchors-saved">Saved.</p> : null}
      <button data-testid="anchors-save" type="button" disabled={picked.length === 0}
        onClick={() => guard(async () => { await api.putChain({ name: chain.name, brandVoice: chain.brandVoice, anchors: picked }); setSaved(true); refresh(); })}>
        Save taste anchors
      </button>
    </div>
  );
}
