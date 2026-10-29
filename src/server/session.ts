import type { Edition, StaffCard, Workspace } from "@/contract";
import { newId, newToken } from "@/lib/ids";
import { HttpError } from "./http/errors";
import { clientIp, ipHash } from "./limits";
import { serial } from "./serial";
import { sampleSeed } from "./sample/chain";
import { getRepo, remapId, workspaceSuffix, WorkspaceExistsError, type Repo, type SeedWithId } from "./store";

/**
 * Visitor identity. The httpOnly cookie `le_ws` holds an unguessable workspace id; whoever holds it
 * can reach that workspace's rows and nothing else. Each new workspace is seeded with a private copy
 * of the sample chain (ids remapped, so no two workspaces share a row) plus copies of the canonical
 * demo workspace's newest editions, so a judge sees a finished edition on the first request.
 */

export const WORKSPACE_COOKIE = "le_ws";
export const DEMO_WORKSPACE_ID = "demo";
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

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const at = part.indexOf("=");
    if (at !== -1 && part.slice(0, at).trim() === name) {
      try {
        return decodeURIComponent(part.slice(at + 1).trim());
      } catch {
        return null; // a malformed %-sequence is a cookie we did not issue: treat it as absent
      }
    }
  }
  return null;
}

export function buildSetCookie(workspaceId: string, secure: boolean): string {
  const attrs = [`${WORKSPACE_COOKIE}=${encodeURIComponent(workspaceId)}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${COOKIE_MAX_AGE_SECONDS}`];
  if (secure) attrs.push("Secure");
  return attrs.join("; ");
}

/** Always Secure in production; elsewhere only when the request itself came over https. */
function isSecure(request: Request): boolean {
  if (process.env.NODE_ENV === "production") return true;
  return new URL(request.url).protocol === "https:" || request.headers.get("x-forwarded-proto") === "https";
}

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
 * Cookie -> workspace id. A missing, unknown or tampered cookie gets a fresh seeded workspace (rate
 * limited per IP). The `demo` id is never accepted from a cookie: it belongs to the weekly job.
 */
export async function resolveWorkspace(
  request: Request,
  repo?: Repo,
  limit: NewWorkspaceLimit = DEFAULT_LIMIT,
): Promise<ResolvedWorkspace> {
  const store = repo ?? (await getRepo());
  const cookie = readCookie(request, WORKSPACE_COOKIE);
  if (cookie && cookie !== DEMO_WORKSPACE_ID && (await store.getWorkspace(cookie))) return { workspaceId: cookie };

  // A request with no client address shares the "unknown" bucket. In production that means Cloudflare's
  // `cf-connecting-ip` did not survive the Pages hop (see `clientIp`), so the whole site would share ten workspaces.
  if (!(await takeWorkspaceToken(store, clientIp(request), limit))) {
    throw new HttpError(429, "rate_limited", "Too many new workspaces from this network. Try again in a few minutes.");
  }
  if (!(await takeGlobalWorkspaceSlot(store))) {
    throw new HttpError(429, "workspace_cap", "A lot of new visitors have arrived in the last hour. Try again in a few minutes.");
  }
  const workspace = await createVisitorWorkspace(store);
  return { workspaceId: workspace.id, setCookie: buildSetCookie(workspace.id, isSecure(request)) };
}
