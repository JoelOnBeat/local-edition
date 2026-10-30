import type { Edition, MenuItem, SquareSyncResult } from "@/contract";
import { newId } from "@/lib/ids";
import { HttpError } from "../../http/errors";
import { createLogger } from "../../log";
import { catalogToMenu, describeDiff, diffMenu, planLocations, type MenuDiff } from "./import";
import { PROVIDER, recordEvent, squareClientFor, type SquareDeps } from "./deps";

const log = createLogger("square-sync");

/** "14:07 ET": the head-office wording is "menu changed in Square at HH:MM". */
export function clockET(at: Date): string {
  return `${new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "America/New_York" }).format(at)} ET`;
}

/** Latest finished editions whose specials build on an item that changed or went away. */
async function flagAffectedEditions(deps: SquareDeps, workspaceId: string, chainId: string, diff: MenuDiff, at: Date): Promise<string[]> {
  const touched = new Set([...diff.removed.map((m) => m.id), ...diff.changed.map((c) => c.after.id)]);
  if (touched.size === 0) return [];
  const stores = await deps.repo.listStores(chainId);
  const editions = await deps.repo.listEditions({ storeIds: stores.map((s) => s.id), finishedOnly: true });
  const summary = `Menu changed in Square at ${clockET(at)}: ${describeDiff(diff)}`.slice(0, 240);
  const flagged: string[] = [];
  for (const edition of editions) {
    const hit = edition.items.some((i) => i.kind === "special" && i.status !== "rejected" && touched.has(i.baseMenuItemId));
    if (!hit) continue;
    await deps.repo.updateEdition(edition.id, (cur: Edition) => ({ ...cur, sourceChange: { provider: "square", at: at.toISOString(), summary } }));
    await recordEvent(deps, workspaceId, { direction: "in", kind: "edition.flagged", summary: `Marked ${edition.id} for review: ${summary}`, storeId: edition.storeId, editionId: edition.id });
    flagged.push(edition.id);
  }
  return flagged;
}

export interface ImportOptions {
  reason: "connect" | "sync" | "webhook";
  /** Square's own time for the catalog change (the webhook's catalog_version.updated_at). */
  catalogUpdatedAt?: string | null;
}

/**
 * Square is the system of record: re-reads locations and the catalog, replaces the workspace's menu, links locations to stores
 * (creating a store for a location with none), flags the editions the change touches, and logs it. One import per workspace at a time.
 */
export async function importFromSquare(deps: SquareDeps, workspaceId: string, opts: ImportOptions): Promise<SquareSyncResult> {
  const stored = await deps.ledger.getConnection(workspaceId, PROVIDER);
  if (!stored || stored.connection.status === "not_connected") throw new HttpError(409, "square_not_connected", "Connect Square first.");
  const workspace = await deps.repo.getWorkspace(workspaceId);
  const chain = workspace ? await deps.repo.getChain(workspace.chainId) : null;
  if (!workspace || !chain) throw new HttpError(404, "not_found", "Workspace not found.");

  const lock = await deps.repo.acquireLock(`square-sync:${workspaceId}`, 60);
  if (!lock) throw new HttpError(409, "sync_running", "A Square sync is already running. Try again in a moment.");
  const at = deps.now();
  try {
    const client = await squareClientFor(deps, workspaceId, stored);
    const [locations, catalog] = await Promise.all([client.listLocations(), client.fetchCatalog()]);

    const stores = await deps.repo.listStores(chain.id);
    const plan = planLocations(locations, stores, chain, () => newId("store"));
    if (plan.create.length > 0) await deps.repo.putStores(plan.create);
    await deps.ledger.replaceLocationLinks(workspaceId, plan.links.map((l) => ({ locationId: l.locationId, name: l.name, storeId: l.storeId })));

    const before = await deps.repo.listMenu(chain.id);
    const after = catalogToMenu(catalog, before);
    let menu: MenuItem[] = before;
    if (after.length > 0) {
      menu = await deps.repo.replaceMenu(chain.id, after);
    } else {
      await recordEvent(deps, workspaceId, { direction: "in", kind: "menu.empty", summary: "Square has no menu items yet, so we kept the current menu.", ok: false });
    }
    const diff = after.length > 0 ? diffMenu(before, after) : { added: [], removed: [], changed: [] };
    const affected = await flagAffectedEditions(deps, workspaceId, chain.id, diff, opts.catalogUpdatedAt ? new Date(opts.catalogUpdatedAt) : at);

    const changedAny = diff.added.length + diff.removed.length + diff.changed.length > 0;
    await recordEvent(deps, workspaceId, {
      direction: "in",
      kind: opts.reason === "connect" || !changedAny ? "menu.imported" : "menu.changed",
      summary:
        opts.reason !== "connect" && changedAny
          ? `Menu changed in Square: ${describeDiff(diff)}.`
          : `Imported ${menu.length} menu items and ${locations.length} locations from Square.`,
    });
    stored.connection = { ...stored.connection, status: "connected", error: null, lastSyncAt: at.toISOString() };
    if (opts.catalogUpdatedAt) stored.meta = { ...stored.meta, lastCatalogChangeAt: opts.catalogUpdatedAt };
    await deps.ledger.putConnection(workspaceId, PROVIDER, stored);

    return {
      at: at.toISOString(),
      menu: { added: diff.added.length, removed: diff.removed.length, changed: diff.changed.length, total: menu.length },
      stores: { linked: plan.links.length - plan.create.length, created: plan.create.length },
      affectedEditionIds: affected,
    };
  } catch (e) {
    log.warn("square import failed", { workspaceId, reason: opts.reason, err: (e as Error).name });
    await recordEvent(deps, workspaceId, { direction: "in", kind: "sync.failed", summary: "Could not read the menu from Square.", ok: false }).catch(() => undefined);
    throw e;
  } finally {
    await deps.repo.releaseLock(`square-sync:${workspaceId}`, lock);
  }
}
