import type { ComponentProps, ReactNode } from "react";
import type { EditionStatus, GuardrailStatus, ItemStatus } from "@/contract";
import { cx } from "./cx";

type Tone = "neutral" | "ok" | "warn" | "flag" | "info" | "accent";

const toneClass: Record<Tone, string> = {
  neutral: "bg-white text-ink-strong shadow-ring-xs",
  ok: "bg-ok-bg text-ok-strong",
  warn: "bg-warn-bg text-warn-ink",
  flag: "bg-flag-bg text-flag-ink",
  info: "bg-white text-ink-strong shadow-ring-xs",
  accent: "bg-accent-subtle text-accent-text",
};

const dotClass: Record<Tone, string> = {
  neutral: "bg-faint", ok: "bg-ok", warn: "bg-warn", flag: "bg-flag", info: "bg-info le-live-dot", accent: "bg-accent",
};

/** Status chip: h-6, 6px radius, 12/500. Tones follow the status map in the design system. */
export function Chip({ tone = "neutral", dot, mono, className, children, ...rest }: { tone?: Tone; dot?: boolean; mono?: boolean; children: ReactNode } & ComponentProps<"span">) {
  return (
    <span
      className={cx(
        "inline-flex h-6 max-w-full shrink-0 items-center gap-1.5 rounded-md px-2 text-[12px] font-medium leading-4 whitespace-nowrap",
        mono && "font-mono text-[11.5px]",
        toneClass[tone],
        className,
      )}
      {...rest}
    >
      {dot ? <span className={cx("size-1.5 shrink-0 rounded-full", dotClass[tone])} aria-hidden /> : null}
      <span className="truncate">{children}</span>
    </span>
  );
}

type AnyStatus = ItemStatus | EditionStatus;
const STATUS: Record<AnyStatus, { tone: Tone; label: string; dot?: boolean }> = {
  drafting: { tone: "info", label: "Drafting", dot: true },
  draft: { tone: "neutral", label: "Draft" },
  flagged: { tone: "flag", label: "Flagged" },
  approved: { tone: "ok", label: "Approved" },
  edited: { tone: "ok", label: "Edited, approved" },
  rejected: { tone: "neutral", label: "Rejected" },
};

/** Edition or item status, one word, one colour. */
export function StatusChip({ status, className }: { status: AnyStatus; className?: string }) {
  const s = STATUS[status];
  return (
    <Chip tone={s.tone} dot={s.dot} className={cx(status === "rejected" && "text-muted", className)} data-status={status}>
      {s.label}
    </Chip>
  );
}

export const statusTone = (status: AnyStatus): Tone => STATUS[status].tone;

const GUARD: Record<GuardrailStatus, { tone: Tone; label: string }> = {
  passed: { tone: "ok", label: "Guardrails passed" },
  rewritten: { tone: "warn", label: "Guardrails rewrote it" },
  blocked: { tone: "flag", label: "Guardrails blocked it" },
  unchecked: { tone: "warn", label: "Not checked yet" },
};

/** The guardrail verdict on a piece of copy. */
export function GuardrailChip({ status, short, className }: { status: GuardrailStatus; short?: boolean; className?: string }) {
  const g = GUARD[status];
  return <Chip tone={g.tone} className={className}>{short ? g.label.replace("Guardrails ", "") : g.label}</Chip>;
}

/** The dark "Sample" badge (ByDefault's "New" badge). */
export function SampleBadge({ children = "Sample", className }: { children?: ReactNode; className?: string }) {
  return (
    <span className={cx(
      "inline-flex h-[22px] shrink-0 items-center rounded-full bg-stone-900 px-2 text-[12px] font-medium leading-none text-stone-50",
      "shadow-[inset_0_1px_0_rgb(255_255_255/.14)]",
      className,
    )}>
      {children}
    </span>
  );
}

/**
 * Section eyebrow pill: white, stone ring, an icon well and a 14/500 label. The only eyebrow in the system.
 * `dark` for use on the dark bands.
 */
export function Pill({ icon, badge, dark, className, children }: { icon?: ReactNode; badge?: ReactNode; dark?: boolean; className?: string; children: ReactNode }) {
  return (
    <span className={cx(
      "inline-flex h-8 max-w-full items-center gap-2 rounded-full pr-3.5 text-[14px] font-medium leading-5",
      icon || badge ? "pl-[5px]" : "pl-3.5",
      dark ? "bg-white/5 text-band-ink shadow-[inset_0_0_0_1px_rgb(255_255_255/.12)]" : "bg-white text-ink-strong shadow-pill",
      className,
    )}>
      {icon ? (
        <span className={cx(
          "flex size-[22px] shrink-0 items-center justify-center rounded-full [&_svg]:size-3",
          dark ? "bg-white/[.06] text-band-ink-2 shadow-[inset_0_0_0_1px_rgb(255_255_255/.08)]" : "bg-stone-100 text-ink-2 shadow-[inset_0_0_0_1px_#E7E5E4]",
        )} aria-hidden>
          {icon}
        </span>
      ) : null}
      {badge}
      <span className="truncate">{children}</span>
    </span>
  );
}

/** Tag chip used in tables and evidence: white, hairline border, 13px, optional icon and count. */
export function TagChip({ icon, count, className, children, ...rest }: { icon?: ReactNode; count?: ReactNode; children: ReactNode } & ComponentProps<"span">) {
  return (
    <span className={cx("inline-flex h-7 max-w-full items-center gap-1.5 rounded-md border border-rule bg-white px-2 text-[13px] leading-5 text-ink-strong", className)} {...rest}>
      {icon ? <span className="flex size-3.5 shrink-0 items-center justify-center text-faint" aria-hidden>{icon}</span> : null}
      <span className="truncate">{children}</span>
      {count !== undefined ? <span className="tnum text-muted">{count}</span> : null}
    </span>
  );
}
