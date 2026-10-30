"use client";

import { useCallback } from "react";
import type { RegenerateSuggestion, StoreNote } from "@/contract";
import { getApi } from "@/lib/api-client";
import { useAsync } from "../lib/use-async";
import { useMailPoll } from "../lib/use-mail-poll";

export interface StoreReplies {
  notes: StoreNote[];
  suggestions: RegenerateSuggestion[];
  /** A mailbox (Gmail or Outlook) is connected, so replies can arrive and the page polls for them. */
  polling: boolean;
  /** Marks a suggestion applied or dismissed on the server, then reloads. */
  settle: (id: string, status: "applied" | "dismissed") => Promise<void>;
}

/** "From the store" notes and open regenerate suggestions for one edition (GET /api/connectors/comms), refreshed by the 20 s mail poll. */
export function useStoreReplies(editionId: string | undefined): StoreReplies {
  const q = useAsync(editionId ? `comms:${editionId}` : null, () => getApi().getComms());
  const { reload, data } = q;
  const polling = Boolean(data?.connections.some((c) => (c.provider === "gmail" || c.provider === "outlook") && c.status === "connected"));
  useMailPoll(polling, reload);
  const settle = useCallback(
    async (id: string, status: "applied" | "dismissed") => {
      await getApi().patchSuggestion(id, status);
      reload();
    },
    [reload],
  );
  return {
    notes: (data?.notes ?? []).filter((n) => n.editionId === editionId).sort((a, b) => Date.parse(b.at) - Date.parse(a.at)),
    suggestions: (data?.suggestions ?? []).filter((s) => s.editionId === editionId && s.status === "open"),
    polling,
    settle,
  };
}
