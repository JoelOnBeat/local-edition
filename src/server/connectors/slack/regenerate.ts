import { newId } from "@/lib/ids";
import { HttpError } from "../../http/errors";
import { createLogger } from "../../log";
import { platformEnvSync } from "../../platform/env";
import { useWorkflow as workflowBound } from "../../workflows/mode";
import { BuildWorkflowParams, type SlackRegenerateJob } from "../../workflows/types";
import type { CommsDeps } from "../comms/deps";
import { recordEvent } from "../comms/events";
import type { DigestRow, Resolution } from "../comms/store";
import { describeFailure, getBinding } from "./binding";
import { refreshDigestMessage } from "./digest";

const log = createLogger("slack:regenerate");

async function resolve(deps: CommsDeps, row: DigestRow, resolution: Resolution): Promise<DigestRow> {
  const next = { ...row, resolution };
  await deps.store.putDigest(next);
  return next;
}

/**
 * Starts the work for a Slack Regenerate click. The digest message says "regenerating" first. With the EditionBuild Workflow bound
 * (production, or BUILD_MODE=workflow) the rewrite runs there, because a Worker's `waitUntil` allows about 30 s; otherwise (next dev,
 * tests, or the Workflow refusing to start) it runs inline.
 */
export async function startRegenerate(deps: CommsDeps, workspaceId: string, job: SlackRegenerateJob): Promise<void> {
  const digest = await deps.store.getDigest(workspaceId, job.editionId);
  const chain = await deps.repo.getWorkspace(workspaceId).then((w) => (w ? deps.repo.getChain(w.chainId) : null));
  const binding = chain ? await getBinding(deps, workspaceId, chain.isSample) : null;
  if (!digest || !binding) throw new HttpError(409, "not_connected", "Slack is not connected for this workspace.");
  await refreshDigestMessage(deps, workspaceId, await resolve(deps, digest, { kind: "regenerating", userId: job.userId, atUnix: job.atUnix }), binding.token, job.responseUrl);
  if (workflowBound()) {
    try {
      const runId = newId("run");
      await platformEnvSync()!.EDITION_BUILD!.create({ id: runId, params: BuildWorkflowParams.parse({ runId, workspaceId, trigger: "request", regenerate: job }) });
      return;
    } catch (e) {
      log.warn("could not start the regenerate Workflow; running it inline", { err: e });
    }
  }
  await runRegenerateJob(deps, workspaceId, job);
}

/**
 * The rewrite itself, and everything after it: record the click, update the digest message. It settles its own failures (the claim is
 * released so the click can be repeated, the message says what went wrong) and does not throw.
 */
export async function runRegenerateJob(deps: CommsDeps, workspaceId: string, job: SlackRegenerateJob): Promise<void> {
  const { editionId, itemId, userId, atUnix, responseUrl, claimKey } = job;
  const workspace = await deps.repo.getWorkspace(workspaceId);
  const chain = workspace ? await deps.repo.getChain(workspace.chainId) : null;
  const binding = chain ? await getBinding(deps, workspaceId, chain.isSample) : null;
  const digest = await deps.store.getDigest(workspaceId, editionId);
  if (!binding || !digest) {
    await deps.store.release(claimKey);
    return;
  }
  try {
    const { regenerateItem } = await import("../../agent/regenerate");
    let failure: string | null = null;
    for await (const ev of regenerateItem({ workspaceId, editionId, itemId }, await deps.agent())) {
      if (ev.type === "error") failure = ev.message;
    }
    if (failure) throw new HttpError(409, "regenerate_failed", failure);
    const row = await resolve(deps, digest, { kind: "regenerated", userId, atUnix });
    const edition = await deps.repo.getEdition(editionId);
    await recordEvent(deps.store, workspaceId, {
      provider: "slack", direction: "in", kind: "regenerate.clicked", storeId: edition?.storeId ?? null, editionId, ok: true,
      summary: "A new special was requested from Slack; head office reviews it before it goes out.",
    });
    await refreshDigestMessage(deps, workspaceId, row, binding.token, responseUrl);
  } catch (e) {
    await deps.store.release(claimKey);
    log.error("regenerate failed", { err: e });
    const reason = e instanceof HttpError ? e.message : "Something went wrong on our side. Open the edition in Local Edition.";
    const failed = await resolve(deps, digest, { kind: "failed", userId, atUnix, reason });
    const edition = await deps.repo.getEdition(editionId).catch(() => null);
    await recordEvent(deps.store, workspaceId, { provider: "slack", direction: "in", kind: "regenerate.clicked", summary: `Regenerate could not be applied: ${reason}`, storeId: edition?.storeId ?? null, editionId, ok: false });
    await refreshDigestMessage(deps, workspaceId, failed, binding.token, responseUrl).catch(() => undefined);
    await describeFailure(deps, workspaceId, binding, e, binding.install.headOfficeChannel).catch(() => undefined);
  }
}
