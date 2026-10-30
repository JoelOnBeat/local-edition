/** The weekly loop in four steps. */

const STEPS = [
  {
    day: "Inputs",
    title: "Read the block",
    body:
      "Qloo's Taste AI scores what the few streets around each store like, against the city as a whole: flavours, music, places, pastimes. The menu and store list come straight from Square.",
    tools: ["Qloo Taste AI", "Square"],
  },
  {
    day: "Monday build",
    title: "Draft the edition",
    body:
      "A Nemotron agent on Nebius Token Factory calls tools for each store, adapts one item from your own menu, picks artists, a neighbour and an event, and keeps the evidence for every line. Tavily checks what is on nearby that week.",
    tools: ["Nemotron", "Nebius Token Factory", "Tavily"],
  },
  {
    day: "Head office",
    title: "Check and approve",
    body:
      "NeMo Guardrails removes health claims and off-voice copy. A larger Nemotron reviews the whole chain for clashes. Head office approves, edits or regenerates on the portfolio map, store by store or all at once.",
    tools: ["NeMo Guardrails", "Nemotron Ultra", "Slack"],
  },
  {
    day: "In store",
    title: "Deliver to the store",
    body:
      "The approved special goes onto the Square menu, the staff card goes to the store's Slack channel and inbox, and event nights land in the store calendar. When a menu changes in Square, the next edition knows.",
    tools: ["Square", "Slack", "Gmail", "Outlook", "Calendar"],
  },
];

export function LandingLoop() {
  return (
    <section id="how" className="scroll-mt-16 border-b border-(--rule)">
      <div className="mx-auto max-w-[1180px] px-4 py-14 sm:px-6">
        <SectionHead kicker="The weekly loop" title="Four steps, every Monday, for every store." />
        <ol className="mt-8 grid gap-px overflow-hidden rounded-(--radius) border border-(--rule) bg-(--rule) sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s, i) => (
            <li key={s.title} className="grid content-start gap-3 bg-(--paper) p-5">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-(family-name:--font-display) text-[40px] font-extrabold leading-none text-(--accent)">
                  {i + 1}
                </span>
                <span className="font-(family-name:--font-mono) text-[11.5px] uppercase tracking-[0.06em] text-(--muted)">{s.day}</span>
              </div>
              <h3 className="font-(family-name:--font-display) text-[21px] font-bold leading-tight">{s.title}</h3>
              <p className="text-[15px] leading-[1.55] text-(--ink-2)">{s.body}</p>
              <ul className="flex flex-wrap gap-1.5" aria-label="Uses">
                {s.tools.map((t) => (
                  <li key={t} className="rounded-full border bg-(--paper-2) border-(--rule) px-2 py-0.5 text-[12px] text-(--ink-2)">
                    {t}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

export function SectionHead({ kicker, title, lede }: { kicker: string; title: string; lede?: string }) {
  return (
    <div className="grid gap-2">
      <span className="text-[11.5px] font-semibold uppercase tracking-[0.09em] text-(--muted)">{kicker}</span>
      <h2 className="max-w-[24ch] font-(family-name:--font-display) text-[clamp(28px,3.6vw,40px)] font-extrabold leading-[1.05] tracking-[-0.02em] text-balance">
        {title}
      </h2>
      {lede ? <p className="max-w-[64ch] text-[16px] leading-[1.55] text-(--ink-2)">{lede}</p> : null}
    </div>
  );
}
