"use client";

import { useEffect, useRef } from "react";
import { getApi } from "@/lib/api-client";

/** How often a visible page asks the server to look for store replies, until the Composio webhook secret makes this unnecessary. */
export const MAIL_POLL_MS = 20_000;
export const MAIL_POLL_LABEL = "Checks for store replies every 20 seconds";

/**
 * Polls POST /api/connectors/mail/poll every 20 s while the tab is visible and a mailbox is connected, and stops when the tab is
 * hidden. `onReplies` runs when the server found new replies, so the page can reload what it shows.
 */
export function useMailPoll(enabled: boolean, onReplies: () => void): void {
  const cb = useRef(onReplies);
  useEffect(() => {
    cb.current = onReplies;
  });
  useEffect(() => {
    if (!enabled) return;
    let busy = false;
    const tick = async () => {
      if (busy || document.visibilityState !== "visible") return;
      busy = true;
      try {
        const r = await getApi().pollMail();
        if (r.newReplies > 0) cb.current();
      } catch {
        /* a failed check is retried on the next tick; the page keeps what it has */
      } finally {
        busy = false;
      }
    };
    const id = setInterval(() => void tick(), MAIL_POLL_MS);
    return () => clearInterval(id);
  }, [enabled]);
}
