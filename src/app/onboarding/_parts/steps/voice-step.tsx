"use client";

import { useState } from "react";
import { ErrorLine } from "@/components/account/plain";
import { Button, Input, cx } from "@/components/ui";
import { Icon } from "@/components/app-ui/icons";
import { toShownError, type ShownError } from "@/components/lib/use-async";
import { getApi } from "@/lib/api-client";
import type { StepProps } from "../step-props";

const MAX = 140;
const EXAMPLES = ["Warm and plain-spoken, like the person who knows your order.", "We talk about the block, not about ourselves.", "Short sentences, no hype."];

/** Brand voice: up to three short lines. Optional: skipping it builds with no voice guidance. */
export function VoiceStep({ bundle, refresh }: StepProps) {
  const { chain } = bundle;
  const [lines, setLines] = useState<string[]>(() => [...chain.brandVoice, "", "", ""].slice(0, 3));
  const [error, setError] = useState<ShownError | undefined>();
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setError(undefined);
    setBusy(true);
    try {
      await getApi().putChain({ name: chain.name, brandVoice: lines.map((l) => l.trim()).filter(Boolean), anchors: chain.anchors });
      setSaved(true);
      refresh();
    } catch (e) {
      setError(toShownError(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form data-testid="voice-form" className="grid gap-4" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <p className="text-[14px] leading-5 text-ink-2">Every line of every edition is written in this voice, and checked against it.</p>
      <div className="grid gap-3">
        {lines.map((line, i) => (
          <label key={i} className="grid gap-1.5">
            <span className="flex items-baseline justify-between text-[14px] font-medium leading-5 text-ink">
              Line {i + 1}
              <span className={cx("font-mono text-[12px] font-normal tnum", line.length > MAX - 10 ? "text-warn-ink" : "text-muted")}>{line.length}/{MAX}</span>
            </span>
            <Input data-testid={`voice-${i}`} maxLength={MAX} placeholder={EXAMPLES[i]} value={line} onChange={(e) => { setSaved(false); setLines(lines.map((l, j) => (j === i ? e.target.value : l))); }} />
          </label>
        ))}
      </div>
      <ErrorLine error={error} testId="voice-error" />
      <div className="flex flex-wrap items-center gap-3">
        <Button data-testid="voice-save" type="submit" variant="primary" size="sm" loading={busy} className="h-10 w-full px-6">Save brand voice</Button>
        {saved ? <span data-testid="voice-saved" className="inline-flex items-center gap-1.5 text-[13px] font-medium text-ok-ink"><Icon name="check" size={14} />Saved.</span> : null}
      </div>
    </form>
  );
}
