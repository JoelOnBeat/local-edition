"use client";

import { useState } from "react";
import type { Evidence } from "@/contract";
import { Chip, cx, headlineMetric, type Provider } from "../ui";
import { Icon } from "../app-ui/icons";
import { LogoTile, PROVIDER_NAME } from "../app-ui/tiles";
import { formatDateTime, formatMeters } from "../lib/format";

const MODE: Record<Evidence["mode"], { label: string; tone: "ok" | "warn" | "neutral" }> = {
  live: { label: "Live call", tone: "ok" },
  replay: { label: "Recorded call", tone: "neutral" },
  fixture: { label: "Sample data", tone: "warn" },
  cache: { label: "Cached", tone: "neutral" },
};

/** Qloo answers are only ever live or a saved live answer; the label says which, and the row's time is when Qloo answered. */
const QLOO_MODE: Partial<Record<Evidence["mode"], { label: string; tone: "ok" | "neutral"; when: string }>> = {
  live: { label: "Live Qloo call", tone: "ok", when: "Called" },
  cache: { label: "Cached live Qloo answer", tone: "neutral", when: "Answered" },
};

/**
 * Which mark an evidence row earns: Token Factory calls are NVIDIA Nemotron only when the model is one; other models
 * (the Qwen embedding and reranker) show the Nebius Token Factory mark that served them.
 */
export function evidenceProvider(e: Evidence): Provider {
  if (e.source !== "tokenfactory") return e.source;
  return /nvidia|nemotron/i.test(e.params.model ?? "") ? "nemotron" : "tokenfactory";
}

/** Small evidence chip for item cards: provider mark, endpoint in mono, the headline number. Opens the drawer. */
export function EvidenceTag({ e, onClick }: { e: Evidence; onClick?: () => void }) {
  const metric = headlineMetric(e);
  return (
    <button type="button" onClick={onClick} aria-label={`Evidence: ${e.summary}`}
      className={cx("inline-flex h-7 max-w-full items-center gap-1.5 rounded-md border border-rule bg-white pl-1 pr-2 text-left",
        "transition-[background-color,scale] duration-150 ease-quint hover:bg-paper-2 active:scale-[.97]")}>
      <LogoTile provider={evidenceProvider(e)} size="xs" />
      <span className="truncate font-mono text-[12px] text-ink-2">{e.endpoint}</span>
      {metric ? <span className="shrink-0 text-[13px] font-medium text-ink-strong tnum">{metric}</span> : null}
    </button>
  );
}

/** One call an item rests on: provider, endpoint, its numbers, what it said, and the exact parameters. */
export function EvidenceRow({ e }: { e: Evidence }) {
  const m = e.metrics;
  const metrics: [string, string][] = [];
  if (m.affinity !== undefined) metrics.push(["affinity", m.affinity.toFixed(2)]);
  if (m.lift !== undefined) metrics.push(["lift", `${m.lift >= 0 ? "+" : "−"}${Math.abs(m.lift).toFixed(2)}`]);
  if (m.popularity !== undefined) metrics.push(["popularity", m.popularity.toFixed(2)]);
  if (m.distanceM !== undefined) metrics.push(["distance", formatMeters(m.distanceM)]);
  if (m.relevance !== undefined) metrics.push(["relevance", m.relevance.toFixed(2)]);
  const provider = evidenceProvider(e);
  const head = headlineMetric(e);
  const params = Object.entries(e.params).map(([k, v]) => `${k}=${v}`).join("\n");
  const qloo = e.source === "qloo" ? QLOO_MODE[e.mode] : undefined;
  const mode = qloo ?? MODE[e.mode];

  return (
    <li className="rounded-xl bg-white p-4 shadow-ring-xs">
      <div className="flex items-start gap-3">
        <LogoTile provider={provider} size="md" />
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-x-2 text-[14px] font-medium text-ink-strong">
            {PROVIDER_NAME[provider]}
            {head ? <span className="text-ink-2 tnum">· {head}</span> : null}
          </p>
          <p className="mt-0.5 font-mono text-[13px] text-ink-2 [overflow-wrap:anywhere]">{e.endpoint}</p>
        </div>
        <Chip tone={mode.tone}>{mode.label}</Chip>
      </div>
      <p className="mt-3 text-[14px] leading-[22px] text-ink-2 [overflow-wrap:anywhere]">{e.summary}</p>
      {metrics.length ? (
        <dl className="mt-3 flex flex-wrap gap-1.5">
          {metrics.map(([k, v]) => (
            <div key={k} className="inline-flex h-7 items-center gap-1.5 rounded-full bg-white px-2.5 text-[13px] shadow-pill">
              <dt className="text-muted">{k}</dt>
              <dd className="font-mono text-[12px] text-ink">{v}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {params ? <CodeFrame text={params} /> : null}
      <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted">
        <span className="font-mono">{qloo ? `${qloo.when} ` : ""}{formatDateTime(e.fetchedAt)} NY</span>
        {e.url ? (
          <a href={e.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 font-medium text-ink-2 underline decoration-stone-300 underline-offset-[3px] hover:text-ink">
            Source<Icon name="arrowUpRight" size={12} />
          </a>
        ) : null}
      </p>
    </li>
  );
}

/** Code frame: a soft well around a white plate, mono 12px, with a copy button. */
export function CodeFrame({ text, label = "Parameters" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState<"idle" | "ok" | "fail">("idle");
  return (
    <div className="mt-3 rounded-2xl bg-black/[.04] p-1">
      <div className="flex items-center justify-between px-2.5 pb-1 pt-0.5">
        <span className="text-[12px] font-medium text-ink-2">{label}</span>
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(text);
              setCopied("ok");
            } catch {
              setCopied("fail");
            }
            setTimeout(() => setCopied("idle"), 1600);
          }}
          className="inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[12px] font-medium text-ink-2 transition-colors hover:bg-black/5 hover:text-ink"
          aria-label="Copy parameters"
        >
          <Icon name={copied === "ok" ? "check" : "copy"} size={12} />
          {copied === "ok" ? "Copied" : copied === "fail" ? "Copy failed" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto whitespace-pre-wrap rounded-xl bg-white px-3 py-2.5 font-mono text-[12px] leading-5 text-ink-2 shadow-plate [overflow-wrap:anywhere]">{text}</pre>
    </div>
  );
}
