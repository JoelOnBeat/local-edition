import { SKIPPABLE_STEPS, type AuthUser, type Chain, type OnboardingUpdate } from "@/contract";
import { MOCK_PASSWORD, MOCK_USER, mockAuthResult, mockSignedIn, mockSignedOut } from "@/mocks";
import { computeOnboarding, EMPTY_ONBOARDING, type OnboardingMemory } from "./onboarding";
import { newId } from "./ids";
import { ApiClientError, type ApiClient } from "./api-types";

/** Accounts and onboarding for the mock backend (NEXT_PUBLIC_DATA_MODE=mock). One in-memory account list; resets on reload. */

type AuthMethods = Pick<ApiClient, "signUp" | "signIn" | "signOut" | "getMe" | "deleteAccount" | "getOnboarding" | "updateOnboarding">;

interface Db { chain: Chain; menu: unknown[]; stores: unknown[]; latestEditions: unknown[] }

export function createMockAuth(db: Db, run: <T>(fn: () => T) => Promise<T>): AuthMethods {
  const accounts = new Map<string, { user: AuthUser; password: string }>([[MOCK_USER.email, { user: MOCK_USER, password: MOCK_PASSWORD }]]);
  let current: AuthUser | null = null;
  let memory: OnboardingMemory = { ...EMPTY_ONBOARDING };
  const state = () =>
    computeOnboarding({ chain: db.chain, menuItems: db.menu.length, stores: db.stores.length, builtStores: db.latestEditions.length, tools: [] }, memory);
  const wrong = () => new ApiClientError(401, "invalid_credentials", "That email and password do not match.");

  return {
    signUp: (input) => run(() => {
      const email = input.email.trim().toLowerCase();
      if (accounts.has(email)) throw new ApiClientError(409, "email_taken", "That email already has an account. Sign in instead.");
      const user: AuthUser = { id: newId("user"), name: input.name.trim(), email, createdAt: new Date().toISOString() };
      accounts.set(email, { user, password: input.password });
      current = user;
      if (!input.keepWorkspace) db.chain = { ...db.chain, name: input.chainName.trim(), brandVoice: [], anchors: [], isSample: false };
      return mockAuthResult(user, Boolean(input.keepWorkspace));
    }),
    signIn: (input) => run(() => {
      const found = accounts.get(input.email.trim().toLowerCase());
      if (!found || found.password !== input.password) throw wrong();
      current = found.user;
      return mockAuthResult(found.user);
    }),
    signOut: () => run(() => { current = null; }),
    getMe: () => run(() => (current ? mockSignedIn(current) : mockSignedOut())),
    deleteAccount: (password) => run(() => {
      const found = current ? accounts.get(current.email) : undefined;
      if (!found || found.password !== password) throw wrong();
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
