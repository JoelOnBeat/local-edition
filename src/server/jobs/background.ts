import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createLogger } from "../log";

const log = createLogger("jobs");

/**
 * Keeps work alive after the response is sent. On Workers that is `ctx.waitUntil`; under `next dev` or
 * `next start` there is no Cloudflare context and the promise simply keeps running in the Node process.
 */
export function runInBackground(work: Promise<unknown>): void {
  const safe = work.catch((e) => log.error("background work failed", { err: e }));
  try {
    getCloudflareContext().ctx.waitUntil(safe);
  } catch {
    // Not on Workers: fire and forget.
  }
}
