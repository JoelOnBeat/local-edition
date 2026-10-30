import type { ReactNode } from "react";
import type { GuardrailStatus, ItemStatus } from "@/contract";
import { cx } from "@/components/ui";
import { Icon, type IconName } from "./icons";

/** App-only status pieces on top of ui/ chips: guardrail tag with icons, item pills, mono score pills. */

type Tone = "ok" | "warn" | "flag" | "neutral";
const TONE: Record<Tone, string> = {
  ok: "bg-ok-bg text-ok-strong",
  warn: "bg-warn-bg text-warn-ink",
  flag: "bg-flag-bg text-flag-ink",
  neutral: "bg-white text-ink-strong shadow-ring-xs",
};

export function IconTag({ tone = "neutral", icon, children, className }: { tone?: Tone; icon?: IconName; children: ReactNode; className?: string }) {
  return (
    <span className={cx("inline-flex h-6 max-w-full shrink-0 items-center gap-1.5 rounded-md px-2 text-[12px] font-medium leading-4 whitespace-nowrap", TONE[tone], className)}>
      {icon ? <Icon name={icon} size={12} strokeWidth={2.4} className="shrink-0" /> : null}
      <span className="truncate">{children}</span>
    </span>
  );
}

const GUARD: Record<GuardrailStatus, { tone: Tone; label: string; short: string; icon: IconName }> = {
  passed: { tone: "ok", label: "Guardrails passed", short: "Passed", icon: "shield" },
  rewritten: { tone: "warn", label: "Guardrails rewrote it", short: "Rewritten", icon: "pencil" },
  blocked: { tone: "flag", label: "Guardrails blocked it", short: "Blocked", icon: "x" },
  unchecked: { tone: "warn", label: "Not checked yet", short: "Unchecked", icon: "clock" },
};

/** The guardrail verdict with its icon. `certified` turns a pass into "Certified" (NeMo job ran). */
export function GuardTag({ status, short, certified, className }: { status: GuardrailStatus; short?: boolean; certified?: boolean; className?: string }) {
  const g = GUARD[status];
  return <IconTag tone={g.tone} icon={g.icon} className={className}>{certified && status === "passed" ? "Certified" : short ? g.short : g.label}</IconTag>;
}

/** One 5×14 pill per item, coloured by its status. */
export function ItemPills({ statuses, className }: { statuses: ItemStatus[]; className?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-[3px]", className)} aria-hidden>
      {statuses.map((s, i) => (
        <span
          key={i}
          className="h-3.5 w-[5px] rounded-full"
          style={{ background: s === "approved" || s === "edited" ? "var(--ok)" : s === "flagged" ? "var(--flag)" : "var(--rule)" }}
        />
      ))}
    </span>
  );
}

/** A taste pill: rounded-full white chip, label 13/500, score in mono. Clickable when `onClick` is set. */
export function ScorePill({ children, score, icon, onClick, className, title, tone }: { children: ReactNode; score?: string; icon?: ReactNode; onClick?: () => void; className?: string; title?: string; tone?: "accent" }) {
  const cls = cx(
    "inline-flex h-7 max-w-full items-center gap-1.5 rounded-full px-2.5 text-[13px] font-medium leading-5",
    tone === "accent" ? "bg-accent-subtle text-accent-text" : "bg-white text-ink-strong shadow-pill",
    onClick && "transition-[background-color,scale] duration-150 ease-quint hover:bg-stone-50 active:scale-[.97]",
    icon ? "pl-1" : "",
    className,
  );
  const body = (
    <>
      {icon}
      <span className="truncate">{children}</span>
      {score ? <span className={cx("shrink-0 font-mono text-[12px] font-normal tabular-nums", tone === "accent" ? "text-accent-text/80" : "text-ink-2")}>{score}</span> : null}
    </>
  );
  return onClick ? <button type="button" onClick={onClick} className={cls} title={title}>{body}</button> : <span className={cls} title={title}>{body}</span>;
}

/** Em-dash for a missing value. */
export function Dash({ className }: { className?: string }) {
  return <span className={cx("text-[12px] text-empty", className)} aria-label="none">—</span>;
}

/** Signed lift: "+0.42". */
export const signed = (v: number, digits = 2) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(digits)}`;
