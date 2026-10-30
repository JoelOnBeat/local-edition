"use client";

import { useState } from "react";
import type { EditionItem, ItemPatch, Weekday } from "@/contract";
import { Button } from "../ui";

type Field = { key: keyof ItemPatch; label: string; long?: boolean };
const FIELDS: Record<EditionItem["kind"], Field[]> = {
  special: [{ key: "name", label: "Name" }, { key: "description", label: "Description", long: true }, { key: "staffLine", label: "Staff line", long: true }],
  sound: [{ key: "mood", label: "Mood" }, { key: "brief", label: "Brief", long: true }],
  partner: [{ key: "reason", label: "Why this neighbour", long: true }, { key: "offerIdea", label: "The offer", long: true }],
  event: [{ key: "title", label: "Title" }, { key: "description", label: "Description", long: true }],
};
const DAYS: Weekday[] = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const input =
  "w-full rounded-[var(--radius)] border border-rule bg-paper px-3 py-2 text-[14px] text-ink placeholder:text-muted focus:border-ink focus:outline-none";

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
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (Object.keys(changed).length && !empty) onSave(changed);
      }}
    >
      {FIELDS[item.kind].map((f) => (
        <label key={f.key} className="block">
          <span className="mb-1 block text-[12px] font-medium text-ink-2">{f.label}</span>
          {f.long ? (
            <textarea data-testid={`edit-field-${f.key}`} rows={3} maxLength={600} className={input} value={values[f.key]} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })} />
          ) : (
            <input data-testid={`edit-field-${f.key}`} maxLength={600} className={input} value={values[f.key]} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })} />
          )}
        </label>
      ))}
      {item.kind === "event" ? (
        <div className="flex gap-3">
          <label className="block">
            <span className="mb-1 block text-[12px] font-medium text-ink-2">Day</span>
            <select className={input} value={values.day} onChange={(e) => setValues({ ...values, day: e.target.value })}>
              {DAYS.map((d) => <option key={d}>{d}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-[12px] font-medium text-ink-2">Time</span>
            <input type="time" className={input} value={values.time} onChange={(e) => setValues({ ...values, time: e.target.value })} />
          </label>
        </div>
      ) : null}
      <p className="text-[12px] text-muted">Saving re-checks the copy with guardrails. Health, diet and allergen claims are removed or blocked.</p>
      <div className="flex flex-wrap gap-2">
        <Button data-testid={`edit-save-${item.kind}`} type="submit" variant="primary" size="sm" loading={busy} disabled={!Object.keys(changed).length || empty}>Save and re-check</Button>
        <Button data-testid={`edit-cancel-${item.kind}`} size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}
