import type { Edition, EditionItem } from "@/contract";
import { routes } from "@/contract";
import { HttpError } from "../http/errors";
import { getCheckCopy } from "../jobs/wiring-guardrails";
import { NotFoundError, VersionConflictError } from "../store";
import { applyPatch, autoApprovable, deriveEditionStatus, recheckItem } from "./items";
import { ownedEdition, requireChain, wsRoute, type WsContext } from "./ws";
import { withRoute } from "../http/api";
import { getRepo } from "../store";

export const listEditions = wsRoute(routes.listEditions, async ({ query }, ctx) => {
  const stores = await ctx.repo.listStores(ctx.workspace.chainId);
  return ctx.repo.listEditions({ storeIds: stores.map((s) => s.id), weekOf: query.weekOf });
});

export const getEdition = wsRoute(routes.getEdition, async ({ params }, ctx) => ownedEdition(ctx, params.id));

function conflict(e: unknown): never {
  if (e instanceof VersionConflictError) throw new HttpError(409, "version_conflict", "This item changed in another tab. Reload and try again.");
  if (e instanceof NotFoundError) throw new HttpError(404, "not_found", "Item not found.");
  throw e;
}

/** Keeps the edition's status in step with its items after any item write. */
async function syncStatus(ctx: WsContext, editionId: string): Promise<Edition> {
  const fresh = (await ctx.repo.getEdition(editionId))!;
  const status = deriveEditionStatus(fresh);
  return status === fresh.status ? fresh : ctx.repo.setEditionStatus(editionId, status);
}

function requireBuilt(edition: Edition): void {
  if (edition.status === "drafting") throw new HttpError(409, "edition_drafting", "This edition is still being built.");
}

/** Optional `If-Match: <version>` lets the UI make the check span its read; otherwise the check spans the request. */
function expectedVersion(request: Request, current: number): number {
  const raw = request.headers.get("if-match");
  const parsed = raw === null ? NaN : Number(raw.replace(/"/g, ""));
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : current;
}

export const patchItem = wsRoute(routes.patchItem, async ({ params, body }, ctx) => {
  const edition = await ownedEdition(ctx, params.id);
  requireBuilt(edition);
  const item = edition.items.find((i) => i.id === params.itemId);
  if (!item) throw new HttpError(404, "not_found", "Item not found.");
  const version = expectedVersion(ctx.request, item.version);

  let next: EditionItem;
  if (body.action === "approve") {
    if (item.status === "approved") return item;
    if (item.status === "flagged" || item.guardrail.status === "blocked") {
      throw new HttpError(409, "guardrail_blocked", "Guardrails blocked this copy. Edit it so it passes before approving.");
    }
    next = { ...item, status: "approved" };
  } else if (body.action === "reject") {
    next = { ...item, status: "rejected" };
  } else {
    const chain = await requireChain(ctx);
    const checkCopy = await getCheckCopy();
    next = await recheckItem(applyPatch(item, body.patch), checkCopy, chain.brandVoice);
  }
  const stored = await ctx.repo.updateEditionItem(edition.id, next, version).catch(conflict);
  await syncStatus(ctx, edition.id);
  return stored;
});

export const approveAll = wsRoute(routes.approveAll, async ({ params }, ctx) => {
  const edition = await ownedEdition(ctx, params.id);
  requireBuilt(edition);
  for (const item of edition.items.filter(autoApprovable)) {
    try {
      await ctx.repo.updateEditionItem(edition.id, { ...item, status: "approved" }, item.version);
    } catch (e) {
      if (!(e instanceof VersionConflictError)) throw e; // edited elsewhere meanwhile: leave it for review
    }
  }
  return syncStatus(ctx, edition.id);
});

/** Public, no cookie: the unguessable token is the capability. Blocked cards are never served. */
export const getPublicCard = withRoute(routes.getPublicCard, async ({ params }) => {
  const repo = await getRepo();
  const card = await repo.getStaffCardByToken(params.token);
  const edition = card ? await repo.getEdition(card.editionId) : null;
  const store = edition ? await repo.getStore(edition.storeId) : null;
  const chain = store ? await repo.getChain(store.chainId) : null;
  if (!card || !store || !chain || card.guardrail.status === "blocked") throw new HttpError(404, "not_found", "This staff card link is not valid.");
  return { card, store, chainName: chain.name };
});

