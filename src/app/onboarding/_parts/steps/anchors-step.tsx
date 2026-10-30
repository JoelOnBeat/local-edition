"use client";

import { useState } from "react";
import type { QlooEntityRef } from "@/contract";
import { ErrorLine } from "@/components/account/plain";
import { Button, Input } from "@/components/ui";
import { Icon } from "@/components/app-ui/icons";
import { LogoTile } from "@/components/app-ui/tiles";
import { toShownError, type ShownError } from "@/components/lib/use-async";
import { getApi } from "@/lib/api-client";
import type { StepProps } from "../step-props";

const kind = (type: string) => type.replace("urn:entity:", "").replace(/_/g, " ");

/** Taste anchors: search brands, pick one to three, save. The search is cached and capped server-side. */
export function AnchorsStep({ bundle, refresh }: StepProps) {
  const api = getApi();
  const { chain } = bundle;
  const [q, setQ] = useState("");
  const [results, setResults] = useState<QlooEntityRef[]>([]);
  const [searched, setSearched] = useState(false);
  const [picked, setPicked] = useState<QlooEntityRef[]>(chain.anchors);
  const [error, setError] = useState<ShownError | undefined>();
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState<"search" | "save" | null>(null);

  const guard = async (kindOf: "search" | "save", fn: () => Promise<void>) => {
    setError(undefined);
    setBusy(kindOf);
    try {
      await fn();
    } catch (e) {
      setError(toShownError(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <span className="flex items-baseline justify-between text-[14px] font-medium text-ink">Your chain feels like<span className="font-mono text-[12px] font-normal text-muted tnum">{picked.length}/3</span></span>
        <ul data-testid="anchors-picked" className="flex min-h-9 flex-wrap gap-2">
          {picked.length === 0 ? <li className="text-[14px] leading-9 text-muted">None yet. Search for a brand your customers also love.</li> : null}
          {picked.map((a) => (
            <li key={a.entityId} data-testid="anchor-picked" className="inline-flex h-8 items-center gap-1.5 rounded-full bg-white pl-3 pr-1 text-[14px] font-medium text-ink-strong shadow-pill">
              {a.name}
              <button data-testid="anchor-remove" type="button" aria-label={`Remove ${a.name}`} onClick={() => { setSaved(false); setPicked(picked.filter((p) => p.entityId !== a.entityId)); }}
                className="flex size-6 items-center justify-center rounded-full text-faint transition-colors hover:bg-stone-100 hover:text-ink">
                <Icon name="x" size={12} strokeWidth={2.4} />
              </button>
            </li>
          ))}
        </ul>
      </div>

      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void guard("search", async () => { setResults(await api.searchAnchors(q)); setSearched(true); }); }}>
        <div className="relative min-w-0 flex-1">
          <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <Input data-testid="anchors-q" aria-label="Brand" placeholder="A brand your chain feels like" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" />
        </div>
        <Button data-testid="anchors-search" type="submit" size="lg" className="text-[14px] leading-5" loading={busy === "search"} disabled={q.trim().length < 2}>Search Qloo</Button>
      </form>

      {searched && results.length === 0 ? <p className="text-[14px] text-muted">No brands match “{q.trim()}”. Try a shorter name.</p> : null}
      <ul data-testid="anchors-results" className={results.length ? "overflow-hidden rounded-lg bg-white shadow-ring-xs" : "hidden"}>
        {results.map((r, i) => {
          const has = picked.some((p) => p.entityId === r.entityId);
          return (
            <li key={r.entityId} className="flex items-center gap-3 border-b border-rule-row px-3.5 py-2.5 last:border-0">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-medium text-ink-strong">{r.name}</span>
                <span className="block truncate text-[12px] capitalize text-muted">{kind(r.type)}</span>
              </span>
              <Button data-testid={`anchor-pick-${i}`} size="sm" variant={has ? "ghost" : "secondary"} disabled={picked.length >= 3 || has} onClick={() => { setSaved(false); setPicked([...picked, r]); }}>
                {has ? <><Icon name="check" size={14} />Picked</> : "Pick"}
              </Button>
            </li>
          );
        })}
      </ul>
      <p className="flex items-center gap-2 text-[13px] leading-5 text-muted"><LogoTile provider="qloo" size="xs" />Only brand names go to Qloo, never anything about your customers.</p>
      <ErrorLine error={error} testId="anchors-error" />
      <div className="flex flex-wrap items-center gap-3">
        <Button data-testid="anchors-save" variant="primary" size="sm" className="h-10 w-full px-6" loading={busy === "save"} disabled={picked.length === 0}
          onClick={() => guard("save", async () => { await api.putChain({ name: chain.name, brandVoice: chain.brandVoice, anchors: picked }); setSaved(true); refresh(); })}>
          Save taste anchors
        </Button>
        {saved ? <span data-testid="anchors-saved" className="inline-flex items-center gap-1.5 text-[13px] font-medium text-ok-ink"><Icon name="check" size={14} />Saved.</span> : null}
      </div>
    </div>
  );
}
