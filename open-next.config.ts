import { defineCloudflareConfig } from "@opennextjs/cloudflare";

/**
 * OpenNext's defaults: no incremental cache, no tag cache. Every page here is dynamic or static, and all
 * state lives in D1, KV and Durable Objects (src/server/store, src/server/platform), not in Next's cache.
 * The custom Worker entry that adds the Durable Objects, Workflows and cron is worker/index.ts.
 */
export default defineCloudflareConfig();
