import type { z } from "zod";
import type { Chain, Edition, RouteSpec, Store, Workspace } from "@/contract";
import { HttpError } from "../http/errors";
import { withRoute, type RouteContext } from "../http/api";
import { resolveWorkspace } from "../session";
import { getRepo, type Repo } from "../store";

export interface WsContext extends RouteContext {
  repo: Repo;
  workspace: Workspace;
}

type RouteArgs = { params: Promise<Record<string, string>> } | undefined;

/**
 * `withRoute` plus the visitor's workspace: validates input first (so bad requests never create a
 * workspace), resolves the cookie, runs the handler and attaches a Set-Cookie when one was minted.
 */
export function wsRoute<S extends RouteSpec, R>(
  spec: S,
  handler: (input: z.output<S["request"]>, ctx: WsContext) => Promise<R | Response> | R | Response,
): (request: Request, args?: RouteArgs) => Promise<Response> {
  return async (request, args) => {
    let cookie: string | undefined;
    const run = withRoute(spec, async (input, ctx) => {
      const repo = await getRepo();
      const resolved = await resolveWorkspace(request, repo);
      cookie = resolved.setCookie;
      const workspace = (await repo.getWorkspace(resolved.workspaceId))!;
      return handler(input, { ...ctx, repo, workspace });
    });
    const res = await run(request, args);
    if (cookie) res.headers.append("set-cookie", cookie);
    return res;
  };
}

export async function requireChain(ctx: WsContext): Promise<Chain> {
  const chain = await ctx.repo.getChain(ctx.workspace.chainId);
  if (!chain) throw new HttpError(500, "workspace_corrupt", "This workspace is missing its chain.");
  return chain;
}

/** A store of this workspace, or 404. Another workspace's store id is indistinguishable from a missing one. */
export async function ownedStore(ctx: WsContext, storeId: string): Promise<Store> {
  const store = await ctx.repo.getStore(storeId);
  if (!store || store.chainId !== ctx.workspace.chainId) throw new HttpError(404, "not_found", "Store not found.");
  return store;
}

export async function ownedEdition(ctx: WsContext, editionId: string): Promise<Edition> {
  const edition = await ctx.repo.getEdition(editionId);
  if (!edition) throw new HttpError(404, "not_found", "Edition not found.");
  await ownedStore(ctx, edition.storeId).catch(() => {
    throw new HttpError(404, "not_found", "Edition not found.");
  });
  return edition;
}
