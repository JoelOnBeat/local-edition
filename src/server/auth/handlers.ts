import type { z } from "zod";
import { authRoutes, type RouteSpec } from "@/contract";
import { errorResponse, withRoute, type RouteContext } from "../http/api";
import { wsRoute } from "../handlers/ws";
import { buildConnections } from "../connectors/connections";
import { liveCommsDeps } from "../connectors/comms/deps";
import { squareDeps } from "../connectors/square/deps";
import { getAuthStore } from "./index";
import { assertSameOrigin } from "./origin";
import { getOnboarding, updateOnboarding, type OnboardingDeps } from "./onboarding";
import * as codes from "./code-service";
import * as service from "./service";
import { networkOf, takeWindow, WINDOWS } from "./throttle";

type Handler = (request: Request, args?: { params: Promise<Record<string, string>> }) => Promise<Response>;

/**
 * An auth route: same-origin check and the per-network window BEFORE the body is read, then zod on the body (withRoute), then the
 * use-case, whose `Set-Cookie` lines are attached to the JSON answer. Errors come out as `{ error, code }`.
 */
function authRoute<S extends RouteSpec, R>(
  spec: S,
  opts: { window?: keyof typeof WINDOWS; sameOrigin: boolean },
  run: (input: z.output<S["request"]>, ctx: RouteContext) => Promise<{ body: R; cookies: string[] }> | { body: R; cookies: string[] },
): Handler {
  const inner = withRoute(spec, async (input, ctx) => {
    const { body, cookies } = await run(input, ctx);
    const res = Response.json(body, { headers: { "cache-control": "no-store" } });
    for (const c of cookies) res.headers.append("set-cookie", c);
    return res;
  });
  return async (request, args) => {
    try {
      if (opts.sameOrigin) assertSameOrigin(request);
      if (opts.window) await takeWindow(await getAuthStore(), opts.window, networkOf(request));
    } catch (e) {
      return errorResponse(e);
    }
    return inner(request, args);
  };
}

export const signupRoute = authRoute(authRoutes.signup, { window: "signupIp", sameOrigin: true }, ({ body }, ctx) => service.signup(ctx.request, body));
export const signinRoute = authRoute(authRoutes.signin, { window: "signinIp", sameOrigin: true }, ({ body }, ctx) => service.signin(ctx.request, body));
export const signoutRoute = authRoute(authRoutes.signout, { sameOrigin: true }, (_in, ctx) => service.signout(ctx.request));
export const deleteAccountRoute = authRoute(authRoutes.deleteAccount, { window: "accountIp", sameOrigin: true }, ({ body }, ctx) => service.deleteAccount(ctx.request, body));
export const guestRoute = authRoute(authRoutes.guest, { sameOrigin: true }, (_in, ctx) => codes.startGuest(ctx.request));
export const codeRequestRoute = authRoute(authRoutes.codeRequest, { window: "codeIp", sameOrigin: true }, ({ body }, ctx) => codes.requestCode(ctx.request, body));
export const codeVerifyRoute = authRoute(authRoutes.codeVerify, { window: "signinIp", sameOrigin: true }, ({ body }, ctx) => codes.verifyCode(ctx.request, body));
export const meRoute = authRoute(authRoutes.me, { sameOrigin: false }, async (_in, ctx) => ({ body: await service.me(ctx.request), cookies: [] }));

async function liveDeps(repo: OnboardingDeps["repo"]): Promise<OnboardingDeps> {
  return {
    repo,
    connectedTools: async (workspaceId) => {
      const all = await buildConnections(await squareDeps({ repo }), { ...(await liveCommsDeps()), repo }, workspaceId);
      return all.connections.filter((c) => c.provider !== "square" && c.provider !== "eventbrite" && c.status === "connected").map((c) => c.provider);
    },
  };
}

export const getOnboardingRoute = wsRoute(authRoutes.getOnboarding, async (_in, ctx) => getOnboarding(await liveDeps(ctx.repo), ctx.workspace));
const putOnboarding = wsRoute(authRoutes.putOnboarding, async ({ body }, ctx) => updateOnboarding(await liveDeps(ctx.repo), ctx.workspace, body));
export const putOnboardingRoute: Handler = async (request, args) => {
  try {
    assertSameOrigin(request);
  } catch (e) {
    return errorResponse(e);
  }
  return putOnboarding(request, args);
};
