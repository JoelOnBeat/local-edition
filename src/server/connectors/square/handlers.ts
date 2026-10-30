import { squareRoutes } from "@/contract";
import { withRoute } from "../../http/api";
import { runInBackground } from "../../jobs/background";
import { rateLimit } from "../../limits";
import { readCookie, WORKSPACE_COOKIE } from "../../session";
import { ownedEdition, wsRoute } from "../../handlers/ws";
import { squareStatus, connectSandbox, disconnectSquare, finishOAuth, startOAuth } from "./connect";
import { squareDeps } from "./deps";
import { importFromSquare } from "./sync";
import { sellThrough } from "./sales";
import { authenticateWebhook, handleSquareWebhook } from "./webhook";

/** Route handlers for /api/connectors/square/**. Thin: the logic lives beside them and takes its dependencies as arguments. */

const limit = (ws: string, name: string) => rateLimit({ key: `square:${name}:${ws}`, capacity: 6, refillPerMinute: 6 });

export const getSquare = wsRoute(squareRoutes.getSquare, async (_in, ctx) => squareStatus(await squareDeps({ repo: ctx.repo }), ctx.workspace.id));

export const connectSquare = wsRoute(squareRoutes.connectSquare, async ({ body }, ctx) => {
  await limit(ctx.workspace.id, "connect");
  const deps = await squareDeps({ repo: ctx.repo });
  if (body.method === "oauth") return { kind: "redirect" as const, authorizeUrl: await startOAuth(deps, ctx.workspace.id) };
  const result = await connectSandbox(deps, ctx.workspace.id);
  return { kind: "connected" as const, status: await squareStatus(deps, ctx.workspace.id), result };
});

export const syncSquare = wsRoute(squareRoutes.syncSquare, async (_in, ctx) => {
  await limit(ctx.workspace.id, "sync");
  const deps = await squareDeps({ repo: ctx.repo });
  const result = await importFromSquare(deps, ctx.workspace.id, { reason: "sync" });
  return { status: await squareStatus(deps, ctx.workspace.id), result };
});

export const disconnectSquareRoute = wsRoute(squareRoutes.disconnectSquare, async (_in, ctx) => {
  await disconnectSquare(await squareDeps({ repo: ctx.repo }), ctx.workspace.id);
  return { ok: true as const };
});

/** Square sends the browser here. No workspace is created for a stranger: the cookie must already name the workspace the state was issued to. */
export const squareCallback = withRoute(squareRoutes.squareCallback, async ({ query }, ctx) =>
  finishOAuth(await squareDeps(), { code: query.code, state: query.state, error: query.error, cookieWorkspaceId: readCookie(ctx.request, WORKSPACE_COOKIE) }),
);

/** Public, signed: the signature is checked on the raw bytes before the body is parsed. */
export const squareWebhook = withRoute(
  squareRoutes.squareWebhook,
  async ({ body }) => handleSquareWebhook(await squareDeps(), body, runInBackground),
  { authenticate: async ({ request, bytes }) => authenticateWebhook(await squareDeps(), request, bytes) },
);

export const getSpecialSales = wsRoute(squareRoutes.getSpecialSales, async ({ query }, ctx) => {
  const edition = await ownedEdition(ctx, query.editionId);
  return { sales: await sellThrough(await squareDeps({ repo: ctx.repo }), ctx.workspace.id, edition) };
});

export const listDeliveries = wsRoute(squareRoutes.listDeliveries, async ({ query }, ctx) => {
  const edition = await ownedEdition(ctx, query.editionId);
  return { deliveries: await (await squareDeps({ repo: ctx.repo })).ledger.listDeliveries(ctx.workspace.id, edition.id) };
});
