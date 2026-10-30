import type { Delivery, SyncEvent } from "@/contract/connectors";
import type { StoreCommsTarget } from "@/contract/connectors-comms";
import type { Chain, Store } from "@/contract";
import { newId } from "@/lib/ids";
import { getLedger } from "../ledger";
import type { CommsEnv } from "./env";
import type { CommsStore } from "./store";

type EventInput = Omit<SyncEvent, "id" | "at"> & { at?: string };

export async function recordEvent(store: CommsStore, workspaceId: string, input: EventInput): Promise<SyncEvent> {
  const event: SyncEvent = { id: newId("se"), at: input.at ?? new Date().toISOString(), ...input };
  await store.addEvent(workspaceId, event);
  return event;
}

/**
 * Saves a delivery with this lane's state and mirrors it into the shared connector ledger (lane B2), so one
 * GET /api/connectors/deliveries?editionId= lists Square, Slack and mail together. The mirror is best effort.
 */
export async function recordDelivery(store: CommsStore, workspaceId: string, delivery: Delivery, key: string): Promise<Delivery> {
  await store.putDelivery(workspaceId, delivery, key);
  try {
    await (await getLedger()).putDelivery(workspaceId, delivery);
  } catch {
    // The shared ledger is a convenience view; this lane's own record is the source of truth for /api/connectors/comms.
  }
  return delivery;
}

/** `itemId` of a delivery that carries the staff card rather than one edition item. */
export const CARD_ITEM = "staff-card";

export const slugify = (s: string): string => s.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/**
 * Where a store's card goes. A saved target wins. Otherwise the Slack channel defaults to `store-<neighbourhood>`; the manager's
 * mailbox defaults to nothing, except in the sample chain, where every store routes to the one test inbox the operator configured
 * (COMMS_SAMPLE_MANAGER_EMAIL): the app never mails an address nobody gave it.
 */
export function resolveTarget(store: Store, chain: Chain, saved: StoreCommsTarget[], env: CommsEnv): StoreCommsTarget {
  const own = saved.find((t) => t.storeId === store.id);
  const channel = own?.slackChannel ?? `store-${slugify(store.name)}`.slice(0, 80);
  const email = own?.managerEmail ?? (chain.isSample ? env.sampleManagerEmail ?? null : null);
  return { storeId: store.id, slackChannel: channel, managerName: own?.managerName ?? (chain.isSample ? `${store.name} manager` : null), managerEmail: email };
}
