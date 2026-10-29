import { routes, type Store, type StoreInput } from "@/contract";
import { newId } from "@/lib/ids";
import { HttpError } from "../http/errors";
import { remapId, workspaceSuffix } from "../store";
import { reapStaleDrafts } from "../store/reaper";
import { dedupeStores, parseStoreCsv } from "./csv";
import { ownedStore, requireChain, wsRoute, type WsContext } from "./ws";

export const MAX_STORES = 50;
export const MAX_MENU_ITEMS = 300;
const MAX_NAME = 80;
const MAX_ADDRESS = 120;

export const getWorkspace = wsRoute(routes.getWorkspace, async (_input, ctx) => {
  const chain = await requireChain(ctx);
  const stores = await ctx.repo.listStores(chain.id);
  return {
    workspace: ctx.workspace,
    chain,
    stores,
    menu: await ctx.repo.listMenu(chain.id),
    latestEditions: await reapStaleDrafts(ctx.repo, await ctx.repo.listEditions({ storeIds: stores.map((s) => s.id) })),
  };
});

export const putChain = wsRoute(routes.putChain, async ({ body }, ctx) => {
  const chain = await requireChain(ctx);
  // Renaming the sample chain makes it the visitor's own: the "sample" badge no longer applies.
  return ctx.repo.putChain({ ...chain, ...body, isSample: chain.isSample && body.name === chain.name });
});

/** Smallest unused colour 1..8, else cycle. */
function nextColor(existing: Store[], offset: number): number {
  const used = new Set(existing.map((s) => s.colorIndex));
  for (let c = 1; c <= 8; c++) if (!used.has(c)) return c;
  return ((existing.length + offset) % 8) + 1;
}

/**
 * `skipDuplicates` (CSV import): a row naming a store the chain already has, or an earlier row of the
 * same file, is left out, so uploading the same sheet twice changes nothing.
 */
async function addStores(ctx: WsContext, rows: StoreInput[], skipDuplicates = false): Promise<Store[]> {
  const chain = await requireChain(ctx);
  const existing = await ctx.repo.listStores(chain.id);
  const inputs = skipDuplicates ? dedupeStores(rows, existing) : rows;
  if (existing.length + inputs.length > MAX_STORES) {
    throw new HttpError(409, "store_limit", `A workspace holds up to ${MAX_STORES} stores (you have ${existing.length}).`);
  }
  const created: Store[] = [];
  for (const input of inputs) {
    // The workspace suffix marks the row as the visitor's, so it expires with the rest of the workspace.
    created.push({ id: remapId(newId("store"), workspaceSuffix(ctx.workspace.id)), chainId: chain.id, ...input, colorIndex: nextColor([...existing, ...created], created.length) });
  }
  return ctx.repo.putStores(created);
}

export const importStores = wsRoute(routes.importStores, async ({ body }, ctx) => addStores(ctx, parseStoreCsv(body), true));

export const createStore = wsRoute(routes.createStore, async ({ body }, ctx) => {
  const name = body.name.trim();
  const addressLabel = body.addressLabel.trim();
  if (!name || name.length > MAX_NAME) throw new HttpError(400, "invalid_input", `name must be 1-${MAX_NAME} characters.`);
  if (!addressLabel || addressLabel.length > MAX_ADDRESS) throw new HttpError(400, "invalid_input", `addressLabel must be 1-${MAX_ADDRESS} characters.`);
  const [store] = await addStores(ctx, [{ ...body, name, addressLabel }]);
  return store;
});

export const deleteStore = wsRoute(routes.deleteStore, async ({ params }, ctx) => {
  const store = await ownedStore(ctx, params.id);
  await ctx.repo.deleteStore(store.id);
  return { ok: true as const };
});

export const putMenu = wsRoute(routes.putMenu, async ({ body }, ctx) => {
  if (body.length > MAX_MENU_ITEMS) throw new HttpError(400, "invalid_input", `A menu holds up to ${MAX_MENU_ITEMS} items.`);
  if (new Set(body.map((m) => m.id)).size !== body.length) throw new HttpError(400, "invalid_input", "Menu item ids must be unique.");
  const chain = await requireChain(ctx);
  return ctx.repo.replaceMenu(chain.id, body);
});
