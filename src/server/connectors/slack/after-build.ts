import { createLogger } from "../../log";
import { liveCommsDeps, type CommsDeps } from "../comms/deps";
import { postDigest } from "./digest";

const log = createLogger("slack:after-build");

/**
 * A build just finished: post the head-office digest to Slack when it is connected. Idempotent (the digest claims a key per set of
 * edition states), and it never throws: a Slack problem is recorded in the sync log by the digest itself and must not touch the build.
 */
export async function postDigestAfterBuild(workspaceId: string, editionIds: string[], deps?: CommsDeps): Promise<void> {
  if (!editionIds.length) return;
  try {
    await postDigest(deps ?? (await liveCommsDeps()), workspaceId, editionIds);
  } catch (e) {
    log.warn("digest after build failed", { workspaceId, err: e });
  }
}
