import type { Edition, SpecialSales } from "@/contract";
import { createLogger } from "../../log";
import { PROVIDER, squareClientFor, type SquareDeps } from "./deps";

const log = createLogger("square-sales");

/**
 * Stretch: units sold of each published special since it was approved (Square Orders API, completed orders at the store's location).
 * `sold` is null when Square could not be read, never a guess.
 */
export async function sellThrough(deps: SquareDeps, workspaceId: string, edition: Edition): Promise<SpecialSales[]> {
  const stored = await deps.ledger.getConnection(workspaceId, PROVIDER);
  if (!stored || stored.connection.status !== "connected") return [];
  const links = await deps.ledger.listLocationLinks(workspaceId);
  const location = links.find((l) => l.storeId === edition.storeId);
  const readAt = deps.now().toISOString();
  const out: SpecialSales[] = [];
  let client: Awaited<ReturnType<typeof squareClientFor>> | null = null;
  const soldByVariation = new Map<string, Map<string, number>>();
  for (const item of edition.items) {
    if (item.kind !== "special") continue;
    const delivery = await deps.ledger.getDelivery(workspaceId, PROVIDER, edition.id, item.id);
    if (delivery?.status !== "sent" || !delivery.externalId || !location) continue;
    let sold: number | null = null;
    try {
      client ??= await squareClientFor(deps, workspaceId, stored);
      const object = await client.retrieveObject(delivery.externalId);
      const variationId = object?.item_data?.variations?.[0]?.id;
      if (variationId) {
        if (!soldByVariation.has(delivery.at)) soldByVariation.set(delivery.at, await client.soldSince(location.locationId, delivery.at));
        sold = soldByVariation.get(delivery.at)!.get(variationId) ?? 0;
      }
    } catch (e) {
      log.warn("could not read sales from Square", { err: (e as Error).name });
    }
    out.push({ itemId: item.id, name: item.name, sold, since: delivery.at, readAt });
  }
  return out;
}
