"use client";

import { useState } from "react";
import { ErrorLine, Field } from "@/components/account/plain";
import { toShownError, type ShownError } from "@/components/lib/use-async";
import { getApi } from "@/lib/api-client";
import type { StepProps } from "../step-props";

/** Brand voice: up to three short lines. Optional: skipping it builds with no voice guidance. */
export function VoiceStep({ bundle, refresh }: StepProps) {
  const { chain } = bundle;
  const [lines, setLines] = useState<string[]>(() => [...chain.brandVoice, "", "", ""].slice(0, 3));
  const [error, setError] = useState<ShownError | undefined>();
  const [saved, setSaved] = useState(false);

  const save = async () => {
    setError(undefined);
    try {
      await getApi().putChain({ name: chain.name, brandVoice: lines.map((l) => l.trim()).filter(Boolean), anchors: chain.anchors });
      setSaved(true);
      refresh();
    } catch (e) {
      setError(toShownError(e));
    }
  };
  return (
    <form data-testid="voice-form" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      {lines.map((line, i) => (
        <Field key={i} label={`Line ${i + 1} (140 characters at most)`}>
          <input data-testid={`voice-${i}`} maxLength={140} value={line} onChange={(e) => setLines(lines.map((l, j) => (j === i ? e.target.value : l)))} />
        </Field>
      ))}
      <ErrorLine error={error} testId="voice-error" />
      {saved ? <p data-testid="voice-saved">Saved.</p> : null}
      <button data-testid="voice-save" type="submit">Save brand voice</button>
    </form>
  );
}
