import type { BlockTag, Store } from "@/contract";
import { storeColor } from "../ui";

const bar = (v: number) => `${Math.max(3, Math.min(100, v * 100))}%`;

/** A ranked column of one block's distinctive tags: affinity bar in the store's colour, lift beside it. */
export function TagColumn({ title, store, tags, empty }: { title: string; store: Store; tags: BlockTag[]; empty: string }) {
  return (
    <section className="min-w-0">
      <div className="h-1 w-full" style={{ background: storeColor(store.colorIndex) }} aria-hidden />
      <p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">{title}</p>
      <h2 className="font-display text-[22px] font-semibold leading-tight tracking-tight text-ink">{store.name}</h2>
      {tags.length === 0 ? <p className="mt-3 text-[13px] text-muted">{empty}</p> : null}
      <ul className="mt-2">
        {tags.map((t) => (
          <li key={t.tagId} className="border-b border-rule py-2.5">
            <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate text-[14px] font-medium text-ink">{t.name}</span>
              <span className="shrink-0 font-mono text-[12px] text-ok">+{t.lift.toFixed(2)}</span>
            </div>
            <div className="mt-1.5 flex items-center gap-2">
              <div className="h-1.5 flex-1 rounded-full bg-paper-2">
                <div className="h-1.5 rounded-full" style={{ width: bar(t.affinity), background: storeColor(store.colorIndex) }} />
              </div>
              <span className="w-10 shrink-0 text-right font-mono text-[11.5px] text-muted">{t.affinity.toFixed(2)}</span>
            </div>
            <p className="mt-1 text-[11.5px] text-muted">{t.kind}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Tags both blocks share, with each store's affinity side by side. */
export function SharedColumn({ a, b, tags, bTags }: { a: Store; b: Store; tags: BlockTag[]; bTags: BlockTag[] | undefined }) {
  return (
    <section className="min-w-0">
      <div className="flex h-1 w-full" aria-hidden>
        <span className="flex-1" style={{ background: storeColor(a.colorIndex) }} />
        <span className="flex-1" style={{ background: storeColor(b.colorIndex) }} />
      </div>
      <p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">Shared</p>
      <h2 className="font-display text-[22px] font-semibold leading-tight tracking-tight text-ink">Both blocks</h2>
      {tags.length === 0 ? <p className="mt-3 text-[13px] text-muted">These two blocks share none of their top tags, so their editions should look nothing alike.</p> : null}
      <ul className="mt-2">
        {tags.map((t) => {
          const other = bTags?.find((x) => x.tagId === t.tagId);
          return (
            <li key={t.tagId} className="border-b border-rule py-2.5">
              <span className="block truncate text-[14px] font-medium text-ink">{t.name}</span>
              {[{ s: a, v: t.affinity }, { s: b, v: other?.affinity }].map(({ s, v }) => (
                <div key={s.id} className="mt-1.5 flex items-center gap-2">
                  <div className="h-1.5 flex-1 rounded-full bg-paper-2">
                    {v !== undefined ? <div className="h-1.5 rounded-full" style={{ width: bar(v), background: storeColor(s.colorIndex) }} /> : null}
                  </div>
                  <span className="w-10 shrink-0 text-right font-mono text-[11.5px] text-muted">{v !== undefined ? v.toFixed(2) : "—"}</span>
                </div>
              ))}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
