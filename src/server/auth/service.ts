import { SESSION_COOKIE, type AuthResult, type DeleteAccountInput, type MeResponse, type SigninInput, type SignupInput } from "@/contract";
import { newId } from "@/lib/ids";
import { isSecureRequest, readCookie } from "../http/cookies";
import { HttpError } from "../http/errors";
import { buildSetCookie, WORKSPACE_COOKIE } from "../session";
import { getRepo } from "../store";
import { getCodeSender } from "./code-sender";
import { EmailTakenError, getAuthStore, type UserRow } from "./index";
import { hashPassword, verifyAgainstDummy, verifyPassword } from "./password";
import { clearCookie, getPrincipal, issueSession, sessionCookie, sessionToken, sha256Hex, toAuthUser } from "./sessions";
import { assertNotLocked, clearFailures, failureKeys, networkOf, recordFailure, takeWindow } from "./throttle";
import { eraseWorkspace } from "./erase";
import { adoptVisitorWorkspace, createAccountWorkspace, keepableWorkspace } from "./workspace";

/** The password auth use-cases (codes and guests are in code-service.ts). Each returns the JSON body plus the Set-Cookie lines the route must send. */

export interface Reply<T> {
  body: T;
  cookies: string[];
}

export const wrongCredentials = () => new HttpError(401, "invalid_credentials", "That email and password do not match.");

/** Rotation: whatever session this browser held (a guest's included) is revoked and a fresh token is issued. */
export async function startSession(request: Request, user: Pick<UserRow, "id" | "workspaceId">): Promise<string[]> {
  const store = await getAuthStore();
  const old = sessionToken(request);
  if (old) await store.deleteSession(await sha256Hex(old));
  const { token, maxAgeSeconds } = await issueSession(store, user);
  const secure = isSecureRequest(request);
  return [sessionCookie(token, maxAgeSeconds, secure), buildSetCookie(user.workspaceId, secure)];
}

export const signedOutCookies = (request: Request): string[] => {
  const secure = isSecureRequest(request);
  return [clearCookie(SESSION_COOKIE, secure), clearCookie(WORKSPACE_COOKIE, secure)];
};

/** The sample workspace a signing-up visitor can bring along: their guest session's, else a legacy `le_ws` visitor cookie. */
export async function keepSource(request: Request): Promise<string | null> {
  const principal = await getPrincipal(request);
  if (principal?.kind === "guest") return keepableWorkspace(await getRepo(), principal.workspaceId);
  if (principal) return null;
  return keepableWorkspace(await getRepo(), readCookie(request, WORKSPACE_COOKIE));
}

/** Makes the user row (and the workspace it owns) for a new address, from a sign-up form or from a first one-time code. */
export async function createAccount(request: Request, input: { email: string; name: string; chainName: string; passwordHash: string; keepWorkspace: boolean }): Promise<{ user: UserRow; kept: boolean }> {
  const store = await getAuthStore();
  const repo = await getRepo();
  const keepFrom = input.keepWorkspace ? await keepSource(request) : null;
  const workspaceId = keepFrom ? await adoptVisitorWorkspace(repo, keepFrom, input.chainName) : await createAccountWorkspace(repo, input.chainName);
  const user: UserRow = { id: newId("user"), email: input.email, name: input.name, passwordHash: input.passwordHash, workspaceId, createdAt: new Date().toISOString() };
  try {
    await store.createUser(user);
  } catch (e) {
    await eraseWorkspace(workspaceId, repo).catch(() => undefined);
    throw e;
  }
  const now = Date.now();
  await store.deleteExpiredSessions(now);
  await store.deleteExpiredCounters(now - 2 * 24 * 3600 * 1000);
  await store.deleteExpiredLoginCodes(now);
  return { user, kept: keepFrom !== null };
}

export async function signup(request: Request, input: SignupInput): Promise<Reply<AuthResult>> {
  const store = await getAuthStore();
  await takeWindow(store, "signupEmail", input.email);
  const taken = () => new HttpError(409, "email_taken", "That email already has an account. Sign in instead.");
  if (await store.getUserByEmail(input.email)) throw taken();
  const passwordHash = await hashPassword(input.password);
  let made: { user: UserRow; kept: boolean };
  try {
    made = await createAccount(request, { email: input.email, name: input.name, chainName: input.chainName, passwordHash, keepWorkspace: input.keepWorkspace });
  } catch (e) {
    throw e instanceof EmailTakenError ? taken() : e;
  }
  return { body: { user: toAuthUser(made.user), workspaceId: made.user.workspaceId, keptWorkspace: made.kept, created: true }, cookies: await startSession(request, made.user) };
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
  return { body: { user: toAuthUser(user), workspaceId: user.workspaceId, keptWorkspace: false, created: false }, cookies: await startSession(request, user) };
}

/** Always succeeds: a request with no session, or a dead one, still ends up signed out with its cookies cleared. */
export async function signout(request: Request): Promise<Reply<{ ok: true }>> {
  const token = sessionToken(request);
  if (token) await (await getAuthStore()).deleteSession(await sha256Hex(token));
  return { body: { ok: true }, cookies: signedOutCookies(request) };
}

/** Who this browser is, for the links, the guard and the sign-in screen. Never creates a workspace. */
export async function me(request: Request): Promise<MeResponse> {
  const principal = await getPrincipal(request);
  const codeSignIn = (await getCodeSender()) !== null;
  if (principal?.kind === "user") {
    const doc = await (await getAuthStore()).getOnboarding(principal.workspaceId);
    return { user: toAuthUser(principal.user), session: "user", onboardingComplete: Boolean(doc?.completedAt), workspace: { id: principal.workspaceId, kind: "account" }, canKeepWorkspace: false, codeSignIn };
  }
  if (principal) return { user: null, session: "guest", onboardingComplete: null, workspace: { id: principal.workspaceId, kind: "sample" }, canKeepWorkspace: true, codeSignIn };
  return { user: null, session: null, onboardingComplete: null, workspace: null, canKeepWorkspace: false, codeSignIn };
}

/**
 * Deletes the signed-in account: its workspace with every connection, token, store, edition and photo, then the sessions and the user.
 * The password is asked again (an account made by one-time code has none: it types its email address). Wrong tries count like failed sign-ins.
 */
export async function deleteAccount(request: Request, input: DeleteAccountInput): Promise<Reply<{ ok: true }>> {
  const principal = await getPrincipal(request);
  if (principal?.kind !== "user") throw new HttpError(401, "unauthenticated", "Sign in to delete your account.");
  const store = await getAuthStore();
  const keys = await failureKeys(principal.user.email, networkOf(request));
  await assertNotLocked(store, keys);
  const hasPassword = principal.user.passwordHash !== "";
  const confirmed = hasPassword
    ? input.password !== undefined && (await verifyPassword(input.password, principal.user.passwordHash)).ok
    : input.confirmEmail?.normalize("NFKC").trim().toLowerCase() === principal.user.email;
  if (!confirmed) {
    await recordFailure(store, keys);
    throw new HttpError(401, "invalid_credentials", hasPassword ? "That password is not right." : "Type your email address exactly to confirm.");
  }
  await clearFailures(store, keys);
  await eraseWorkspace(principal.workspaceId);
  await store.deleteUser(principal.user.id);
  return { body: { ok: true }, cookies: signedOutCookies(request) };
}
