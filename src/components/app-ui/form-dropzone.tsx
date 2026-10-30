"use client";

import { useState, type ReactNode } from "react";
import { Spinner, cx } from "@/components/ui";
import { Icon, type IconName } from "./icons";

export interface DropFile { name: string; size: number; detail?: ReactNode; tone?: "ok" | "flag" }

const kb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/**
 * File dropzone (no "Choose File" button): a 132px well that takes a drop or a click. The real <input type=file> sits
 * visually hidden inside the label, so keyboard, screen readers and `setInputFiles` all reach it. A chosen file shows
 * as a row with its size, a status line and a remove button.
 */
export function Dropzone({ inputTestId, accept, onFile, busy, busyLabel, title, hint, icon = "upload", file, onRemove, disabled, compact }: {
  inputTestId: string;
  accept: string;
  onFile: (f: File) => void;
  busy?: boolean;
  busyLabel?: string;
  title: string;
  hint?: string;
  icon?: IconName;
  file?: DropFile | null;
  onRemove?: () => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  const [over, setOver] = useState(false);
  return (
    <div className="grid gap-2">
      <label
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files?.[0]; if (f && !disabled) onFile(f); }}
        className={cx(
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg bg-well px-4 text-center shadow-[inset_0_0_0_1px_var(--well-ring)] transition-[background-color,box-shadow] duration-150 hover:bg-stone-100 has-[:focus-visible]:shadow-[inset_0_0_0_2px_var(--accent)]",
          compact ? "h-[96px]" : "h-[132px]",
          over && "bg-accent-subtle shadow-[inset_0_0_0_1.5px_var(--accent)]",
          disabled && "pointer-events-none opacity-60",
        )}
      >
        <input data-testid={inputTestId} type="file" accept={accept} disabled={disabled} className="sr-only"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }} />
        {busy ? (
          <span className="inline-flex items-center gap-2 text-[14px] font-medium text-ink-2"><Spinner />{busyLabel ?? "Reading…"}</span>
        ) : (
          <>
            <span className="flex size-9 items-center justify-center rounded-[10px] bg-white text-ink-2 shadow-ring-xs"><Icon name={icon} /></span>
            <span className="text-[14px] font-medium text-ink-strong">{title}</span>
            {hint && !compact ? <span className="text-[13px] text-muted">{hint}</span> : null}
          </>
        )}
      </label>
      {file ? (
        <div className="flex items-center gap-3 rounded-lg bg-white px-3 py-2.5 shadow-ring-xs">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-stone-100 text-ink-2"><Icon name="file" size={14} /></span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14px] font-medium text-ink-strong">{file.name}</span>
            <span className={cx("block truncate text-[13px]", file.tone === "flag" ? "text-flag" : file.tone === "ok" ? "text-ok-ink" : "text-muted")}>
              <span className="tnum">{kb(file.size)}</span>{file.detail ? <> · {file.detail}</> : null}
            </span>
          </span>
          {onRemove ? (
            <button type="button" onClick={onRemove} aria-label={`Remove ${file.name}`} className="flex size-8 shrink-0 items-center justify-center rounded-md text-faint transition-colors hover:bg-stone-100 hover:text-ink">
              <Icon name="x" size={14} />
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
