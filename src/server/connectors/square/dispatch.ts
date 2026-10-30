import type { ApprovedEdition } from "../dispatch";
import { squareDeps } from "./deps";
import { publishApprovedSpecials, publishSpecial } from "./writeback";

/** Post-approval dispatcher (registered in ../dispatch.ts): publishes the edition's approved specials to Square. Idempotent per item version. */
export async function dispatchSquare({ workspaceId, editionId }: ApprovedEdition): Promise<void> {
  await publishApprovedSpecials(await squareDeps(), workspaceId, editionId);
}

/**
 * Optional per-item entry: publish one special the moment head office approves it, without waiting for the rest of the edition.
 * One line in the approve branch of patchItem: `if (item.kind === "special") runInBackground(dispatchSquareItem(ws, edition.id, item.id))`.
 * Idempotent with the edition-level dispatcher (same item version, same idempotency key).
 */
export async function dispatchSquareItem(workspaceId: string, editionId: string, itemId: string): Promise<void> {
  const deps = await squareDeps();
  const edition = await deps.repo.getEdition(editionId);
  const item = edition?.items.find((i) => i.id === itemId);
  if (!edition || !item || item.kind !== "special" || item.status !== "approved") return;
  await publishSpecial(deps, workspaceId, edition, item);
}
