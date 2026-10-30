import Link from "next/link";
import type { ReactNode } from "react";
import type { Provider } from "../ui";
import { CardBand, Pill } from "../ui";
import { Band, Gap, Page, PageHeader } from "../app-ui/frame";
import { Icon, type IconName } from "../app-ui/icons";
import { LogoTile } from "../app-ui/tiles";

interface Step { n: string; title: string; body: ReactNode; tools: Provider[]; where: { href: string; label: string; icon: IconName } }

const STEPS: Step[] = [
  {
    n: "01",
    title: "Connect Square",
    body: "The menu and the locations come in from Square, and a signed webhook keeps them current. A photo of the menu board or a store CSV works too.",
    tools: ["square"],
    where: { href: "/app/connections", label: "Connections", icon: "plug" },
  },
  {
    n: "02",
    title: "Read each block's taste",
    body: "Qloo describes what the people near each store lean toward: tags, artists, places, and how much more than the rest of New York. Only coordinates, brand ids and tag ids are sent.",
    tools: ["qloo"],
    where: { href: "/app/compare", label: "Compare two blocks", icon: "columns" },
  },
  {
    n: "03",
    title: "Write and check the edition",
    body: "A Nemotron agent on Nebius Token Factory plans each store's special, sound brief, partner and event night and calls the tools it needs. Tavily finds this week's local events. Every line is checked by guardrails, an item without evidence is dropped, and Nemotron 3 Ultra reads the whole chain side by side.",
    tools: ["nemotron", "tokenfactory", "tavily", "guardrails"],
    where: { href: "/app/runs", label: "Watch a run", icon: "terminal" },
  },
  {
    n: "04",
    title: "Approve and send",
    body: "Head office approves on the portfolio. Approved specials go back to Square, staff cards to Slack and email, event nights to the calendar feed. Store replies come back to the edition.",
    tools: ["square", "slack", "gmail", "outlook", "calendar"],
    where: { href: "/app", label: "Portfolio", icon: "grid" },
  },
];

/** /app/how-it-works: the weekly loop in four steps, each pointing at the place in the app where it is visible. */
export function HowItWorksView() {
  return (
    <Page>
      <PageHeader
        pill={<Pill icon={<Icon name="layers" />}>How it works</Pill>}
        title="From block taste to staff card, every Monday"
        lede="Four steps, one edition per store. Each step below links to where you can watch it happen."
      />
      <Gap />
      <Band grow>
        <ol className="grid gap-3 md:grid-cols-2">
          {STEPS.map((s) => (
            <li key={s.n} className="min-w-0">
              <CardBand
                title={<span className="flex items-center gap-2.5"><span className="tnum text-faint">{s.n}</span>{s.title}</span>}
                actions={<span className="flex items-center -space-x-1">{s.tools.map((t) => <LogoTile key={t} provider={t} size="sm" className="ring-2 ring-paper-2" />)}</span>}
                className="h-full"
                bodyClassName="flex flex-1 flex-col gap-4"
              >
                <p className="text-[15px] leading-6 text-ink-2">{s.body}</p>
                <Link href={s.where.href} className="mt-auto inline-flex w-fit items-center gap-1.5 rounded-md text-[14px] font-medium text-ink-strong underline decoration-stone-300 underline-offset-[3px] transition-colors hover:decoration-ink">
                  <Icon name={s.where.icon} size={14} className="text-faint" />
                  {s.where.label}
                  <Icon name="arrowRight" size={14} className="text-faint" />
                </Link>
              </CardBand>
            </li>
          ))}
        </ol>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <Fact icon="shield" title="Checked twice" body="Live checks on every build and edit; NeMo Guardrails certifies items in a Nebius job started on demand." href="/app/proof" />
          <Fact icon="file" title="Evidence on every line" body="Open “Why this?” on any item to see the Qloo and Tavily calls behind it." href="/app" />
          <Fact icon="gauge" title="Hard caps" body="Model spend, Qloo and Tavily calls each stop at a cap, with a plain message." href="/app/limits" />
        </div>
      </Band>
    </Page>
  );
}

function Fact({ icon, title, body, href }: { icon: IconName; title: string; body: string; href: string }) {
  return (
    <Link href={href} className="group relative flex gap-3 rounded-xl bg-white p-4 shadow-ring-xs transition-[box-shadow,scale] duration-150 hover:shadow-ring-sm active:scale-[.99]">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-well text-ink-2 shadow-[inset_0_0_0_1px_var(--well-ring)]"><Icon name={icon} /></span>
      <span className="min-w-0">
        <span className="block text-[14px] font-medium text-ink-strong">{title}</span>
        <span className="mt-0.5 block text-[14px] leading-5 text-ink-2">{body}</span>
      </span>
      <Icon name="arrowUpRight" size={14} className="absolute right-3.5 top-3.5 text-faint transition-[translate,color] duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-ink-2" />
    </Link>
  );
}
