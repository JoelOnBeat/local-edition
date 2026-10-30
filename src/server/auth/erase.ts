import { workspacePhotoKeys, getBlobStore } from "../blob";
import { getLedger } from "../connectors/ledger";
import { getDocDb } from "../connectors/comms/docs";
import { getRepo, type Repo } from "../store";
import { getAuthStore } from "./index";

/** Every kind of comms document (Slack install with its sealed token, mail connections, notes ...). */
const COMMS_DOC_KINDS = ["slack_install", "mail_conn", "target", "event", "delivery", "thread", "note", "store_signal", "suggestion", "digest"];

/**
 * Deletes a workspace and everything that hangs off it: connector connections and their sealed tokens, sync log, deliveries,
 * calendar tokens, Slack and mail state, the menu photo, then chain, stores, editions, cards and the onboarding record. Connectors
 * go first and the chain last, so a failure part-way leaves a workspace the owner can still sign in to and try again; every step
 * is safe to repeat. Tokens are only removed here, not revoked at the provider (Square, Slack, Composio): that needs their APIs.
 */
export async function eraseWorkspace(workspaceId: string, repo?: Repo): Promise<void> {
  const store = repo ?? (await getRepo());
  await (await getLedger()).deleteWorkspaceData(workspaceId);
  const docs = await getDocDb();
  for (const kind of COMMS_DOC_KINDS) await docs.delete(workspaceId, kind);
  await (await getBlobStore()).delete(workspacePhotoKeys(workspaceId));
  await store.deleteWorkspace(workspaceId);
  await (await getAuthStore()).deleteOnboarding(workspaceId);
}
