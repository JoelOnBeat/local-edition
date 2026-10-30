import type { ComponentProps, ReactNode } from "react";
import type { EditionStatus, GuardrailStatus, ItemStatus } from "@/contract";
import { cx } from "./cx";

type Tone = "neutral" | "ok" | "warn" | "flag" | "info" | "accent";

const toneVar: Record<Exclude<Tone, "neutral">, string> = {
  ok: "var(--ok)", warn: "var(--warn)", flag: "var(--flag)", info: "var(--info)", accent: "var(--accent)",
};

/** A small rounded label. Tones tint from the shared status colours. */
export function Chip({ tone = "neutral", dot, mono, className, children, ...rest }: { tone?: Tone; dot?: boolean; mono?: boolean; children: ReactNode } & ComponentProps<"span">) {
  const c = tone === "neutral" ? null : toneVar[tone];
  return (
    <span
      className={cx(
        "inline-flex h-6 max-w-full items-center gap-1.5 rounded-full border px-2.5 text-[12px] font-medium leading-none",
        mono && "font-mono text-[11.5px]",
        tone === "neutral" && "border-rule bg-paper-2 text-ink-2",
        className,
      )}
      style={c ? { color: c, borderColor: `color-mix(in oklab, ${c} 40%, transparent)`, background: `color-mix(in oklab, ${c} 9%, transparent)` } : undefined}
      {...rest}
    >
      {dot ? <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: c ?? "var(--muted)" }} aria-hidden /> : null}
      <span className="truncate">{children}</span>
    </span>
  );
}

type AnyStatus = ItemStatus | EditionStatus;
const STATUS: Record<AnyStatus, { tone: Tone; label: string }> = {
  drafting: { tone: "info", label: "Drafting" },
  draft: { tone: "neutral", label: "Draft" },
  flagged: { tone: "flag", label: "Flagged" },
  approved: { tone: "ok", label: "Approved" },
  edited: { tone: "ok", label: "Edited, approved" },
  rejected: { tone: "neutral", label: "Rejected" },
};

/** Edition or item status, one word, one colour. */
export function StatusChip({ status, className }: { status: AnyStatus; className?: string }) {
  const s = STATUS[status];
  return <Chip tone={s.tone} dot className={className}>{s.label}</Chip>;
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
