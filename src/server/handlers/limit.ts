import { clientIp, rateLimit } from "../limits";
import type { WsContext } from "./ws";

/** Bucket sizes for the routes that spend model credits: a burst, then a steady refill per minute. */
const LIMITS = {
  build: { workspace: { capacity: 4, refillPerMinute: 1 }, ip: { capacity: 12, refillPerMinute: 3 } },
  regenerate: { workspace: { capacity: 10, refillPerMinute: 4 }, ip: { capacity: 30, refillPerMinute: 10 } },
  card: { workspace: { capacity: 10, refillPerMinute: 5 }, ip: { capacity: 30, refillPerMinute: 10 } },
  edit: { workspace: { capacity: 30, refillPerMinute: 20 }, ip: { capacity: 90, refillPerMinute: 40 } },
} as const;

export type SpendAction = keyof typeof LIMITS;

/** A short hash, so a raw IP address is never part of a stored key. */
async function ipHash(ip: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ip));
  return [...new Uint8Array(digest)].slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Throws 429 `rate_limited` when this workspace, or this network address, has used up its allowance. */
export async function limitSpend(ctx: Pick<WsContext, "workspace" | "request">, action: SpendAction): Promise<void> {
  const cfg = LIMITS[action];
  await rateLimit({ key: `${action}:ws:${ctx.workspace.id}`, ...cfg.workspace });
  await rateLimit({ key: `${action}:ip:${await ipHash(clientIp(ctx.request))}`, ...cfg.ip });
}
