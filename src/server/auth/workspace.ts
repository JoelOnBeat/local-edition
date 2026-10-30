import type { Chain, Edition, StaffCard } from "@/contract";
import { newId, newToken } from "@/lib/ids";
import { SAMPLE_CITY } from "../sample/chain";
import { seedableEditions } from "../sample/live-editions";
import { ACCOUNT_ID_PREFIX, DEMO_WORKSPACE_ID, canonicalId, remapId, workspaceSuffix, WorkspaceExistsError, type Repo, type SeedWithId } from "../store";
import { eraseWorkspace } from "./erase";

/** The workspace an account owns: `acct_<random>`, never expiring, starting empty (or carrying a visitor's sample workspace over). */

export function newAccountWorkspaceId(): string {
  return newId(ACCOUNT_ID_PREFIX.slice(0, -1));
}

/** A new chain has no voice and no anchors yet, and the sample city until the owner confirms theirs in onboarding. */
export function emptyChain(id: string, name: string): Chain {
  return { id, name, category: "coffee", brandVoice: [], anchors: [], city: { ...SAMPLE_CITY }, isSample: false };
}

export async function createAccountWorkspace(repo: Repo, chainName: string): Promise<string> {
  const workspaceId = newAccountWorkspaceId();
  const chainId = remapId(newId("chain"), workspaceSuffix(workspaceId));
  const seed: SeedWithId = { chain: emptyChain(chainId, chainName), stores: [], menu: [], workspaceId };
  await repo.createWorkspace(seed);
  return workspaceId;
}

/** The account's workspace is gone (a failed delete, an expired dev store): rebuild an empty one under the same id so sign-in still works. */
export async function ensureAccountWorkspace(repo: Repo, user: { workspaceId: string; name: string }): Promise<void> {
  const chainId = remapId(newId("chain"), workspaceSuffix(user.workspaceId));
  const seed: SeedWithId = { chain: emptyChain(chainId, "My chain"), stores: [], menu: [], workspaceId: user.workspaceId };
  await repo.createWorkspace(seed).catch((e) => {
    if (!(e instanceof WorkspaceExistsError)) throw e;
  });
}

/** A visitor workspace that can be brought into an account: live, not the demo, not already an account's. */
export async function keepableWorkspace(repo: Repo, id: string | null): Promise<string | null> {
  if (!id || id === DEMO_WORKSPACE_ID || id.startsWith(ACCOUNT_ID_PREFIX)) return null;
  return (await repo.getWorkspace(id)) ? id : null;
}

/**
 * Moves a visitor's sample workspace into a new account: the chain (renamed to the one typed at sign-up; still marked sample while
 * its content is), stores, menu, the newest editions and their staff cards, all under fresh ids. The visitor's own workspace is then
 * erased, connections included: an OAuth link made on the sample does not follow the visitor into the account.
 */
export async function adoptVisitorWorkspace(repo: Repo, fromId: string, chainName: string): Promise<string> {
  const from = (await repo.getWorkspace(fromId))!;
  const chain = (await repo.getChain(from.chainId))!;
  const stores = await repo.listStores(chain.id);
  const menu = await repo.listMenu(chain.id);
  const editions = seedableEditions(await repo.listEditions({ storeIds: stores.map((s) => s.id), finishedOnly: true }));

  const workspaceId = newAccountWorkspaceId();
  const suffix = workspaceSuffix(workspaceId);
  const chainId = remapId(newId("chain"), suffix);
  const storeIds = new Map(stores.map((s) => [s.id, remapId(canonicalId(s.id), suffix)]));
  const seed: SeedWithId = {
    chain: { ...structuredClone(chain), id: chainId, name: chainName },
    stores: stores.map((s) => ({ ...s, id: storeIds.get(s.id)!, chainId })),
    menu: structuredClone(menu),
    workspaceId,
  };
  await repo.createWorkspace(seed);

  for (const edition of editions) {
    const copy: Edition = { ...structuredClone(edition), id: remapId(canonicalId(edition.id), suffix), storeId: storeIds.get(edition.storeId)! };
    if (copy.review) copy.review = { ...copy.review, clashWith: copy.review.clashWith.map((id) => storeIds.get(id) ?? remapId(canonicalId(id), suffix)) };
    await repo.putEdition(copy);
    const card = await repo.getStaffCardByEdition(edition.id);
    if (card) {
      const copied: StaffCard = { ...structuredClone(card), editionId: copy.id, storeId: copy.storeId, token: newToken() };
      await repo.putStaffCard(copied);
    }
  }
  await eraseWorkspace(fromId, repo);
  return workspaceId;
}
