import { BRAND_MARKS, BrandGlyph, type Brand } from "./brand-glyphs";
import { cx } from "./cx";

export type Provider =
  | "qloo" | "nemotron" | "tavily" | "square" | "slack" | "gmail" | "outlook"
  | "guardrails" | "calendar" | "eventbrite" | "tokenfactory";

const META: Record<Provider, { name: string; mark: string; brand?: Brand; glyph?: "shield" | "calendar" }> = {
  qloo: { name: "Qloo", mark: "Q", brand: "qloo" },
  nemotron: { name: "Nemotron", mark: "N", brand: "nvidia" },
  tokenfactory: { name: "Token Factory", mark: "TF", brand: "nebius" },
  tavily: { name: "Tavily", mark: "T", brand: "tavily" },
  square: { name: "Square", mark: "Sq", brand: "square" },
  slack: { name: "Slack", mark: "S", brand: "slack" },
  gmail: { name: "Gmail", mark: "G", brand: "gmail" },
  outlook: { name: "Outlook", mark: "O", brand: "outlook" },
  guardrails: { name: "NeMo Guardrails", mark: "G", brand: "nvidia" },
  calendar: { name: "Calendar feed", mark: "C", glyph: "calendar" },
  eventbrite: { name: "Eventbrite", mark: "E" },
};

export const providerName = (p: Provider): string => META[p].name;

function GenericGlyph({ kind }: { kind: "shield" | "calendar" }) {
  return kind === "calendar" ? (
    <svg viewBox="0 0 16 16" fill="none" className="size-[62%]" aria-hidden><rect x="2.5" y="3.5" width="11" height="10" rx="2" stroke="currentColor" strokeWidth="1.5" /><path d="M2.5 6.5h11M5.5 2v3M10.5 2v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
  ) : (
    <svg viewBox="0 0 16 16" fill="none" className="size-[62%]" aria-hidden><path d="M8 2 13 4v4c0 3-2.2 5-5 6-2.8-1-5-3-5-6V4l5-2Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /></svg>
  );
}

/** A provider's tile: white, faint ring, its official mark (in colour where the brand's own mark is multi-colour). */
export function ProviderTile({ provider, size = 24, className }: { provider: Provider; size?: number; className?: string }) {
  const m = META[provider];
  const mark = m.brand ? BRAND_MARKS[m.brand] : undefined;
  return (
    <span
      className={cx("inline-flex shrink-0 items-center justify-center bg-white text-ink shadow-ring-xs", className)}
      style={{ width: size, height: size, borderRadius: size >= 24 ? 6 : 5, color: mark && !mark.color ? mark.hex : undefined }}
      title={m.name}
      aria-hidden
    >
      {mark && m.brand ? (
        <BrandGlyph brand={m.brand} colored className="size-[62%]" />
      ) : m.glyph ? (
        <GenericGlyph kind={m.glyph} />
      ) : (
        <span className="text-[10px] font-semibold leading-none text-ink-2">{m.mark}</span>
      )}
    </span>
  );
}

/** A provider tile plus its name. */
export function ProviderBadge({ provider, label, compact, className }: { provider: Provider; label?: string; compact?: boolean; className?: string }) {
  const m = META[provider];
  return (
    <span className={cx("inline-flex min-w-0 items-center gap-1.5 text-[13px] font-medium text-ink-2", className)} title={m.name}>
      <ProviderTile provider={provider} size={compact ? 18 : 20} />
      {compact ? <span className="sr-only">{m.name}</span> : <span className="truncate">{label ?? m.name}</span>}
    </span>
  );
}
