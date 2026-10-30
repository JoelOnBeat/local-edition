import { BrandGlyph, SampleBadge, StoreTile } from "@/components/ui";
import { WEEK_LABEL, WILLIAMSBURG } from "./landing-data";

/** One tag's affinity here against the city baseline (baseline = affinity − lift, as Qloo reports lift). */
function TagCell({ name, affinity, lift }: { name: string; affinity: number; lift: number }) {
  const city = affinity - lift;
  return (
    <div className="border-t border-rule-subtle px-6 py-8 md:border-l md:border-t-0 md:px-8 md:py-14">
      <p className="flex items-center gap-2 text-[16px] leading-6 text-ink-2">
        <BrandGlyph brand="qloo" className="size-4 text-ink" />
        {name}
      </p>
      <div className="mt-6 grid gap-2" aria-hidden>
        <div className="flex items-center gap-2">
          <div className="h-2 rounded-full bg-accent" style={{ width: `${affinity * 100}%` }} />
          <span className="text-[11px] text-faint tnum">here</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="h-2 rounded-full bg-stone-300" style={{ width: `${city * 100}%` }} />
          <span className="text-[11px] text-faint tnum">city</span>
        </div>
      </div>
      <p className="mt-5 text-[32px] font-medium leading-10 tracking-[-0.02em] text-ink tnum">{affinity.toFixed(2)}</p>
      <p className="mt-1 text-[16px] leading-6 text-ink-2">
        <span className="font-medium text-ok-ink tnum">+{lift.toFixed(2)}</span> lift against New York
      </p>
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
        <div className="grid md:grid-cols-[minmax(0,1.9fr)_minmax(0,1fr)_minmax(0,1fr)]">
          <div className="px-6 py-10 md:px-10 md:py-14">
            <p className="flex items-center gap-2.5 text-[16px] leading-6 text-ink-2">
              <StoreTile colorIndex={WILLIAMSBURG.colorIndex} name={WILLIAMSBURG.name} />
              <span className="font-medium text-ink">Williamsburg</span>
              <span className="h-4 w-px bg-rule" aria-hidden />
              Block profile
              <SampleBadge>Sample</SampleBadge>
            </p>
            <h2 id="evidence-title" className="mt-12 max-w-[360px] text-[28px] font-medium leading-[34px] tracking-[-0.02em] text-ink md:text-[32px] md:leading-10">
              Every pick shows the taste it came from.
            </h2>
            <p className="mt-3 max-w-[460px] text-[16px] leading-6 text-ink-2">
              Within 800 m of {WILLIAMSBURG.address}, people over-index on indie rock and vintage shopping. The agent reads that
              from Qloo before it touches the menu, and every line keeps a link back to it.
            </p>
          </div>
          {t1 ? <TagCell name={t1.name} affinity={t1.affinity} lift={t1.lift} /> : null}
          {t2 ? <TagCell name={t2.name} affinity={t2.affinity} lift={t2.lift} /> : null}
        </div>
        <div className="grid border-t border-rule-subtle md:grid-cols-[minmax(0,2.9fr)_minmax(0,1fr)]">
          <blockquote className="px-6 py-12 md:px-10 md:py-20">
            <p className="relative max-w-[640px] text-[24px] font-medium leading-8 tracking-[-0.02em] text-ink md:text-[30px] md:leading-10">
              <span className="absolute -ml-[0.45em]" aria-hidden>&ldquo;</span>
              Our cortado with a twist of <span className="hand-underline">fresh orange peel</span> and a pinch of dark chocolate.
              Bright up front, round at the finish.&rdquo;
            </p>
          </blockquote>
          <figcaption className="flex items-end border-t border-rule-subtle px-6 pb-10 pt-6 md:border-l md:border-t-0 md:px-8 md:pb-10">
            <div className="flex items-center gap-3">
              <span className="flex size-11 items-center justify-center rounded-full bg-white ring-1 ring-[#E5E5E5]">
                <StoreTile colorIndex={WILLIAMSBURG.colorIndex} name={WILLIAMSBURG.name} size="lg" />
              </span>
              <span>
                <span className="block text-[16px] font-medium leading-6 text-ink">Orange Peel Cortado</span>
                <span className="block text-[14px] leading-5 text-ink-2">
                  <span className="definition-underline">The special</span> · {WEEK_LABEL}
                </span>
              </span>
            </div>
          </figcaption>
        </div>
      </div></div>
    </section>
  );
}
