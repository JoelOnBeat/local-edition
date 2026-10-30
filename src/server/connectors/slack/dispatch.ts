import { createLogger } from "../../log";
import { loadApprovedCard } from "../comms/approved";
import { liveCommsDeps, takeSampleQuota, type CommsDeps } from "../comms/deps";
import { CARD_ITEM, recordDelivery, recordEvent, resolveTarget } from "../comms/events";
import type { ApprovedEdition } from "../dispatch";
import { postMessage } from "./api";
import { describeFailure, getBinding, touchSync } from "./binding";
import { cardMessage } from "./blocks";
import { refreshDigestMessage } from "./digest";

const log = createLogger("slack:dispatch");

/**
 * Post-approval, Slack side: (1) the staff card goes to the store's channel, (2) the head-office digest, if one was posted for this
 * edition, is updated to say it was approved (so a decision made in the app is visible in Slack too).
 */
export async function dispatchSlackWith(deps: CommsDeps, { workspaceId, editionId }: ApprovedEdition): Promise<void> {
  const workspace = await deps.repo.getWorkspace(workspaceId);
  const chain = workspace ? await deps.repo.getChain(workspace.chainId) : null;
  if (!chain) return;
  const binding = await getBinding(deps, workspaceId, chain.isSample);
  if (!binding) return;

  const digest = await deps.store.getDigest(workspaceId, editionId);
  if (digest && digest.resolution?.kind !== "approved" && digest.resolution?.kind !== "app") {
    const next = { ...digest, resolution: { kind: "app" as const, atUnix: Math.floor(deps.now().getTime() / 1000) } };
    await deps.store.putDigest(next);
    await refreshDigestMessage(deps, workspaceId, next, binding.token).catch((e) => log.warn("digest refresh failed", { err: e }));
  }

  const approved = await loadApprovedCard(deps, workspaceId, editionId);
  if (!approved.ok) {
    await recordDelivery(deps.store, workspaceId, { provider: "slack", editionId, itemId: CARD_ITEM, status: "skipped", externalId: null, url: null, at: deps.now().toISOString(), note: approved.reason }, `card:${editionId}`);
    return;
  }
  const { edition, store, card, fingerprint } = approved.value;
  const target = resolveTarget(store, chain, await deps.store.listTargets(workspaceId), deps.env);
  const channel = target.slackChannel ?? "";
  const key = `card-slack:${editionId}:${fingerprint}`;
  if (!channel || !(await deps.store.claim(key, deps.now().getTime()))) return;
  if (chain.isSample && !(await takeSampleQuota(deps, "slack"))) {
    await deps.store.release(key);
    return;
  }

  const at = deps.now().toISOString();
  try {
    const msg = cardMessage({ store, card, weekOf: edition.weekOf, issueNo: edition.issueNo, appUrl: deps.env.appUrl });
    const sent = await postMessage(binding.token, { channel, ...msg }, deps.fetchImpl);
    await recordDelivery(deps.store, workspaceId, { provider: "slack", editionId, itemId: CARD_ITEM, status: "sent", externalId: `${sent.channel}:${sent.ts}`, url: `${deps.env.appUrl}/card/${card.token}`, at, note: `Staff card in #${channel}` }, `card:${editionId}`);
    await recordEvent(deps.store, workspaceId, { provider: "slack", direction: "out", kind: "card.posted", summary: `Staff card posted to #${channel}.`, storeId: store.id, editionId, ok: true });
    await touchSync(deps, binding);
  } catch (e) {
    await deps.store.release(key);
    const note = await describeFailure(deps, workspaceId, binding, e, channel);
    await recordDelivery(deps.store, workspaceId, { provider: "slack", editionId, itemId: CARD_ITEM, status: "failed", externalId: null, url: null, at, note }, `card:${editionId}`);
    await recordEvent(deps.store, workspaceId, { provider: "slack", direction: "out", kind: "card.posted", summary: note, storeId: store.id, editionId, ok: false });
  }
}

export async function dispatchSlack(approved: ApprovedEdition): Promise<void> {
  await dispatchSlackWith(await liveCommsDeps(), approved);
}
