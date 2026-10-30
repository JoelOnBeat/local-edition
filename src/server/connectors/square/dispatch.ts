import type { ApprovedEdition } from "../dispatch";
import { squareDeps } from "./deps";
import { publishApprovedSpecials } from "./writeback";

/** Post-approval dispatcher (registered in ../dispatch.ts): publishes the edition's approved specials to Square. Idempotent per item version. */
export async function dispatchSquare({ workspaceId, editionId }: ApprovedEdition): Promise<void> {
  await publishApprovedSpecials(await squareDeps(), workspaceId, editionId);
}
