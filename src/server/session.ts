import type { Edition, StaffCard, Workspace } from "@/contract";
import { newId, newToken } from "@/lib/ids";
import { buildCookie, isSecureRequest, readCookie } from "./http/cookies";
import { HttpError } from "./http/errors";
import { clientIp, ipHash } from "./limits";
import { serial } from "./serial";
import { sampleSeed } from "./sample/chain";
import { getAuthStore } from "./auth";
import { getPrincipal } from "./auth/sessions";
import { DEMO_WORKSPACE_ID, getRepo, isAccountId, remapId, workspaceSuffix, WorkspaceExistsError, type Repo, type SeedWithId } from "./store";

/**
 * Visitor identity. The httpOnly cookie `le_ws` holds an unguessable workspace id; whoever holds it
 * can reach that workspace's rows and nothing else. Each new workspace is seeded with a private copy
 * of the sample chain (ids remapped, so no two workspaces share a row) plus copies of the canonical
 * demo workspace's newest editions, so a judge sees a finished edition on the first request.
 */

export const WORKSPACE_COOKIE = "le_ws";
export { DEMO_WORKSPACE_ID };
const COOKIE_MAX_AGE_SECONDS = 30 * 24 * 3600;

export interface ResolvedWorkspace {
  workspaceId: string;
  /** Set-Cookie value to send when a new workspace was created. */
  setCookie?: string;
}

export interface NewWorkspaceLimit {
  /** Bucket size: how many workspaces one IP can create in a burst. */
  capacity: number;
  /** Seconds to earn one more token back. */
  refillSeconds: number;
}
export const DEFAULT_LIMIT: NewWorkspaceLimit = { capacity: 10, refillSeconds: 300 };
/**
 * Most new visitor workspaces the whole app creates in one hour, whoever asks. Each one seeds a copy of the sample chain
 * into D1, and per-network buckets alone cannot stop a spread of networks (or a lost client address) from filling it.
 */
export const GLOBAL_WORKSPACES_PER_HOUR = 60;

export function buildSetCookie(workspaceId: string, secure: boolean): string {
  return buildCookie(WORKSPACE_COOKIE, workspaceId, COOKIE_MAX_AGE_SECONDS, secure);
}

export { readCookie };

interface Bucket { tokens: number; at: number }

/**
 * Simple token bucket kept in the repo cache (raw IPs are never stored, only a short hash). `ip` is the rate-limit
 * key from `clientIp`: an IPv4 address or an IPv6 /64.
 */
export async function takeWorkspaceToken(repo: Repo, ip: string, limit: NewWorkspaceLimit, now = Date.now()): Promise<boolean> {
  const key = `rl:ws:${await ipHash(ip)}`;
  return serial(key, async () => {
    const prev = await repo.cacheGet<Bucket>(key);
    const earned = prev ? ((now - prev.at) / 1000) / limit.refillSeconds : 0;
    const tokens = Math.min(limit.capacity, (prev?.tokens ?? limit.capacity) + earned);
    if (tokens < 1) return false;
    await repo.cachePut<Bucket>(key, { tokens: tokens - 1, at: now }, Math.ceil(limit.capacity * limit.refillSeconds) + 60);
    return true;
  });
}

/** App-wide cap on new workspaces per clock hour (a fixed window in the repo cache; best effort across isolates). */
export async function takeGlobalWorkspaceSlot(repo: Repo, perHour = GLOBAL_WORKSPACES_PER_HOUR, now = Date.now()): Promise<boolean> {
  const key = `rl:ws:global:${Math.floor(now / 3_600_000)}`;
  return serial(key, async () => {
    const used = (await repo.cacheGet<{ n: number }>(key))?.n ?? 0;
    if (used >= perHour) return false;
    await repo.cachePut(key, { n: used + 1 }, 2 * 3600);
    return true;
  });
}

/** The canonical demo workspace (sample chain with canonical ids). Created on first use. */
export async function ensureDemoWorkspace(repo: Repo): Promise<Workspace> {
  const existing = await repo.getWorkspace(DEMO_WORKSPACE_ID);
  if (existing) return existing;
  const seed: SeedWithId = { ...sampleSeed(), workspaceId: DEMO_WORKSPACE_ID };
  try {
    return await repo.createWorkspace(seed);
  } catch (e) {
    if (e instanceof WorkspaceExistsError) return (await repo.getWorkspace(DEMO_WORKSPACE_ID))!;
    throw e;
  }
}

function copyEdition(edition: Edition, suffix: string): Edition {
  return { ...structuredClone(edition), id: remapId(edition.id, suffix), storeId: remapId(edition.storeId, suffix) };
}

/**
 * Creates a seeded visitor workspace. The workspace record is written before the demo editions are
 * copied. Only each store's newest finished edition is copied: an edition that is still `drafting`
 * (the weekly build is running) would stay stuck in the visitor's workspace, where nothing finishes it.
 */
