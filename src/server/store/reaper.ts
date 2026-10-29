import type { Edition } from "@/contract";
import type { Repo } from "./repo";

/**
 * A build runs inside `waitUntil` or an SSE request, and either can be killed mid-store; the `finally`
 * that flips `drafting` to `flagged` then never runs. This is the stopgap: a `drafting` edition older
 * than five minutes (one store takes well under that) is flagged when it is read and at the start of
 * every build. The full fix is the Cloudflare Workflow phase (docs/CLOUDFLARE.md).
 */
export const DRAFTING_MAX_AGE_MS = 5 * 60 * 1000;

export function isStaleDraft(edition: Pick<Edition, "status" | "createdAt">, now: Date): boolean {
  return edition.status === "drafting" && now.getTime() - Date.parse(edition.createdAt) > DRAFTING_MAX_AGE_MS;
}

/** Returns the editions with stale drafts flagged (and stored as flagged). Other editions pass through. */
export async function reapStaleDrafts(repo: Repo, editions: Edition[], now: Date = new Date()): Promise<Edition[]> {
  return Promise.all(
    editions.map(async (edition) => {
      if (!isStaleDraft(edition, now)) return edition;
      // Re-checked inside the lock: a build that finished in the meantime keeps its own status.
      return repo.updateEdition(edition.id, (cur) => (isStaleDraft(cur, now) ? { ...cur, status: "flagged" } : cur)).catch(() => edition);
    }),
  );
}
