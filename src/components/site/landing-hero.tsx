import Link from "next/link";

/** Landing hero: what Local Edition is and who it is for, set like a newspaper front page. */

export function LandingHero() {
  return (
    <section className="border-b border-(--rule)">
      <div className="mx-auto max-w-[1180px] px-4 pb-14 pt-10 sm:px-6 md:pt-16">
        <div className="flex flex-wrap items-center justify-between gap-2 border-y-2 border-(--ink) py-1.5 font-(family-name:--font-mono) text-[11.5px] uppercase tracking-[0.08em] text-(--ink-2)">
          <span>For chains with 5 to 500 stores</span>
          <span className="hidden sm:inline">Published every Monday</span>
          <span>One edition per store</span>
        </div>

        <h1 className="mt-8 max-w-[16ch] font-(family-name:--font-display) text-[clamp(40px,7.4vw,92px)] font-extrabold leading-[0.95] tracking-[-0.03em] text-balance">
          Every store gets its own front page, every week.
        </h1>

        <div className="mt-8 grid gap-8 md:grid-cols-[1.25fr_1fr] md:gap-12">
          <p className="max-w-[60ch] text-[18px] leading-[1.55] text-(--ink-2) md:text-[19px]">
            Local Edition gives a chain&apos;s head office a weekly edition for each store: a special adapted from its own menu,
            a sound brief, a neighbour to partner with and an event night. Each one is drafted by an NVIDIA Nemotron agent from
            the taste of that store&apos;s block, checked by NeMo Guardrails and shipped with the evidence behind every line.
            Head office approves on one map. Each store gets a one-page staff card.
          </p>
          <div className="grid content-start gap-4">
            <div className="flex flex-wrap gap-3">
              <Link
                href="/app"
                className="rounded-(--radius) bg-(--accent) px-5 py-3 text-[16px] font-semibold text-(--accent-ink) hover:opacity-90"
              >
                Open the sample chain
              </Link>
              <Link
                href="#how"
                className="rounded-(--radius) border border-(--rule) px-5 py-3 text-[16px] font-semibold text-(--ink) hover:border-(--ink)"
              >
                How it works
              </Link>
            </div>
            <HackathonNote />
          </div>
        </div>
      </div>
    </section>
  );
}

export function HackathonNote() {
  return (
    <p className="rounded-(--radius) border border-dashed border-(--rule) bg-(--paper-2) px-3.5 py-3 text-[13.5px] leading-[1.5] text-(--muted)">
      <strong className="font-semibold text-(--ink-2)">A hackathon build.</strong> The chain you will open, Kettle &amp; Kiln, is a
      labelled sample: eight coffee shops at real New York corners, not a customer. Its tools are test accounts: a Square
      sandbox, a demo Slack workspace and a demo mailbox. There is no pricing and nothing to buy.
    </p>
  );
}
