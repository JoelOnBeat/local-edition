import { z } from "zod";
import { HttpError } from "../../http/errors";
import { SLACK_ACTIONS } from "@/contract/connectors-comms";
import { loadEditionAccess } from "../../agent/workspace";
import { approveEditionItems } from "../../handlers/editions";
import { createLogger } from "../../log";
import type { CommsDeps } from "../comms/deps";
import { recordEvent } from "../comms/events";
import type { DigestRow, Resolution } from "../comms/store";
import { refreshDigestMessage } from "./digest";
import { startRegenerate } from "./regenerate";
import { describeFailure, getBinding, type SlackBinding } from "./binding";
import { parseButtonValue, specialOf } from "./blocks";

const log = createLogger("slack:interactions");

/** The part of Slack's block_actions payload we use. Everything else is ignored, never trusted. */
export const SlackInteraction = z.object({
  type: z.string(),
  user: z.object({ id: z.string().max(40), username: z.string().max(80).optional(), name: z.string().max(80).optional(), team_id: z.string().max(40).optional() }).loose(),
  team: z.object({ id: z.string().max(40) }).loose().nullish(),
  response_url: z.string().url().optional(),
  container: z.object({ message_ts: z.string().max(40).optional(), channel_id: z.string().max(40).optional() }).loose().optional(),
  message: z.object({ ts: z.string().max(40).optional() }).loose().optional(),
  channel: z.object({ id: z.string().max(40) }).loose().optional(),
  actions: z.array(z.object({ action_id: z.string().max(80), value: z.string().max(2000).optional() }).loose()).max(10),
}).loose();
export type SlackInteraction = z.infer<typeof SlackInteraction>;

/** Slack posts `payload=<json>` as a form body. Null when it is not a well-formed block_actions payload. */
export function parseInteraction(rawBody: string): SlackInteraction | null {
  const payload = new URLSearchParams(rawBody).get("payload");
  if (!payload) return null;
  try {
    const parsed = SlackInteraction.safeParse(JSON.parse(payload));
    return parsed.success && parsed.data.type === "block_actions" ? parsed.data : null;
  } catch {
    return null;
  }
}

async function resolve(deps: CommsDeps, row: DigestRow, resolution: Resolution): Promise<DigestRow> {
  const next = { ...row, resolution };
  await deps.store.putDigest(next);
  return next;
}

/**
 * Runs after the 200 has gone back to Slack (inside waitUntil). One action at a time:
 *  - the button value names the workspace and edition; the install's team id must match the click's team;
 *  - a claim key per (message, edition, action) makes a double click a no-op;
 *  - Approve calls the app's own approval path (`approveEditionItems`, which reads the server-side current item versions);
 *  - Regenerate runs the app's regenerate for the special and leaves the decision to head office.
 */
