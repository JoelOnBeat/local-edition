import { clientIp, ipHash, rateLimit } from "../limits";
import { SPEND_LIMITS } from "../limits-table";
import { DEMO_WORKSPACE_ID } from "../session";
import { ADMISSION_USD, chargeSpendBudget } from "../spend-budget";
import type { WsContext } from "./ws";

const LIMITS = SPEND_LIMITS;

export type SpendAction = keyof typeof LIMITS;

/**
 * Throws 429 `rate_limited` when this workspace, or this network address, has used up its request allowance, then
 * charges the action's dollars to the workspace sub-budget ($0.40), the network's daily cap ($0.80) and the visitors'
 * share of the shared spend cap (see `spend-budget.ts`; 429 `workspace_budget` / `ip_budget`, 402 `spend_cap`).
 */
export async function limitSpend(ctx: Pick<WsContext, "workspace" | "request">, action: SpendAction): Promise<void> {
  const cfg = LIMITS[action];
  const ip = await ipHash(clientIp(ctx.request));
  await rateLimit({ key: `${action}:ws:${ctx.workspace.id}`, ...cfg.workspace });
  await rateLimit({ key: `${action}:ip:${ip}`, ...cfg.ip });
  // The demo workspace is never reached from a cookie; the guard keeps the weekly build out of a visitor's budget if it ever is.
  if (ctx.workspace.id !== DEMO_WORKSPACE_ID) await chargeSpendBudget({ workspaceId: ctx.workspace.id, ipKey: ip, usd: ADMISSION_USD[action] });
}
