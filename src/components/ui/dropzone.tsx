"use client";

import { useRef, useState, type ReactNode } from "react";
import { cx } from "./cx";

const kb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/**
 * File drop zone (never a "Choose File" button): a 132px well with a solid inset ring that lights up on drag-over,
 * then one row per file with its size and a remove button. The native input stays visually hidden and carries
 * `data-testid`, so Playwright's setInputFiles keeps working. `files` + `onRemove` make the list controlled.
 */
export function Dropzone({
  onFiles, files, onRemove, accept, multiple, disabled, title = "Drop a file here", hint, icon, busy, maxBytes, className, id, "data-testid": testId,
}: {
  onFiles: (files: File[]) => void;
  files?: File[];
  onRemove?: (index: number) => void;
  accept?: string;
  multiple?: boolean;
  disabled?: boolean;
  title?: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  busy?: boolean;
  maxBytes?: number;
  className?: string;
  id?: string;
  "data-testid"?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const take = (list: FileList | null) => {
    if (!list || list.length === 0) return;
    const picked = Array.from(list).slice(0, multiple ? undefined : 1);
    const tooBig = maxBytes ? picked.find((f) => f.size > maxBytes) : undefined;
    if (tooBig) { setError(`${tooBig.name} is larger than ${kb(maxBytes!)}.`); return; }
    setError(null);
    onFiles(picked);
  };

  return (
    <div className={cx("grid gap-2", className)}>
      <label
        htmlFor={id}
        onDragOver={(e) => { e.preventDefault(); if (!disabled) setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); if (!disabled) take(e.dataTransfer.files); }}
        className={cx(
          "group/drop flex h-[132px] cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg bg-well px-4 text-center",
          "transition-[background-color,box-shadow] duration-150 ease-quint",
          over ? "bg-accent-subtle shadow-[inset_0_0_0_1.5px_var(--accent)]" : "shadow-[inset_0_0_0_1px_var(--well-ring)] hover:bg-stone-100",
          "has-[:focus-visible]:shadow-[inset_0_0_0_2px_var(--accent)]",
          (disabled || busy) && "pointer-events-none opacity-60",
        )}
      >
        <span className={cx("flex size-9 items-center justify-center rounded-[10px] bg-white shadow-ring-xs transition-transform duration-200 ease-quint group-hover/drop:-translate-y-0.5", over ? "text-accent" : "text-ink-2")} aria-hidden>
          {icon ?? (
            <svg className="size-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 10.5V2.5M5 5.5l3-3 3 3M2.5 10.5v1.5a1.5 1.5 0 0 0 1.5 1.5h8a1.5 1.5 0 0 0 1.5-1.5v-1.5" />
            </svg>
          )}
        </span>
        <span className="text-[14px] font-medium leading-5 text-ink">{busy ? "Reading…" : title}</span>
        <span className="text-[13px] leading-5 text-muted">{hint ?? <>or <span className="text-ink-2 underline decoration-stone-300 underline-offset-[3px]">browse your files</span></>}</span>
        <input
          ref={input} id={id} type="file" accept={accept} multiple={multiple} disabled={disabled} data-testid={testId}
          className="sr-only" onChange={(e) => { take(e.target.files); e.target.value = ""; }}
        />
      </label>
      {error ? <p role="alert" className="text-[13px] leading-5 text-flag">{error}</p> : null}
      {files && files.length > 0 ? (
        <ul className="grid gap-1.5">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className="flex items-center gap-3 rounded-lg bg-white px-3 py-2 text-[14px] shadow-ring-xs">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-well text-faint" aria-hidden>
                <svg className="size-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"><path d="M9 1.8H4.5A1.5 1.5 0 0 0 3 3.3v9.4a1.5 1.5 0 0 0 1.5 1.5h7a1.5 1.5 0 0 0 1.5-1.5V5.8L9 1.8Z" /><path d="M9 1.8v4h4" /></svg>
              </span>
              <span className="min-w-0 flex-1 truncate font-medium text-ink-strong">{f.name}</span>
              <span className="shrink-0 text-[13px] text-muted tnum">{kb(f.size)}</span>
              {onRemove ? (
                <button type="button" aria-label={`Remove ${f.name}`} onClick={() => onRemove(i)}
                  className="flex size-7 shrink-0 items-center justify-center rounded-md text-ink-2 transition-colors hover:bg-stone-100 hover:text-ink active:scale-[.96]">
                  <svg className="size-3.5" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
