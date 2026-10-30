import type { Delivery, Edition, SpecialItem, Store } from "@/contract";
import { createLogger } from "../../log";
import { itemDashboardUrl, SPECIAL_SKU_PREFIX } from "./config";
import { PROVIDER, recordEvent, squareClientFor, type SquareDeps } from "./deps";
import type { CatalogObjectT } from "./schemas";

const log = createLogger("square-writeback");

/** Idempotency key: the same edition item at the same version can be sent any number of times and creates one Square item. */
export const idempotencyKey = (itemId: string, version: number): string => `le-${itemId}-v${version}`.slice(0, 128);

/** The delivery note starts with `v<version>` so a later pass can tell whether Square already has this version. */
const noteVersion = (note: string | null): number | null => {
  const m = /^v(\d+)\b/.exec(note ?? "");
  return m ? Number(m[1]) : null;
};

/** Builds the catalog object: one limited ITEM, one ITEM_VARIATION, present only at this store's location. Full replacement on update. */
export function buildSpecialObject(args: {
  special: SpecialItem; priceCents: number; locationId: string; store: Store; weekOf: string;
  existing: CatalogObjectT | null;
}): Record<string, unknown> {
  const { special, priceCents, locationId, store, weekOf, existing } = args;
  const itemId = existing?.id ?? `#le-item-${special.id}`;
  const variation = existing?.item_data?.variations?.[0];
  const where = { present_at_all_locations: false, present_at_location_ids: [locationId] };
  return {
    type: "ITEM",
    id: itemId,
    ...(existing?.version !== undefined ? { version: existing.version } : {}),
    ...where,
    item_data: {
      name: special.name.slice(0, 255),
      description: `${special.description} Local Edition special for ${store.name}, week of ${weekOf}.`.slice(0, 4096),
      product_type: "REGULAR",
      variations: [
        {
          type: "ITEM_VARIATION",
          id: variation?.id ?? `#le-var-${special.id}`,
          ...(variation?.version !== undefined ? { version: variation.version } : {}),
          ...where,
          item_variation_data: {
            item_id: itemId,
            name: "Regular",
            sku: `${SPECIAL_SKU_PREFIX}${special.id}`.slice(0, 128),
            pricing_type: "FIXED_PRICING",
            price_money: { amount: priceCents, currency: "USD" },
          },
        },
      ],
    },
  };
}

/**
 * Publishes one approved special to Square as a limited item at its store's location, and records a Delivery and a SyncEvent.
 * Never throws: a failure is a `failed` Delivery the edition page shows. Returns the delivery.
 */
export async function publishSpecial(deps: SquareDeps, workspaceId: string, edition: Edition, special: SpecialItem): Promise<Delivery | null> {
  const stored = await deps.ledger.getConnection(workspaceId, PROVIDER);
  if (!stored || stored.connection.status !== "connected") return null; // Square is not connected: nothing to deliver to
  const base = { provider: PROVIDER, editionId: edition.id, itemId: special.id } as const;
  const finish = async (d: Omit<Delivery, "provider" | "editionId" | "itemId" | "at">, event: { kind: string; summary: string; ok: boolean }) => {
    const delivery: Delivery = { ...base, at: deps.now().toISOString(), ...d };
    await deps.ledger.putDelivery(workspaceId, delivery);
    await recordEvent(deps, workspaceId, { direction: "out", ...event, storeId: edition.storeId, editionId: edition.id });
    return delivery;
  };

  const previous = await deps.ledger.getDelivery(workspaceId, PROVIDER, edition.id, special.id);
  if (previous?.status === "sent" && noteVersion(previous.note) === special.version) return previous;

  try {
    const store = await deps.repo.getStore(edition.storeId);
    const link = (await deps.ledger.listLocationLinks(workspaceId)).find((l) => l.storeId === edition.storeId);
    if (!store || !link) {
      return await finish({ status: "skipped", externalId: null, url: null, note: "This store is not linked to a Square location yet." }, { kind: "special.skipped", summary: `Did not publish "${special.name}": the store has no Square location.`, ok: false });
    }
    const chainId = store.chainId;
    const menuItem = (await deps.repo.listMenu(chainId)).find((m) => m.id === special.baseMenuItemId);
    if (menuItem?.price == null) {
      return await finish({ status: "skipped", externalId: null, url: null, note: "The menu item this special builds on has no price." }, { kind: "special.skipped", summary: `Did not publish "${special.name}": no price on the base menu item.`, ok: false });
    }

    const client = await squareClientFor(deps, workspaceId, stored);
    const existing = previous?.externalId ? await client.retrieveObject(previous.externalId) : null;
    const object = buildSpecialObject({ special, priceCents: Math.round(menuItem.price * 100), locationId: link.locationId, store, weekOf: edition.weekOf, existing });
    const { object: saved } = await client.upsertObject(idempotencyKey(special.id, special.version), object);
    const env = stored.connection.mode ?? "sandbox";
    return await finish(
      { status: "sent", externalId: saved.id, url: itemDashboardUrl(env, saved.id), note: `v${special.version}: limited item at ${store.name}, $${menuItem.price.toFixed(2)}.` },
      { kind: "special.published", summary: `Published "${special.name}" to Square at ${store.name} for $${menuItem.price.toFixed(2)}.`, ok: true },
    );
  } catch (e) {
    log.warn("publish to Square failed", { editionId: edition.id, itemId: special.id, err: (e as Error).name, code: (e as { code?: string }).code });
    return await finish(
      { status: "failed", externalId: previous?.externalId ?? null, url: previous?.url ?? null, note: "Square did not accept the special. Approve it again to retry." },
      { kind: "special.failed", summary: `Could not publish "${special.name}" to Square.`, ok: false },
    ).catch(() => null);
  }
}

/** Edition-level entry for the post-approval dispatcher: every approved special of the edition. */
export async function publishApprovedSpecials(deps: SquareDeps, workspaceId: string, editionId: string): Promise<Delivery[]> {
  const edition = await deps.repo.getEdition(editionId);
  if (!edition) return [];
  const out: Delivery[] = [];
  for (const item of edition.items) {
    if (item.kind !== "special" || item.status !== "approved") continue;
    const d = await publishSpecial(deps, workspaceId, edition, item);
    if (d) out.push(d);
  }
  return out;
}
