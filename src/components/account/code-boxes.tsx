"use client";

import { useRef } from "react";
import { CODE_LENGTH } from "@/contract";

/**
 * Separate code boxes that accept a pasted code ("123456", "123 456" or "123-456" fill all six). Plain on purpose: the logic (digits only,
 * paste spreading, Backspace and arrow movement, submit when the last digit lands) is what the visual track keeps.
 */
export function CodeBoxes({ value, onChange, onComplete, disabled }: { value: string; onChange: (code: string) => void; onComplete?: (code: string) => void; disabled?: boolean }) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const focus = (i: number) => refs.current[Math.max(0, Math.min(CODE_LENGTH - 1, i))]?.focus();
  const digits = Array.from({ length: CODE_LENGTH }, (_, i) => value[i] ?? "");

  const put = (at: number, raw: string) => {
    const typed = raw.replace(/\D/g, "");
    if (!typed) return;
    const next = (value.slice(0, at) + typed).slice(0, CODE_LENGTH);
    onChange(next);
    focus(next.length);
    if (next.length === CODE_LENGTH) onComplete?.(next);
  };

  return (
    <div role="group" aria-label="Sign-in code" data-testid="code-boxes" data-length={CODE_LENGTH}>
      {digits.map((digit, i) => (
        <input
          key={i}
          ref={(el) => { refs.current[i] = el; }}
          data-testid={`code-box-${i}`}
          aria-label={`Digit ${i + 1}`}
          inputMode="numeric"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          maxLength={CODE_LENGTH}
          size={2}
          style={{ width: "2em", textAlign: "center", marginRight: 4 }}
          disabled={disabled}
          value={digit}
          onChange={(e) => put(i, e.target.value)}
          onPaste={(e) => {
            e.preventDefault();
            put(0, e.clipboardData.getData("text"));
          }}
          onKeyDown={(e) => {
            if (e.key === "Backspace") {
              e.preventDefault();
              const at = value[i] ? i : i - 1; // clear this box, or step back and clear the one before
              if (at < 0) return;
              onChange(value.slice(0, at) + value.slice(at + 1));
              focus(at);
            } else if (e.key === "ArrowLeft") focus(i - 1);
            else if (e.key === "ArrowRight") focus(i + 1);
          }}
          onFocus={(e) => e.target.select()}
        />
      ))}
    </div>
  );
}
