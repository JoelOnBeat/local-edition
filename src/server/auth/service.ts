import { SESSION_COOKIE, type AuthResult, type DeleteAccountInput, type MeResponse, type SigninInput, type SignupInput } from "@/contract";
import { newId } from "@/lib/ids";
import { isSecureRequest, readCookie } from "../http/cookies";
import { HttpError } from "../http/errors";
import { buildSetCookie, WORKSPACE_COOKIE } from "../session";
import { getRepo } from "../store";
import { EmailTakenError, getAuthStore } from "./index";
import { hashPassword, verifyAgainstDummy, verifyPassword } from "./password";
import { clearCookie, getPrincipal, issueSession, sessionCookie, sessionToken, sha256Hex, toAuthUser } from "./sessions";
import { assertNotLocked, clearFailures, failureKeys, networkOf, recordFailure, takeWindow } from "./throttle";
import { eraseWorkspace } from "./erase";
import { adoptVisitorWorkspace, createAccountWorkspace, keepableWorkspace } from "./workspace";

/** The auth use-cases. Each returns the JSON body plus the Set-Cookie lines the route must send. */

export interface Reply<T> {
  body: T;
  cookies: string[];
}

const wrongCredentials = () => new HttpError(401, "invalid_credentials", "That email and password do not match.");

async function startSession(request: Request, userId: string, workspaceId: string): Promise<string[]> {
  const store = await getAuthStore();
  // Rotation: whatever session this browser held is revoked, and a fresh token is issued.
  const old = sessionToken(request);
  if (old) await store.deleteSession(await sha256Hex(old));
  const { token, maxAgeSeconds } = await issueSession(store, userId);
  const secure = isSecureRequest(request);
  return [sessionCookie(token, maxAgeSeconds, secure), buildSetCookie(workspaceId, secure)];
}

const signedOutCookies = (request: Request): string[] => {
  const secure = isSecureRequest(request);
  return [clearCookie(SESSION_COOKIE, secure), clearCookie(WORKSPACE_COOKIE, secure)];
};

export async function signup(request: Request, input: SignupInput): Promise<Reply<AuthResult>> {
  const store = await getAuthStore();
  const repo = await getRepo();
  await takeWindow(store, "signupEmail", input.email);
  if (await store.getUserByEmail(input.email)) throw new HttpError(409, "email_taken", "That email already has an account. Sign in instead.");
  const passwordHash = await hashPassword(input.password);

  const keepFrom = input.keepWorkspace ? await keepableWorkspace(repo, readCookie(request, WORKSPACE_COOKIE)) : null;
  const workspaceId = keepFrom ? await adoptVisitorWorkspace(repo, keepFrom, input.chainName) : await createAccountWorkspace(repo, input.chainName);
  const user = { id: newId("user"), email: input.email, name: input.name, passwordHash, workspaceId, createdAt: new Date().toISOString() };
  try {
    await store.createUser(user);
  } catch (e) {
    await eraseWorkspace(workspaceId, repo).catch(() => undefined);
    if (e instanceof EmailTakenError) throw new HttpError(409, "email_taken", "That email already has an account. Sign in instead.");
    throw e;
  }
  const now = Date.now();
  await store.deleteExpiredSessions(now);
  await store.deleteExpiredCounters(now - 2 * 24 * 3600 * 1000);
  return { body: { user: toAuthUser(user), workspaceId, keptWorkspace: keepFrom !== null }, cookies: await startSession(request, user.id, workspaceId) };
}

export async function signin(request: Request, input: SigninInput): Promise<Reply<AuthResult>> {
  const store = await getAuthStore();
  const keys = await failureKeys(input.email, networkOf(request));
  await takeWindow(store, "signinEmail", input.email);
  await assertNotLocked(store, keys);

  const user = await store.getUserByEmail(input.email);
  if (!user) {
    await verifyAgainstDummy(input.password);
    await recordFailure(store, keys);
    throw wrongCredentials();
  }
  const check = await verifyPassword(input.password, user.passwordHash);
  if (!check.ok) {
    await recordFailure(store, keys);
    throw wrongCredentials();
  }
  await clearFailures(store, keys);
  if (check.needsRehash) await store.setPasswordHash(user.id, await hashPassword(input.password));
  return { body: { user: toAuthUser(user), workspaceId: user.workspaceId, keptWorkspace: false }, cookies: await startSession(request, user.id, user.workspaceId) };
}

/** Always succeeds: a request with no session, or a dead one, still ends up signed out with its cookies cleared. */
export async function signout(request: Request): Promise<Reply<{ ok: true }>> {
  const token = sessionToken(request);
  if (token) await (await getAuthStore()).deleteSession(await sha256Hex(token));
  return { body: { ok: true }, cookies: signedOutCookies(request) };
}

/** Never creates a workspace: it only reports what this browser would use. */
export async function me(request: Request): Promise<MeResponse> {
  const principal = await getPrincipal(request);
  if (principal) return { user: toAuthUser(principal.user), workspace: { id: principal.workspaceId, kind: "account" }, canKeepWorkspace: false };
  const keep = await keepableWorkspace(await getRepo(), readCookie(request, WORKSPACE_COOKIE));
  return { user: null, workspace: keep ? { id: keep, kind: "sample" } : null, canKeepWorkspace: keep !== null };
}

/**
 * Deletes the signed-in account: its workspace with every connection, token, store, edition and photo, then the sessions and the user.
 * The password is asked again, and wrong guesses count like failed sign-ins.
 */
export async function deleteAccount(request: Request, input: DeleteAccountInput): Promise<Reply<{ ok: true }>> {
  const principal = await getPrincipal(request);
  if (!principal) throw new HttpError(401, "unauthenticated", "Sign in to delete your account.");
  const store = await getAuthStore();
  const keys = await failureKeys(principal.user.email, networkOf(request));
  await assertNotLocked(store, keys);
  if (!(await verifyPassword(input.password, principal.user.passwordHash)).ok) {
    await recordFailure(store, keys);
    throw new HttpError(401, "invalid_credentials", "That password is not right.");
  }
  await clearFailures(store, keys);
  await eraseWorkspace(principal.workspaceId);
  await store.deleteUser(principal.user.id);
  return { body: { ok: true }, cookies: signedOutCookies(request) };
}
