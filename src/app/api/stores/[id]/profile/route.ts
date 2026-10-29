import { routes } from "@/contract";
import { ownedStore, requireChain, wsRoute } from "@/server/handlers/ws";
import { profileForStore } from "@/server/qloo";

export const GET = wsRoute(routes.getStoreProfile, async ({ params }, ctx) => {
  const store = await ownedStore(ctx, params.id);
  return profileForStore(ctx.repo, store, await requireChain(ctx));
});
