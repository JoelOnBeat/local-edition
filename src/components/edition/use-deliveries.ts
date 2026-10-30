"use client";

import { useEffect } from "react";
import type { Delivery } from "@/contract";
import { getApi } from "@/lib/api-client";
import { useAsync } from "../lib/use-async";

/**
 * Where an edition's approved items went (api.listDeliveries). `stamp` changes whenever an item's status does: that re-reads the
 * list at once and again a few seconds later, because Square, Slack and mail deliver in the background after an approval.
 * Any failure renders no strip rather than an error.
 */
export function useDeliveries(editionId: string | undefined, stamp = ""): Delivery[] {
  const r = useAsync(editionId ? `deliveries:${editionId}:${stamp}` : null, () => getApi().listDeliveries(editionId!).catch(() => [] as Delivery[]));
  const { reload } = r;
  useEffect(() => {
    if (!editionId || !stamp.includes("approved")) return;
    const timers = [3_000, 9_000].map((ms) => setTimeout(reload, ms));
    return () => timers.forEach(clearTimeout);
  }, [editionId, stamp, reload]);
  return r.data ?? [];
}
