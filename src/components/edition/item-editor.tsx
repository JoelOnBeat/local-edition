"use client";

import { useState } from "react";
import type { EditionItem, ItemPatch } from "@/contract";
import { Button, Input, Textarea } from "../ui";
import { Icon } from "../app-ui/icons";
import { DayTimeFields } from "./day-time-fields";

type Field = { key: keyof ItemPatch; label: string; long?: boolean };
const FIELDS: Record<EditionItem["kind"], Field[]> = {
  special: [{ key: "name", label: "Name" }, { key: "description", label: "Description", long: true }, { key: "staffLine", label: "Staff line", long: true }],
  sound: [{ key: "mood", label: "Mood" }, { key: "brief", label: "Brief", long: true }],
  partner: [{ key: "reason", label: "Why this neighbour", long: true }, { key: "offerIdea", label: "The offer", long: true }],
  event: [{ key: "title", label: "Title" }, { key: "description", label: "Description", long: true }],
};

/** Inline copy editor. Saving re-runs guardrails on the server, so the item may come back rewritten or blocked. */
export function ItemEditor({ item, busy, onSave, onCancel }: {
  item: EditionItem;
  busy: boolean;
  onSave: (p: ItemPatch) => void;
  onCancel: () => void;
}) {
  const initial = Object.fromEntries(FIELDS[item.kind].map((f) => [f.key, String((item as Record<string, unknown>)[f.key] ?? "")]));
  if (item.kind === "event") Object.assign(initial, { day: item.day, time: item.time });
  const [values, setValues] = useState<Record<string, string>>(initial);
  const changed = Object.fromEntries(Object.entries(values).filter(([k, v]) => v.trim() !== initial[k] && v.trim() !== "")) as ItemPatch;
  const empty = Object.values(values).some((v) => v.trim() === "");

  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (Object.keys(changed).length && !empty) onSave(changed);
      }}
    >
      {FIELDS[item.kind].map((f) => (
        <label key={f.key} className="grid gap-2">
          <span className="text-[14px] font-medium leading-5 text-ink">{f.label}</span>
          {f.long ? (
            <Textarea data-testid={`edit-field-${f.key}`} rows={3} maxLength={600} className="text-[16px] leading-[26px]" value={values[f.key]} aria-invalid={values[f.key].trim() === "" || undefined}
              onChange={(e) => setValues({ ...values, [f.key]: e.target.value })} />
          ) : (
            <Input data-testid={`edit-field-${f.key}`} maxLength={600} value={values[f.key]} aria-invalid={values[f.key].trim() === "" || undefined}
              onChange={(e) => setValues({ ...values, [f.key]: e.target.value })} />
          )}
        </label>
      ))}
      {item.kind === "event" ? (
        <DayTimeFields day={values.day} time={values.time} onDay={(d) => setValues({ ...values, day: d })} onTime={(t) => setValues({ ...values, time: t })} />
      ) : null}
      <p className="flex items-start gap-1.5 text-[13px] leading-5 text-muted">
        <Icon name="shield" size={14} className="mt-0.5 shrink-0 text-faint" />
        Saving re-checks the copy with guardrails. Health, diet and allergen claims are removed or blocked.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button data-testid={`edit-save-${item.kind}`} type="submit" variant="primary" size="sm" loading={busy} disabled={!Object.keys(changed).length || empty}>Save and re-check</Button>
        <Button data-testid={`edit-cancel-${item.kind}`} size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}
