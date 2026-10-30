"use client";

import { DeliveriesResponse, type Delivery } from "@/contract";
import { clientDataMode } from "@/lib/env";
import { mockDeliveries } from "@/mocks";
import { useAsync } from "../lib/use-async";

/**
 * Where an edition's approved items went (GET /api/connectors/deliveries?editionId=). Not on the shared ApiClient yet,
 * so it is read here; any failure renders no strip rather than an error.
 */
async function load(editionId: string): Promise<Delivery[]> {
  if (clientDataMode() === "mock") return mockDeliveries(editionId);
  const res = await fetch(`/api/connectors/deliveries?editionId=${encodeURIComponent(editionId)}`, { credentials: "same-origin" });
  if (!res.ok) return [];
  const parsed = DeliveriesResponse.safeParse(await res.json());
  return parsed.success ? parsed.data.deliveries : [];
}

export function useDeliveries(editionId: string | undefined): Delivery[] {
  const r = useAsync(editionId ? `deliveries:${editionId}` : null, () => load(editionId!).catch(() => []));
  return r.data ?? [];
}
