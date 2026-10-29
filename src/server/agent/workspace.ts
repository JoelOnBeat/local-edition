import type { Chain, Edition, Store, Workspace } from "@/contract";
import { HttpError } from "../http/errors";
import type { Repo } from "../store/repo";

export interface EditionAccess {
  workspace: Workspace;
  chain: Chain;
  store: Store;
  edition: Edition;
}

/** Load an edition only if it belongs to the caller's workspace. Everything else is a plain 404. */
export async function loadEditionAccess(repo: Repo, workspaceId: string, editionId: string): Promise<EditionAccess> {
  const miss = () => new HttpError(404, "edition_not_found", "That edition does not exist.");
  const workspace = await repo.getWorkspace(workspaceId);
  if (!workspace) throw new HttpError(404, "workspace_not_found", "That workspace does not exist.");
  const edition = await repo.getEdition(editionId);
  if (!edition) throw miss();
  const store = await repo.getStore(edition.storeId);
  if (!store || store.chainId !== workspace.chainId) throw miss();
  const chain = await repo.getChain(workspace.chainId);
  if (!chain) throw miss();
  return { workspace, chain, store, edition };
}
