import { CODE_RESEND_SECONDS, CODE_TTL_SECONDS, type AuthResult, type CodeRequestResponse, type GuestResult } from "@/contract";
import { isSecureRequest, readCookie } from "../http/cookies";
import { HttpError, RetryAfterError } from "../http/errors";
import { clientIp } from "../limits";
import { buildSetCookie, createVisitorWorkspace, DEFAULT_LIMIT, takeGlobalWorkspaceSlot, takeWorkspaceToken, WORKSPACE_COOKIE } from "../session";
import { getRepo } from "../store";
import { codeMatches, hashCode, MAX_CODE_ATTEMPTS, newCode } from "./codes";
import { EmailUnavailableError, getCodeSender } from "./code-sender";
import { getAuthStore, EmailTakenError } from "./index";
import { createAccount, startSession, type Reply } from "./service";
import { getPrincipal, issueGuestSession, sessionCookie, toAuthUser } from "./sessions";
import { assertNotLocked, clearFailures, failureKeys, networkOf, recordFailure, takeWindow } from "./throttle";
import { keepableWorkspace } from "./workspace";

/** "Try the sample chain" (a guest session) and sign-in by emailed one-time code (which also makes the account on first use). */

const unavailable = () => new HttpError(503, "email_unavailable", "Emailed codes are not available right now. Sign in with your password instead.");
const expired = () => new HttpError(401, "code_expired", "That code has expired or was already used. Ask for a new one.");

/** A real session on a sample workspace, so the sample passes the same middleware as an account. Reuses a legacy visitor workspace if the browser has one. */
export async function startGuest(request: Request): Promise<Reply<GuestResult>> {
  const existing = await getPrincipal(request);
  if (existing) return { body: { workspaceId: existing.workspaceId, session: existing.kind }, cookies: [] };

  const repo = await getRepo();
  let workspaceId = await keepableWorkspace(repo, readCookie(request, WORKSPACE_COOKIE));
  if (!workspaceId) {
    // The same allowances as a new visitor workspace always had: one IP cannot fill the database, nor can a spread of them.
    if (!(await takeWorkspaceToken(repo, clientIp(request), DEFAULT_LIMIT))) throw new RetryAfterError(429, "rate_limited", "Too many new sample chains from this network. Try again in a few minutes.", 300);
    if (!(await takeGlobalWorkspaceSlot(repo))) throw new RetryAfterError(429, "rate_limited", "A lot of new visitors have arrived. Try again in a few minutes.", 300);
    workspaceId = (await createVisitorWorkspace(repo)).id;
  }
  const { token, maxAgeSeconds } = await issueGuestSession(await getAuthStore(), workspaceId);
  const secure = isSecureRequest(request);
  return { body: { workspaceId, session: "guest" }, cookies: [sessionCookie(token, maxAgeSeconds, secure), buildSetCookie(workspaceId, secure)] };
}

/** Emails a six-digit code. The answer is the same whether or not the address has an account. */
export async function requestCode(request: Request, input: { email: string }, now = Date.now()): Promise<Reply<CodeRequestResponse>> {
  const sender = await getCodeSender();
  if (!sender) throw unavailable();
  const store = await getAuthStore();
  await takeWindow(store, "codeEmail", input.email, now);

  const live = await store.getLoginCode(input.email);
  if (live && live.sentAt > now - CODE_RESEND_SECONDS * 1000) {
    throw new RetryAfterError(429, "rate_limited", `A code was just sent. Wait ${Math.ceil((live.sentAt + CODE_RESEND_SECONDS * 1000 - now) / 1000)} seconds to ask for another.`, (live.sentAt + CODE_RESEND_SECONDS * 1000 - now) / 1000);
  }
  const code = newCode();
  await store.putLoginCode({ email: input.email, codeHash: await hashCode(input.email, code), expiresAt: now + CODE_TTL_SECONDS * 1000, attempts: 0, sentAt: now });
  try {
    await sender.send({ to: input.email, code, expiresInMinutes: CODE_TTL_SECONDS / 60 });
  } catch (e) {
    await store.deleteLoginCode(input.email); // a code nobody received must not stay guessable
    if (e instanceof EmailUnavailableError) throw unavailable();
    throw e;
  }
  return { body: { ok: true, resendAfterSeconds: CODE_RESEND_SECONDS, expiresInSeconds: CODE_TTL_SECONDS }, cookies: [] };
}

/** Checks the code and signs in; an address with no account gets one (empty chain, no password) in the same step. Five wrong tries burn the code. */
export async function verifyCode(request: Request, input: { email: string; code: string; keepWorkspace: boolean }, now = Date.now()): Promise<Reply<AuthResult>> {
  const store = await getAuthStore();
  const keys = await failureKeys(input.email, networkOf(request));
  await takeWindow(store, "signinEmail", input.email, now);
  await assertNotLocked(store, keys, now);

  const row = await store.getLoginCode(input.email);
  if (!row || row.expiresAt <= now) {
    if (row) await store.deleteLoginCode(input.email);
    throw expired();
  }
  if (!(await codeMatches(input.email, input.code, row.codeHash))) {
    const tries = await store.bumpLoginCodeAttempts(input.email);
    await recordFailure(store, keys, now);
    if (tries >= MAX_CODE_ATTEMPTS) {
      await store.deleteLoginCode(input.email);
      throw new HttpError(401, "code_expired", "Too many wrong codes. Ask for a new one.");
    }
    throw new HttpError(401, "invalid_code", `That code is not right. ${MAX_CODE_ATTEMPTS - tries} ${MAX_CODE_ATTEMPTS - tries === 1 ? "try" : "tries"} left.`);
  }
  await store.deleteLoginCode(input.email);
  await clearFailures(store, keys);

  let user = await store.getUserByEmail(input.email);
  let created = false;
  let kept = false;
  if (!user) {
    try {
      const made = await createAccount(request, { email: input.email, name: input.email.split("@")[0].slice(0, 80), chainName: "My chain", passwordHash: "", keepWorkspace: input.keepWorkspace });
      user = made.user;
      kept = made.kept;
      created = true;
    } catch (e) {
      if (!(e instanceof EmailTakenError)) throw e;
      user = await store.getUserByEmail(input.email); // a parallel verify made it first
    }
  }
  if (!user) throw expired();
  return { body: { user: toAuthUser(user), workspaceId: user.workspaceId, keptWorkspace: kept, created }, cookies: await startSession(request, user) };
}
