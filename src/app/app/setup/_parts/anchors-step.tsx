"use client";

import { useState } from "react";
import type { Chain, QlooEntityRef } from "@/contract";
import { Button, EmptyState, Input, Notice, Spinner, cx } from "@/components/ui";
import { Icon } from "@/components/app-ui/icons";
import { LogoTile } from "@/components/app-ui/tiles";
import { getApi } from "@/lib/api-client";

/** Step 3: one to three brands the chain resembles. Qloo uses them to tell what the chain's own crowd likes on each block. */

export function AnchorsStep({ chain, onSaved }: { chain: Chain; onSaved: (c: Chain) => void }) {
  const api = getApi();
  const [picked, setPicked] = useState<QlooEntityRef[]>(chain.anchors);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<QlooEntityRef[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "flag"; text: string } | null>(null);
  const has = (e: QlooEntityRef) => picked.some((p) => p.entityId === e.entityId);
  const dirty = picked.map((p) => p.entityId).join() !== chain.anchors.map((p) => p.entityId).join();

  const search = async (e: React.FormEvent) => {
    e.preventDefault();
    const term = q.trim();
    if (!term) return;
    setSearching(true);
    setMsg(null);
    try {
      setResults(await api.searchAnchors(term));
    } catch (err) {
      setResults(null);
      setMsg({ tone: "flag", text: (err as Error).message });
    } finally {
      setSearching(false);
    }
  };
  const toggle = (e: QlooEntityRef) => {
    setMsg(null);
    if (has(e)) setPicked(picked.filter((p) => p.entityId !== e.entityId));
    else if (picked.length >= 3) setMsg({ tone: "flag", text: "Three at most. Remove one first." });
    else setPicked([...picked, e]);
  };
  const save = async () => {
    setSaving(true);
    try {
      const saved = await api.putChain({ name: chain.name, brandVoice: chain.brandVoice, anchors: picked });
      onSaved(saved);
      setMsg({ tone: "ok", text: "Saved. The next build reads each block through these brands." });
    } catch (err) {
      setMsg({ tone: "flag", text: (err as Error).message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <span className="text-[14px] font-medium leading-5 text-ink">Your chain resembles <span className="font-mono text-[12px] font-normal text-muted tnum">{picked.length}/3</span></span>
        {picked.length === 0 ? (
          <p className="text-[14px] text-muted">None yet. Search for a brand your customers also love.</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {picked.map((p) => (
              <li key={p.entityId} data-testid="anchor-picked" data-entity-id={p.entityId} className="inline-flex h-8 items-center gap-1.5 rounded-full bg-white pl-3 pr-1 text-[14px] font-medium text-ink-strong shadow-pill">
                {p.name}
                <button data-testid="anchor-remove" type="button" onClick={() => toggle(p)} aria-label={`Remove ${p.name}`}
                  className="grid size-6 place-items-center rounded-full text-faint hover:bg-stone-100 hover:text-ink"><Icon name="x" size={12} strokeWidth={2.4} /></button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <form onSubmit={search} className="flex max-w-xl gap-2">
        <label className="sr-only" htmlFor="anchor-q">Brand name</label>
        <span className="relative min-w-0 flex-1">
          <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <Input id="anchor-q" data-testid="anchor-query" value={q} maxLength={80} onChange={(e) => setQ(e.target.value)} placeholder="Blue Bottle, Aesop, Muji…" className="pl-9" />
        </span>
        <Button data-testid="anchor-search" type="submit" size="sm" className="h-10" loading={searching} disabled={!q.trim()}>Search Qloo</Button>
      </form>

      {searching && !results ? <p className="flex items-center gap-2 text-[14px] text-ink-2"><Spinner /> Searching Qloo brands…</p> : null}
      {results ? (
        results.length === 0 ? (
          <div data-testid="anchor-empty"><EmptyState title={`No brands match “${q.trim()}”`} body="Try the brand's shorter name, or a brand with a similar crowd." className="py-6" /></div>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {results.map((r) => {
              const on = has(r);
              return (
                <li key={r.entityId}>
                  <button data-testid="anchor-result" data-entity-id={r.entityId} type="button" onClick={() => toggle(r)} aria-pressed={on}
                    className={cx("flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left text-[14px] transition-[background-color,box-shadow,scale] duration-150 active:scale-[.99]",
                      on ? "bg-accent-subtle shadow-[inset_0_0_0_1.5px_var(--accent)]" : "bg-white shadow-ring-xs hover:bg-stone-50")}>
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{r.name}</span>
                      <span className="block truncate text-[12px] capitalize text-muted">{r.type.replace("urn:entity:", "").replace(/_/g, " ")}</span>
                    </span>
                    <span className={cx("inline-flex shrink-0 items-center gap-1 text-[13px] font-medium", on ? "text-accent-text" : "text-ink-2")}>{on ? <><Icon name="check" size={14} />Added</> : "Add"}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )
      ) : null}
      <p className="flex items-center gap-2 text-[13px] leading-5 text-muted"><LogoTile provider="qloo" size="xs" />Brand search runs on Qloo. Only brand names go to Qloo, never anything about your customers.</p>

      {msg ? <div data-testid="anchors-message" data-tone={msg.tone}><Notice tone={msg.tone}>{msg.text}</Notice></div> : null}
      <div>
        <Button data-testid="anchors-save" variant="primary" size="sm" className="h-10 px-6" loading={saving} disabled={!dirty || picked.length === 0} onClick={save}>Save taste anchors</Button>
      </div>
    </div>
  );
}
