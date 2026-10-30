"use client";

import { useCallback, useState } from "react";
import type { AgentEvent, Edition } from "@/contract";
import { consumeEvents, getApi } from "@/lib/api-client";
import { toShownError, type ShownError } from "../lib/use-async";

/** Build the first editions and approve them, for the onboarding "build" step. The stream is shown as plain log lines. */
export function useFirstBuild(onChange: () => void) {
  const [log, setLog] = useState<string[]>([]);
  const [phase, setPhase] = useState<"idle" | "building" | "built" | "approving" | "approved">("idle");
  const [editions, setEditions] = useState<Edition[]>([]);
  const [error, setError] = useState<ShownError | undefined>();

  const build = useCallback(async () => {
    setPhase("building");
    setError(undefined);
    setLog([]);
    try {
      await consumeEvents(getApi().buildEditions({}), (e: AgentEvent) => {
        if (e.type === "error") throw Object.assign(new Error(e.message), { code: e.code });
        setLog((l) => [...l.slice(-30), e.type === "store_done" ? `store_done ${e.storeId}` : e.type]);
      });
      setEditions(await getApi().listEditions());
      setPhase("built");
      onChange();
    } catch (e) {
      setError(toShownError(e));
      setPhase("idle");
    }
  }, [onChange]);

  /** Approves every item that can be approved; copy the guardrails could not check is approved with an explicit override. */
  const approveAll = useCallback(async () => {
    setPhase("approving");
    setError(undefined);
    try {
      const api = getApi();
      for (const edition of await api.listEditions()) {
        const current = await api.approveAll(edition.id);
        for (const item of current.items.filter((i) => i.status === "draft" && i.guardrail.status === "unchecked")) {
          await api.patchItem(current.id, item.id, { action: "approve", override: true }, item.version);
        }
      }
      setEditions(await api.listEditions());
      setPhase("approved");
      onChange();
    } catch (e) {
      setError(toShownError(e));
      setPhase("built");
    }
  }, [onChange]);

  return { build, approveAll, phase, log, editions, error };
}
