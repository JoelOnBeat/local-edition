import type { Delivery } from "@/contract/connectors";
import type { z } from "zod";
import type { DigestResponse as DigestResponseSchema } from "@/contract/connectors-comms";
import type { Edition, Store } from "@/contract";
import { createLogger } from "../../log";
import { sha256Hex } from "../comms/crypto";
import { takeSampleQuota, type CommsDeps } from "../comms/deps";
import { recordDelivery, recordEvent } from "../comms/events";
import type { DigestRow, Resolution } from "../comms/store";
import { postMessage, updateMessage, respondUrl } from "./api";
import { describeFailure, getBinding, touchSync } from "./binding";
import { DIGEST_CHUNK, digestMessage, type DigestEntry } from "./blocks";

type DigestResponse = z.infer<typeof DigestResponseSchema>;

const log = createLogger("slack:digest");

const needsHeadOffice = (e: Edition): boolean => e.status === "draft" || e.status === "flagged";

/** The newest finished, not-yet-approved edition per store of the workspace (or exactly the ones asked for). */
async function pickEditions(deps: CommsDeps, workspaceId: string, editionIds: string[] | undefined): Promise<{ stores: Store[]; editions: Edition[]; chainName: string; isSample: boolean } | null> {
  const workspace = await deps.repo.getWorkspace(workspaceId);
  const chain = workspace ? await deps.repo.getChain(workspace.chainId) : null;
  if (!workspace || !chain) return null;
  const stores = await deps.repo.listStores(chain.id);
  const all = await deps.repo.listEditions({ storeIds: stores.map((s) => s.id), finishedOnly: true });
  const editions = all.filter((e) => (editionIds ? editionIds.includes(e.id) : true)).filter(needsHeadOffice);
  return { stores, editions, chainName: chain.name, isSample: chain.isSample };
}

/**
 * Posts the head-office digest: one Block Kit message (several when a chain has more than 15 stores) with a section per store and
 * Approve / Regenerate / Open buttons. Idempotent per set of edition states: the same editions in the same state post once.
 */
export async function postDigest(deps: CommsDeps, workspaceId: string, editionIds?: string[]): Promise<DigestResponse> {
  const picked = await pickEditions(deps, workspaceId, editionIds);
  if (!picked) return { posted: 0, note: "This workspace has no chain yet.", deliveries: [] };
  if (!picked.editions.length) return { posted: 0, note: "No finished editions are waiting for head office.", deliveries: [] };

  const binding = await getBinding(deps, workspaceId, picked.isSample);
  if (!binding) return { posted: 0, note: "Slack is not connected.", deliveries: [] };

  const fingerprint = await sha256Hex(picked.editions.map((e) => `${e.id}:${e.status}:${e.items.map((i) => `${i.id}.${i.version}`).join(",")}`).sort().join("|"));
  if (!(await deps.store.claim(`digest:${workspaceId}:${fingerprint}`, deps.now().getTime()))) {
    return { posted: 0, note: "This digest was already posted.", deliveries: [] };
  }
  if (picked.isSample && !(await takeSampleQuota(deps, "slack"))) {
    await deps.store.release(`digest:${workspaceId}:${fingerprint}`);
    return { posted: 0, note: "The shared sample Slack has reached today's posting limit.", deliveries: [] };
  }

  const byStore = new Map(picked.stores.map((s) => [s.id, s]));
  const entries: DigestEntry[] = picked.editions
    .flatMap((edition) => { const store = byStore.get(edition.storeId); return store ? [{ workspaceId, store, edition, resolution: null } as DigestEntry] : []; })
    .sort((a, b) => a.store.name.localeCompare(b.store.name));
  const chunks: DigestEntry[][] = [];
  for (let i = 0; i < entries.length; i += DIGEST_CHUNK) chunks.push(entries.slice(i, i + DIGEST_CHUNK));

  const channel = binding.install.headOfficeChannel;
  const weekOf = entries[0].edition.weekOf;
  const deliveries: Delivery[] = [];
  let posted = 0;
  let note: string | null = null;
  for (const [index, chunk] of chunks.entries()) {
    const msg = digestMessage({ chainName: picked.chainName, weekOf, entries: chunk, appUrl: deps.env.appUrl, part: index + 1, parts: chunks.length });
    try {
      const sent = await postMessage(binding.token, { channel, ...msg }, deps.fetchImpl);
      const at = deps.now().toISOString();
      for (const entry of chunk) {
        const row: DigestRow = { workspaceId, editionId: entry.edition.id, channelId: sent.channel, ts: sent.ts, chainName: picked.chainName, weekOf, part: index + 1, parts: chunks.length, postedAt: at, resolution: null };
        await deps.store.putDigest(row);
        deliveries.push(await recordDelivery(deps.store, workspaceId, {
          provider: "slack", editionId: entry.edition.id, itemId: null, status: "sent", externalId: `${sent.channel}:${sent.ts}`, url: null, at, note: `Digest in #${channel}`,
        }, `digest:${entry.edition.id}`));
      }
      await recordEvent(deps.store, workspaceId, { provider: "slack", direction: "out", kind: "digest.posted", summary: `Digest for ${chunk.length} store${chunk.length === 1 ? "" : "s"} posted to #${channel}.`, storeId: null, editionId: null, ok: true });
      posted += chunk.length;
      await touchSync(deps, binding);
    } catch (e) {
      note = await describeFailure(deps, workspaceId, binding, e, channel);
      log.warn("digest post failed", { err: e });
      const at = deps.now().toISOString();
      for (const entry of chunk) {
        deliveries.push(await recordDelivery(deps.store, workspaceId, { provider: "slack", editionId: entry.edition.id, itemId: null, status: "failed", externalId: null, url: null, at, note }, `digest:${entry.edition.id}`));
      }
      await recordEvent(deps.store, workspaceId, { provider: "slack", direction: "out", kind: "digest.posted", summary: note, storeId: null, editionId: null, ok: false });
      await deps.store.release(`digest:${workspaceId}:${fingerprint}`);
    }
  }
  return { posted, note, deliveries };
}

/** Rebuilds a posted digest message from stored state and edits it in Slack. Falls back to the click's response_url. */
export async function refreshDigestMessage(deps: CommsDeps, workspaceId: string, row: DigestRow, token: string, responseUrl?: string): Promise<void> {
  const rows = (await deps.store.db.list(workspaceId, "digest", 200)).map((r) => JSON.parse(r.json) as DigestRow).filter((r) => r.ts === row.ts && r.channelId === row.channelId);
  const entries: DigestEntry[] = [];
  for (const r of rows) {
    const edition = await deps.repo.getEdition(r.editionId);
    const store = edition ? await deps.repo.getStore(edition.storeId) : null;
    if (edition && store) entries.push({ workspaceId, store, edition, resolution: r.resolution as Resolution | null });
  }
  entries.sort((a, b) => a.store.name.localeCompare(b.store.name));
  const msg = digestMessage({ chainName: row.chainName, weekOf: row.weekOf, entries, appUrl: deps.env.appUrl, part: row.part, parts: row.parts });
  try {
    if (row.channelId && row.ts) await updateMessage(token, { channel: row.channelId, ts: row.ts, ...msg }, deps.fetchImpl);
    else if (responseUrl) await respondUrl(responseUrl, { replace_original: true, ...msg }, deps.fetchImpl);
  } catch (e) {
    log.warn("chat.update failed, trying response_url", { err: e });
    if (responseUrl) await respondUrl(responseUrl, { replace_original: true, ...msg }, deps.fetchImpl);
  }
}