export async function handleInteraction(deps: CommsDeps, payload: SlackInteraction): Promise<void> {
  const action = payload.actions.find((a) => a.action_id === SLACK_ACTIONS.approve || a.action_id === SLACK_ACTIONS.regenerate);
  if (!action) return; // link buttons ("Open") also call back; nothing to do
  const target = parseButtonValue(action.value);
  if (!target) return;
  const ts = payload.container?.message_ts ?? payload.message?.ts ?? "";
  const team = payload.team?.id ?? payload.user.team_id ?? "";
  const nowUnix = Math.floor(deps.now().getTime() / 1000);

  const workspace = await deps.repo.getWorkspace(target.workspaceId);
  const chain = workspace ? await deps.repo.getChain(workspace.chainId) : null;
  if (!workspace || !chain) return;
  const binding = await getBinding(deps, target.workspaceId, chain.isSample);
  if (!binding || binding.install.teamId !== team) {
    log.warn("interaction from a team that is not this workspace's install", { workspaceId: target.workspaceId });
    return;
  }
  const digest = await deps.store.getDigest(target.workspaceId, target.editionId);
  if (!digest || (digest.ts && ts && digest.ts !== ts)) return; // an old or foreign message
  const who = payload.user.id;
  const kind = action.action_id === SLACK_ACTIONS.approve ? "approve" : "regenerate";

  const claimKey = `slack-${kind}:${target.editionId}:${digest.ts ?? "wh"}`;
  const access = await loadEditionAccess(deps.repo, target.workspaceId, target.editionId).catch(() => null);
  if (!access) return;
  const special = specialOf(access.edition);
  // Regenerate is claimed per special version, so a second click on the same take is ignored but a later take can be asked for again.
  const key = kind === "regenerate" ? `${claimKey}:${special?.version ?? 0}` : claimKey;
  if (!(await deps.store.claim(key, deps.now().getTime()))) return;

  try {
    let done = true;
    if (kind === "approve") {
      done = await approve(deps, binding, digest, who, nowUnix, payload.response_url);
    } else {
      if (!special) throw new HttpError(409, "no_special", "This edition has no special to regenerate.");
      // Marks the message "regenerating", then runs in the EditionBuild Workflow when bound, inline otherwise. Settles its own failures.
      await startRegenerate(deps, target.workspaceId, { editionId: target.editionId, itemId: special.id, userId: who, atUnix: nowUnix, responseUrl: payload.response_url, claimKey: key });
    }
    if (!done) await deps.store.release(key);
  } catch (e) {
    await deps.store.release(key);
    log.error("interaction failed", { kind, err: e });
    const reason = e instanceof HttpError ? e.message : "Something went wrong on our side. Open the edition in Local Edition.";
    const failed = await resolve(deps, digest, { kind: "failed", userId: who, atUnix: nowUnix, reason });
    await recordEvent(deps.store, target.workspaceId, { provider: "slack", direction: "in", kind: `${kind}.clicked`, summary: `${kind === "approve" ? "Approve" : "Regenerate"} could not be applied: ${reason}`, storeId: access.store.id, editionId: target.editionId, ok: false });
    await refreshDigestMessage(deps, target.workspaceId, failed, binding.token, payload.response_url).catch(() => undefined);
    await describeFailure(deps, target.workspaceId, binding, e, binding.install.headOfficeChannel).catch(() => undefined);
  }
}

async function approve(deps: CommsDeps, binding: SlackBinding, digest: DigestRow, who: string, nowUnix: number, responseUrl?: string): Promise<boolean> {
  const { workspaceId, editionId } = digest;
  const before = await deps.repo.getEdition(editionId);
  if (!before) return false;
  if (before.status === "approved") {
    const row = await resolve(deps, digest, { kind: "app", atUnix: nowUnix });
    await refreshDigestMessage(deps, workspaceId, row, binding.token, responseUrl);
    await deps.dispatch({ workspaceId, editionId });
    return true;
  }
  const after = await approveEditionItems(deps.repo, before);
  const items = after.items.filter((i) => i.status !== "rejected");
  const approvedCount = items.filter((i) => i.status === "approved").length;
  const resolution: Resolution = after.status === "approved"
    ? { kind: "approved", userId: who, atUnix: nowUnix }
    : { kind: "partial", userId: who, atUnix: nowUnix, approved: approvedCount, total: items.length };
  const row = await resolve(deps, digest, resolution);
  const store = await deps.repo.getStore(after.storeId);
  await recordEvent(deps.store, workspaceId, {
    provider: "slack", direction: "in", kind: "approval.clicked", storeId: after.storeId, editionId, ok: true,
    summary: after.status === "approved" ? `Approved in Slack: ${store?.name ?? "store"}.` : `Approved ${approvedCount} of ${items.length} items in Slack: ${store?.name ?? "store"}; the rest need review.`,
  });
  await refreshDigestMessage(deps, workspaceId, row, binding.token, responseUrl);
  // The same dispatcher the app uses: staff card to the store channel, email to the manager. Idempotent per card.
  if (after.status === "approved") await deps.dispatch({ workspaceId, editionId });
  return true;
}
