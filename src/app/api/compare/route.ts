import { routes } from "@/contract";
import { ownedStore, requireChain, wsRoute } from "@/server/handlers/ws";
import { compareForStores } from "@/server/qloo";

export const GET = wsRoute(routes.compareStores, async ({ query }, ctx) => {
  const [a, b] = [await ownedStore(ctx, query.a), await ownedStore(ctx, query.b)];
  return compareForStores(ctx.repo, a, b, await requireChain(ctx));
});
