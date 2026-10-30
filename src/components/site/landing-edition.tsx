import type { ReactNode } from "react";
import { BrandGlyph, Chip, SampleBadge, StoreTile, TagChip, type Brand } from "@/components/ui";
import { GUARDRAIL_DIFF, WEEK_LABEL, WILLIAMSBURG } from "./landing-data";
import { LandingCards } from "./landing-cards";
import { Reveal } from "./reveal";
import { Container, Icon, SectionHeader } from "./section";

function Badge({ n }: { n: number }) {
  return (
    <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-white text-[11px] font-semibold text-ink-2 ring-1 ring-rule tnum" aria-hidden>
      {n}
    </span>
  );
}

function Item({ n, label, title, children, i }: { n: number; label: string; title: string; children: ReactNode; i: number }) {
  return (
    <div className="le-reveal relative border-t border-rule-subtle py-6 first:border-t-0 first:pt-2" style={{ ["--i" as string]: i }}>
      <div className="flex items-center gap-2.5">
        <Badge n={n} />
        <span className="text-[14px] font-medium text-ink-2">{label}</span>
      </div>
      <p className="mt-3 text-[19px] font-medium leading-7 tracking-[-0.02em] text-ink">{title}</p>
      <div className="mt-1.5 text-[15px] leading-[26px] text-ink-2">{children}</div>
    </div>
  );
}

function Note({ n, title, body, chips, extra }: { n: number; title: string; body: string; chips: ReactNode; extra?: ReactNode }) {
  return (
    <div className="relative pl-9">
      <span className="absolute left-0 top-0.5"><Badge n={n} /></span>
      <p className="text-[16px] font-medium leading-6 text-ink">{title}</p>
      <p className="mt-1 text-[14px] leading-[22px] text-ink-2">{body}</p>
      {extra}
      <div className="mt-3 flex flex-wrap gap-1.5">{chips}</div>
    </div>
  );
}

const glyph = (b: Brand) => <BrandGlyph brand={b} className="size-3.5" />;

/** The edition feature frame: a white document of one store's week beside an annotation rail. */
export function LandingEdition() {
  const top = WILLIAMSBURG.tags[0]!;
  return (
    <section id="edition" className="relative scroll-mt-16 border-y border-rule" aria-labelledby="edition-title">
      <div className="mx-auto max-w-[1190px] p-2 sm:p-3"><div className="ring-after relative rounded-xl bg-white">
        <Container className="px-4 pb-14 pt-16 sm:px-6 md:pb-20 md:pt-24 lg:px-10">
          <SectionHeader
            id="edition-title" pill="The edition" pillIcon={Icon.doc} pillBadge={<SampleBadge>Sample</SampleBadge>}
            title="One front page per store, with the proof attached."
            lede="Four items, each from the store's own menu and its own block. Nothing reaches a store until head office approves it."
          />
          <Reveal className="mt-14 rounded-xl bg-paper-2 p-3 shadow-[inset_0_0_0_1px_var(--rule)] sm:p-6 lg:p-10">
            <div className="grid gap-x-10 gap-y-10 lg:grid-cols-[minmax(0,640px)_minmax(0,334px)] lg:justify-center">
              <article className="overflow-hidden rounded-xl bg-white shadow-ring-xs">
                <header className="flex h-[52px] items-center justify-between gap-3 border-b border-rule-subtle px-5">
                  <span className="flex min-w-0 items-center gap-2 text-[14px] text-ink-2">
                    <StoreTile colorIndex={WILLIAMSBURG.colorIndex} name={WILLIAMSBURG.name} size="sm" />
                    <span className="font-medium text-ink">Williamsburg</span>
                    <span className="text-faint">›</span>
                    <span className="truncate">Week of {WEEK_LABEL}</span>
                  </span>
                  <Chip>Draft</Chip>
                </header>
                <div className="px-5 pb-4 pt-5 sm:px-8">
                  <Item i={0} n={1} label="The special" title="Orange Peel Cortado">
                    Our cortado with a twist of fresh orange peel and a pinch of dark chocolate. Bright up front, round at the finish.
                    <span className="mt-3 flex flex-wrap items-center gap-1.5 text-[13px] text-muted">
                      Evidence
                      <span className="inline-flex h-6 items-center gap-1.5 rounded-md bg-mark px-2 font-medium text-ink">{glyph("qloo")}{top.name} +{top.lift.toFixed(2)}</span>
                      <span className="inline-flex h-6 items-center rounded-md border border-rule px-2 text-ink-2">{WILLIAMSBURG.tags[1]?.name} +{WILLIAMSBURG.tags[1]?.lift.toFixed(2)}</span>
                    </span>
                  </Item>
                  <Item i={1} n={2} label="On the speakers" title="Jangly, unhurried, a little scuffed">
                    Big Thief, Yo La Tengo, Parquet Courts. Keep it low until noon, then let it climb.
                  </Item>
                  <Item i={2} n={3} label="Partner nearby" title="Tern & Tallow Vintage">
                    A dollar off any cortado with a Tern &amp; Tallow receipt; they pin our card by their register.
                  </Item>
                  <Item i={3} n={4} label="Event night" title="Vinyl and Cortado Night · Thu 19:00">
                    Neighbours bring one record to play. We keep the volume where people can still talk.
                  </Item>
                </div>
              </article>
              <aside className="relative grid content-start gap-10 lg:pt-16">
                <span aria-hidden className="absolute bottom-2 left-[9.5px] top-2 hidden w-px bg-rule lg:block lg:top-[72px]" />
                <Note
                  n={1} title="Picked from the block's taste"
                  body={`Qloo puts ${top.name} at ${top.affinity.toFixed(2)} affinity here, ${top.lift.toFixed(2)} above the city. The special and the music follow it.`}
                  chips={<><TagChip icon={glyph("qloo")}>/v2/insights</TagChip><TagChip>lift +{top.lift.toFixed(2)}</TagChip></>}
                />
                <Note
                  n={2} title="Checked before anyone sees it"
                  body={`In ${GUARDRAIL_DIFF.store} the first draft claimed the drink gives you energy. The health-claim rail caught it and the line was rewritten.`}
                  extra={
                    <div className="mt-3 grid gap-1 text-[13px] leading-5">
                      <p className="rounded-r-md border-l-2 border-diff-del-rule bg-diff-del-bg px-3 py-2 text-diff-del-ink line-through decoration-diff-del-ink/40">{GUARDRAIL_DIFF.before}</p>
                      <p className="rounded-r-md border-l-2 border-diff-add-rule bg-diff-add-bg px-3 py-2 text-diff-add-ink">{GUARDRAIL_DIFF.after}</p>
                    </div>
                  }
                  chips={<><TagChip icon={glyph("nvidia")}>NeMo Guardrails</TagChip><Chip tone="flag">Health claim removed</Chip></>}
                />
                <Note
                  n={3} title="Sent where staff already look"
                  body="Approved editions go to the store's Slack channel and inbox, and the staff card opens on any phone."
                  chips={<><TagChip icon={glyph("slack")}>Slack</TagChip><TagChip icon={glyph("gmail")}>Email</TagChip><TagChip icon={glyph("gcal")}>Calendar</TagChip></>}
                />
              </aside>
            </div>
          </Reveal>
          <LandingCards />
        </Container>
      </div></div>
    </section>
  );
}