export async function createVisitorWorkspace(repo: Repo): Promise<Workspace> {
  const workspaceId = newId("ws");
  const suffix = workspaceSuffix(workspaceId);
  const base = sampleSeed();
  const chain = { ...base.chain, id: remapId(base.chain.id, suffix) };
  const stores = base.stores.map((s) => ({ ...s, id: remapId(s.id, suffix), chainId: chain.id }));
  const workspace = await repo.createWorkspace({ chain, stores, menu: base.menu, workspaceId } as SeedWithId);

  const demo = await repo.getWorkspace(DEMO_WORKSPACE_ID);
  if (demo) {
    const demoStores = await repo.listStores(demo.chainId);
    for (const edition of await repo.listEditions({ storeIds: demoStores.map((s) => s.id), finishedOnly: true })) {
      const copy = copyEdition(edition, suffix);
      await repo.putEdition(copy);
      const card = await repo.getStaffCardByEdition(edition.id);
      if (card) {
        const copied: StaffCard = { ...structuredClone(card), editionId: copy.id, storeId: copy.storeId, token: newToken() };
        await repo.putStaffCard(copied);
      }
    }
  }
  return workspace;
}

/**
 * The workspace a read-only public page should show: the visitor's own when their cookie names a live workspace, otherwise the
 * canonical demo workspace if it exists, otherwise none. Never creates a workspace and never sets a cookie, so /proof and /limits
 * stay public pages and a visitor who only reads them does not get a private copy.
 */
export async function peekWorkspace(request: Request, repo?: Repo): Promise<Workspace | null> {
  const store = repo ?? (await getRepo());
  const principal = await getPrincipal(request);
  if (principal) {
    const own = await store.getWorkspace(principal.workspaceId);
    if (own) return own;
  }
  const cookie = readCookie(request, WORKSPACE_COOKIE);
  // An account's workspace is reachable only through its session, never through this cookie alone.
  if (cookie && cookie !== DEMO_WORKSPACE_ID && !isAccountId(cookie)) {
    const own = await store.getWorkspace(cookie);
    if (own) return own;
  }
  return store.getWorkspace(DEMO_WORKSPACE_ID);
}

/**
 * Session -> workspace id. Data routes need a session: an account's, or the guest session "Try the sample chain" creates
 * (POST /api/auth/guest). Without a valid one this answers 401 `unauthenticated`, which the client turns into sign-in. A signed-in
 * user always gets their own workspace, whatever `le_ws` says. Tests that predate sessions set LE_ALLOW_ANONYMOUS=1 (honoured outside
 * production only) to keep the old behaviour: a missing or unknown cookie gets a fresh seeded workspace, rate limited per IP.
 * The `demo` id is never accepted from a cookie: it belongs to the weekly job.
 */
const allowAnonymous = (): boolean => process.env.NODE_ENV !== "production" && process.env.LE_ALLOW_ANONYMOUS === "1";

export async function resolveWorkspace(
  request: Request,
  repo?: Repo,
  limit: NewWorkspaceLimit = DEFAULT_LIMIT,
): Promise<ResolvedWorkspace> {
  const store = repo ?? (await getRepo());
  // A signed-in user always gets their own workspace, whatever `le_ws` says: the cookie cannot point them at someone else's.
  const principal = await getPrincipal(request);
  if (principal) {
    if (!(await store.getWorkspace(principal.workspaceId))) {
      if (principal.kind === "guest") {
        // The sample workspace expired: the guest session is over with it.
        await (await getAuthStore()).deleteSession(principal.session.id);
        throw new HttpError(401, "unauthenticated", "Your sample session ended. Open the sample chain again.");
      }
      await (await import("./auth/workspace")).ensureAccountWorkspace(store, principal.user);
    }
    const cookie = readCookie(request, WORKSPACE_COOKIE);
    return cookie === principal.workspaceId ? { workspaceId: principal.workspaceId } : { workspaceId: principal.workspaceId, setCookie: buildSetCookie(principal.workspaceId, isSecureRequest(request)) };
  }
  if (!allowAnonymous()) throw new HttpError(401, "unauthenticated", "Sign in to continue.");
  const cookie = readCookie(request, WORKSPACE_COOKIE);
  // An `acct_` id is an account's workspace: without that account's session it is treated like any unknown cookie.
  if (cookie && cookie !== DEMO_WORKSPACE_ID && !isAccountId(cookie) && (await store.getWorkspace(cookie))) return { workspaceId: cookie };

  // A request with no client address shares the "unknown" bucket. In production that means Cloudflare's
  // `cf-connecting-ip` did not survive the Pages hop (see `clientIp`), so the whole site would share ten workspaces.
  if (!(await takeWorkspaceToken(store, clientIp(request), limit))) {
    throw new HttpError(429, "rate_limited", "Too many new workspaces from this network. Try again in a few minutes.");
  }
  if (!(await takeGlobalWorkspaceSlot(store))) {
    throw new HttpError(429, "workspace_cap", "A lot of new visitors have arrived in the last hour. Try again in a few minutes.");
  }
  const workspace = await createVisitorWorkspace(store);
  return { workspaceId: workspace.id, setCookie: buildSetCookie(workspace.id, isSecureRequest(request)) };
}
