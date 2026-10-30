import { SKIPPABLE_STEPS, type AuthUser, type Chain, type OnboardingUpdate } from "@/contract";
import { MOCK_CODE, MOCK_PASSWORD, MOCK_USER, MOCK_WORKSPACE_ID, mockAuthResult, mockGuest, mockSignedIn, mockSignedOut } from "@/mocks";
import { computeOnboarding, EMPTY_ONBOARDING, type OnboardingMemory } from "./onboarding";
import { newId } from "./ids";
import { ApiClientError, type ApiClient } from "./api-types";

/** Accounts and onboarding for the mock backend (NEXT_PUBLIC_DATA_MODE=mock). One in-memory account list; resets on reload. */

type AuthMethods = Pick<ApiClient, "signUp" | "signIn" | "startGuest" | "requestCode" | "verifyCode" | "signOut" | "getMe" | "deleteAccount" | "getOnboarding" | "updateOnboarding">;

interface Db { chain: Chain; menu: unknown[]; stores: unknown[]; latestEditions: unknown[] }

export function createMockAuth(db: Db, run: <T>(fn: () => T) => Promise<T>): AuthMethods {
  const accounts = new Map<string, { user: AuthUser; password: string }>([[MOCK_USER.email, { user: MOCK_USER, password: MOCK_PASSWORD }]]);
  let current: AuthUser | null = null;
  let guest = true; // the mock app opens on the sample chain, like a visitor who just clicked "Try the sample chain"
  const requested = new Set<string>();
  let memory: OnboardingMemory = { ...EMPTY_ONBOARDING };
  const state = () =>
    computeOnboarding({ chain: db.chain, menuItems: db.menu.length, stores: db.stores.length, builtStores: db.latestEditions.length, tools: [] }, memory);
  const wrong = () => new ApiClientError(401, "invalid_credentials", "That email and password do not match.");

  return {
    signUp: (input) => run(() => {
      const email = input.email.trim().toLowerCase();
      if (accounts.has(email)) throw new ApiClientError(409, "email_taken", "That email already has an account. Sign in instead.");
      const user: AuthUser = { id: newId("user"), name: input.name.trim(), email, createdAt: new Date().toISOString(), hasPassword: true };
      accounts.set(email, { user, password: input.password });
      current = user;
      guest = false;
      if (!input.keepWorkspace) db.chain = { ...db.chain, name: input.chainName.trim(), brandVoice: [], anchors: [], isSample: false };
      return mockAuthResult(user, Boolean(input.keepWorkspace));
    }),
    signIn: (input) => run(() => {
      const found = accounts.get(input.email.trim().toLowerCase());
      if (!found || found.password !== input.password) throw wrong();
      current = found.user;
      guest = false;
      return mockAuthResult(found.user);
    }),
    startGuest: () => run(() => { if (!current) guest = true; return { workspaceId: MOCK_WORKSPACE_ID, session: current ? ("user" as const) : ("guest" as const) }; }),
    requestCode: (email) => run(() => {
      requested.add(email.trim().toLowerCase());
      return { ok: true as const, resendAfterSeconds: 30, expiresInSeconds: 600 };
    }),
    verifyCode: (input) => run(() => {
      const email = input.email.trim().toLowerCase();
      if (!requested.has(email)) throw new ApiClientError(401, "code_expired", "That code has expired or was already used. Ask for a new one.");
      if (input.code.replace(/[\s-]/g, "") !== MOCK_CODE) throw new ApiClientError(401, "invalid_code", "That code is not right. 4 tries left.");
      requested.delete(email);
      let found = accounts.get(email);
      const created = !found;
      if (!found) {
        found = { user: { id: newId("user"), name: email.split("@")[0], email, createdAt: new Date().toISOString(), hasPassword: false }, password: "" };
        accounts.set(email, found);
      }
      current = found.user;
      guest = false;
      return mockAuthResult(found.user, false, created);
    }),
    signOut: () => run(() => { current = null; guest = false; }),
    getMe: () => run(() => (current ? mockSignedIn(current, memory.completedAt != null || state().complete) : guest ? mockGuest() : mockSignedOut())),
    deleteAccount: (confirm) => run(() => {
      const found = current ? accounts.get(current.email) : undefined;
      const typed = typeof confirm === "string" ? { password: confirm } : confirm;
      const ok = found && (found.password !== "" ? typed.password === found.password : typed.confirmEmail?.trim().toLowerCase() === found.user.email);
      if (!found || !ok) throw wrong();
      accounts.delete(found.user.email);
      current = null;
    }),
    getOnboarding: () => run(state),
    updateOnboarding: (update: OnboardingUpdate) => run(() => {
      const bad = update.skip?.find((s) => !SKIPPABLE_STEPS.includes(s));
      if (bad) throw new ApiClientError(400, "not_skippable", "That step is needed before the first edition and cannot be skipped.");
      if (update.basics) {
        db.chain = { ...db.chain, ...update.basics };
        memory.basicsConfirmed = true;
      }
      const un = new Set(update.unskip ?? []);
      memory = { ...memory, skipped: [...new Set([...memory.skipped, ...(update.skip ?? [])])].filter((s) => !un.has(s)), current: update.current ?? memory.current, updatedAt: Date.now() };
      return state();
    }),
  };
}
