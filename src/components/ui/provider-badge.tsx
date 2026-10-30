import { cx } from "./cx";

export type Provider =
  | "qloo" | "nemotron" | "tavily" | "square" | "slack" | "gmail" | "outlook"
  | "guardrails" | "calendar" | "eventbrite" | "tokenfactory";

const META: Record<Provider, { name: string; mark: string; tone: string }> = {
  qloo: { name: "Qloo", mark: "Q", tone: "var(--store-4)" },
  nemotron: { name: "Nemotron", mark: "N", tone: "var(--store-2)" },
  tokenfactory: { name: "Token Factory", mark: "TF", tone: "var(--store-2)" },
  tavily: { name: "Tavily", mark: "T", tone: "var(--store-3)" },
  square: { name: "Square", mark: "Sq", tone: "var(--ink-2)" },
  slack: { name: "Slack", mark: "S", tone: "var(--store-6)" },
  gmail: { name: "Gmail", mark: "G", tone: "var(--flag)" },
  outlook: { name: "Outlook", mark: "O", tone: "var(--info)" },
  guardrails: { name: "NeMo Guardrails", mark: "G", tone: "var(--ok)" },
  calendar: { name: "Calendar feed", mark: "C", tone: "var(--store-5)" },
  eventbrite: { name: "Eventbrite", mark: "E", tone: "var(--store-1)" },
};

export const providerName = (p: Provider): string => META[p].name;

/** A monogram tile plus the provider's name. Not a logo: a plain mark in the provider's tint. */
export function ProviderBadge({ provider, label, compact, className }: { provider: Provider; label?: string; compact?: boolean; className?: string }) {
  const m = META[provider];
  return (
    <span className={cx("inline-flex min-w-0 items-center gap-1.5 text-[12px] font-medium text-ink-2", className)} title={m.name}>
      <span
        className="inline-flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-[4px] px-1 font-mono text-[10px] font-semibold"
        style={{ color: m.tone, background: `color-mix(in oklab, ${m.tone} 14%, transparent)`, boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${m.tone} 35%, transparent)` }}
        aria-hidden
      >
        {m.mark}
      </span>
      {compact ? <span className="sr-only">{m.name}</span> : <span className="truncate">{label ?? m.name}</span>}
    </span>
  );
}
