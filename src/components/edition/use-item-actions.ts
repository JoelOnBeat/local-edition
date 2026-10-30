"use client";

import { useCallback, useState } from "react";
import type { AgentEvent, Edition, EditionItem, ItemPatch } from "@/contract";
import { getApi } from "@/lib/api-client";
import { toShownError, type ShownError } from "../lib/use-async";
import { useWorkspace } from "../app/workspace-context";

/** What went wrong on one item, in head-office words, plus the one follow-up that fixes it. */
export interface ItemProblem {
  itemId: string | null;
  tone: "flag" | "warn";
  message: string;
  fix?: "reload" | "override";
}

function explain(itemId: string | null, e: ShownError): ItemProblem {
  switch (e.code) {
    case "version_conflict":
      return { itemId, tone: "flag", fix: "reload", message: "Someone changed this item after you opened it (409). Reload to see the latest copy, then decide again." };
    case "version_required":
      return { itemId, tone: "flag", fix: "reload", message: "The server needs this item's version to accept a change (428). Reload the edition and try again." };
    case "guardrail_unchecked":
      return { itemId, tone: "warn", fix: "override", message: "Guardrails have not checked this copy yet, so it cannot be approved automatically. Approve it only if you have read it yourself." };
    case "guardrail_blocked":
      return { itemId, tone: "flag", message: "Guardrails blocked this copy, so it cannot be approved. Edit it or regenerate it first." };
    case "spend_cap":
      return { itemId, tone: "flag", message: "This workspace has reached its model spend cap, so the agent cannot rewrite anything right now." };
    default:
      return { itemId, tone: "flag", message: e.message };
  }
}

export interface RegenState {
  itemId: string;
  steps: Extract<AgentEvent, { type: "step_metrics" }>[];
  phase: "writing" | "checking" | "done";
}

/** Approve, reject, edit, regenerate and approve-all for one edition, with plain conflict handling. */
export function useItemActions(edition: Edition | undefined) {
  const api = getApi();
  const { putItem, putEdition, reload } = useWorkspace();
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<ItemProblem | null>(null);
  const [regen, setRegen] = useState<RegenState | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const run = useCallback(
    async (key: string, itemId: string | null, fn: () => Promise<void>) => {
      setBusy(key);
      setProblem(null);
      setNotice(null);
      try {
        await fn();
      } catch (e) {
        setProblem(explain(itemId, toShownError(e)));
      } finally {
        setBusy(null);
      }
    },
    [],
  );

  const patch = (item: EditionItem, action: Parameters<typeof api.patchItem>[2]) =>
    run(`${action.action}:${item.id}`, item.id, async () => {
      if (!edition) return;
      putItem(edition.id, await api.patchItem(edition.id, item.id, action, item.version));
    });

  const approve = (item: EditionItem, override = false) => patch(item, override ? { action: "approve", override: true } : { action: "approve" });
  const reject = (item: EditionItem) => patch(item, { action: "reject" });
  const edit = (item: EditionItem, p: ItemPatch) => patch(item, { action: "edit", patch: p });

  const approveAll = () =>
    run("approve-all", null, async () => {
      if (!edition) return;
      const next = await api.approveAll(edition.id);
      putEdition(next);
      const held = next.items.filter((i) => i.status !== "approved" && i.status !== "edited" && i.status !== "rejected");
      setNotice(held.length
        ? `Approved ${next.items.length - held.length} of ${next.items.length}. ${held.length === 1 ? "One item needs" : `${held.length} items need`} your eye first: flagged or unchecked copy is never approved in bulk.`
        : "Every item is approved. The staff card is ready.");
    });

  const regenerate = (item: EditionItem, hint?: string) =>
    run(`regen:${item.id}`, item.id, async () => {
      if (!edition) return;
      setRegen({ itemId: item.id, steps: [], phase: "writing" });
      let drafted: EditionItem | null = null;
      for await (const e of api.regenerateItem(edition.id, item.id, hint ? { hint } : {})) {
        if (e.type === "step_metrics") setRegen((r) => r && { ...r, steps: [...r.steps, e] });
        if (e.type === "item_drafted") {
          drafted = e.item;
          setRegen((r) => r && { ...r, phase: "checking" });
        }
        if (e.type === "guardrail" && drafted) drafted = { ...drafted, guardrail: e.result };
        if (e.type === "error") throw Object.assign(new Error(e.message), { code: e.code });
      }
      if (drafted) putItem(edition.id, drafted);
      setRegen((r) => r && { ...r, phase: "done" });
    });

  const fix = (p: ItemProblem, item?: EditionItem) => {
    if (p.fix === "reload") {
      setProblem(null);
      reload();
    } else if (p.fix === "override" && item) void approve(item, true);
  };

  return { busy, problem, notice, regen, approve, reject, edit, regenerate, approveAll, fix, clearRegen: () => setRegen(null) };
}

export type ItemActions = ReturnType<typeof useItemActions>;
