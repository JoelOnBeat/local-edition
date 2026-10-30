import { BrandGlyph, SampleBadge, StoreTile } from "@/components/ui";
import { WEEK_LABEL, WILLIAMSBURG } from "./landing-data";

/** One tag's affinity here against the city baseline (baseline = affinity − lift, as Qloo reports lift). */
function TagCell({ name, affinity, lift }: { name: string; affinity: number; lift: number }) {
  const city = affinity - lift;
  return (
    <div className="flex flex-col justify-between gap-8 border-b border-rule-subtle px-6 py-10 last:border-b-0 md:border-b-0 md:px-8 md:py-14 md:[&:not(:last-child)]:border-r">
      <p className="flex items-center gap-2 text-[16px] leading-6 text-ink-2">
        <BrandGlyph brand="qloo" className="size-4 text-ink" />
        {name}
      </p>
      <div className="grid gap-2" aria-hidden>
        <div className="flex items-center gap-2">
          <div className="h-2 rounded-full bg-accent" style={{ width: `${affinity * 100}%` }} />
          <span className="text-[11px] text-faint tnum">here</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="h-2 rounded-full bg-stone-300" style={{ width: `${city * 100}%` }} />
          <span className="text-[11px] text-faint tnum">city</span>
        </div>
      </div>
      <div>
      <p className="text-[32px] font-medium leading-10 tracking-[-0.02em] text-ink tnum">{affinity.toFixed(2)}</p>
      <p className="mt-1 text-[16px] leading-6 text-ink-2">
        <span className="font-medium text-ok-ink tnum">+{lift.toFixed(2)}</span> lift against New York
      </p>
      </div>
    </div>
  );
}

/**
 * The evidence frame (ByDefault's case-study frame): the block profile behind one store, two of its strongest tags as
 * measured cells, and the special it produced quoted underneath with the key phrase underlined.
 */
export function LandingEvidence() {
  const [t1, t2] = WILLIAMSBURG.tags;
  return (
    <section className="relative border-y border-rule" aria-labelledby="evidence-title">
      <div className="mx-auto max-w-[1190px] p-2 sm:p-3"><div className="ring-after relative overflow-hidden rounded-xl bg-white">
        <div className="grid border-b border-rule-subtle md:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_300px_300px]">
          <div className="flex flex-col justify-between gap-14 border-b border-rule-subtle px-6 py-8 md:col-span-2 md:px-10 md:py-14 lg:col-span-1 lg:border-b-0 lg:border-r">
            <p className="flex items-center gap-2.5 text-[16px] leading-6 text-stone-500">
              <StoreTile colorIndex={WILLIAMSBURG.colorIndex} name={WILLIAMSBURG.name} size="sm" />
              <span className="font-medium text-ink">Williamsburg</span>
              <span className="h-3.5 w-px bg-stone-200" aria-hidden />
              Block profile
              <SampleBadge>Sample</SampleBadge>
            </p>
            <div><h2 id="evidence-title" className="max-w-[509px] text-[28px] font-medium leading-9 tracking-[-0.02em] text-ink [text-wrap:balance] md:text-[32px] md:leading-10">
              Every pick shows the taste it came from.
            </h2>
            <p className="mt-3 max-w-[460px] text-[16px] leading-6 text-ink-2">
              Within 800 m of {WILLIAMSBURG.address}, people over-index on indie rock and vintage shopping. The agent reads that
              from Qloo before it touches the menu, and every line keeps a link back to it.
            </p></div>
          </div>
          {t1 ? <TagCell name={t1.name} affinity={t1.affinity} lift={t1.lift} /> : null}
          {t2 ? <TagCell name={t2.name} affinity={t2.affinity} lift={t2.lift} /> : null}
        </div>
        <figure className="grid lg:grid-cols-[1fr_auto]">
          <blockquote className="px-6 py-12 md:px-10 md:py-20">
            <p className="relative max-w-[640px] text-[24px] font-medium leading-8 tracking-[-0.02em] text-ink [text-wrap:balance] md:text-[30px] md:leading-10">
              <span className="absolute -translate-x-full" aria-hidden>&ldquo;</span>
              Our cortado with a twist of <span className="hand-underline">fresh orange peel</span> and a pinch of dark chocolate.
              Bright up front, round at the finish.&rdquo;
            </p>
          </blockquote>
          <figcaption className="flex items-end border-t border-rule-subtle px-6 py-6 md:px-8 md:pb-10 lg:min-w-[300px] lg:border-l lg:border-t-0 lg:pt-20">
            <div className="flex items-center gap-3">
              <span className="flex size-11 items-center justify-center rounded-full bg-white ring-1 ring-[#E5E5E5]">
                <StoreTile colorIndex={WILLIAMSBURG.colorIndex} name={WILLIAMSBURG.name} size="lg" />
              </span>
              <span>
                <span className="block text-[16px] font-medium leading-6 text-ink">Orange Peel Cortado</span>
                <span className="block text-[16px] leading-6 text-muted">
                  <span className="definition-underline">The special</span> · {WEEK_LABEL}
                </span>
              </span>
            </div>
          </figcaption>
        </figure>
      </div></div>
    </section>
  );
}
