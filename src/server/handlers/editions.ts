import type { Edition, EditionItem } from "@/contract";
import { routes } from "@/contract";
import { invalidateCard } from "../agent/card-state";
import { HttpError } from "../http/errors";
import { getCheckCopy } from "../jobs/wiring-guardrails";
import { NotFoundError, VersionConflictError } from "../store";
import { reapStaleDrafts } from "../store/reaper";
import { limitSpend } from "./limit";
import { applyPatch, autoApprovable, deriveEditionStatus, recheckItem } from "./items";
import { patchItemSpec } from "./specs";
import { ownedEdition, requireChain, wsRoute, type WsContext } from "./ws";
import { withRoute } from "../http/api";
import { getRepo } from "../store";

export const listEditions = wsRoute(routes.listEditions, async ({ query }, ctx) => {
  const stores = await ctx.repo.listStores(ctx.workspace.chainId);
  return reapStaleDrafts(ctx.repo, await ctx.repo.listEditions({ storeIds: stores.map((s) => s.id), weekOf: query.weekOf }));
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

/**
 * `If-Match: <item.version>` is required: without it a stale tab could approve copy it never saw.
 * 428 when absent, 400 when it is not a version number; a stale one is a 409 further on.
 */
function requiredVersion(request: Request): number {
  const raw = request.headers.get("if-match");
  if (raw === null || raw.trim() === "") {
    throw new HttpError(428, "version_required", "Send the item's version in an If-Match header so we can tell whether it changed.");
  }
  const parsed = Number(raw.trim().replace(/^W\//, "").replace(/"/g, ""));
  if (!Number.isInteger(parsed) || parsed < 0) throw new HttpError(400, "invalid_version", "If-Match must be the item's version number.");
  return parsed;
}

export const patchItem = wsRoute(patchItemSpec, async ({ params, body }, ctx) => {
  const edition = await ownedEdition(ctx, params.id); // a stranger gets 404 before anything about versions
  const expected = requiredVersion(ctx.request);
  requireBuilt(edition);
  const item = edition.items.find((i) => i.id === params.itemId);
  if (!item) throw new HttpError(404, "not_found", "Item not found.");
  if (item.version !== expected) conflict(new VersionConflictError(item.id, expected, item.version));

  let next: EditionItem;
  if (body.action === "approve") {
    if (item.status === "approved") return item;
    if (item.status === "flagged" || item.guardrail.status === "blocked") {
      throw new HttpError(409, "guardrail_blocked", "Guardrails blocked this copy. Edit it so it passes before approving.");
    }
    if (item.guardrail.status === "unchecked" && body.override !== true) {
      throw new HttpError(409, "guardrail_unchecked", "Guardrails could not check this copy. Approve it only if you have read it yourself.");
    }
    next = { ...item, status: "approved" };
  } else if (body.action === "reject") {
    next = { ...item, status: "rejected" };
  } else {
    await limitSpend(ctx, "edit");
    const chain = await requireChain(ctx);
    const checkCopy = await getCheckCopy();
    next = await recheckItem(applyPatch(item, body.patch), checkCopy, chain.brandVoice);
  }
  const stored = await ctx.repo.updateEditionItem(edition.id, next, expected).catch(conflict);
  // The staff card was written from the old copy: blank it so the public link stops serving it.
  if (body.action !== "approve") await invalidateCard(ctx.repo, edition.id);
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

/**
 * Public, no cookie: the unguessable token is the capability. The card goes out only once head office has
 * approved the edition and the card itself passed guardrails (or was rewritten to pass); a draft, a card
 * guardrails could not check, a blocked card and a blanked card (the edition changed) are all a plain 404.
 */
export const getPublicCard = withRoute(routes.getPublicCard, async ({ params }) => {
  const repo = await getRepo();
  const card = await repo.getStaffCardByToken(params.token);
  const edition = card ? await repo.getEdition(card.editionId) : null;
  const store = edition ? await repo.getStore(edition.storeId) : null;
  const chain = store ? await repo.getChain(store.chainId) : null;
  const status = card?.guardrail.status;
  const servable = edition?.status === "approved" && card && card.lines.length > 0 && (status === "passed" || status === "rewritten");
  if (!servable || !store || !chain) throw new HttpError(404, "not_found", "This staff card link is not valid.");
  return { card, store, chainName: chain.name };
});

