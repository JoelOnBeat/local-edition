import { AuthUser, AuthResult, MeResponse, OnboardingState } from "@/contract";
import { MOCK_NOW, MOCK_WORKSPACE_ID } from "./helpers";

/** Sample accounts for the mock backend. Never a real person: the address is on a reserved example domain. */

export const MOCK_USER: AuthUser = AuthUser.parse({
  id: "user_mock0001",
  name: "Maya Okafor",
  email: "maya@kettleandkiln.example",
  createdAt: MOCK_NOW,
  hasPassword: true,
});
export const MOCK_PASSWORD = "correct horse battery";

/** The code the mock backend accepts for any address. */
export const MOCK_CODE = "424242";

export const mockAuthResult = (user: AuthUser = MOCK_USER, keptWorkspace = false, created = false): AuthResult =>
  AuthResult.parse({ user, workspaceId: `acct_${user.id.slice(5)}`, keptWorkspace, created });

/** Signed out: no session, no workspace. */
export const mockSignedOut = (codeSignIn = true): MeResponse =>
  MeResponse.parse({ user: null, session: null, onboardingComplete: null, codeSignIn, workspace: null, canKeepWorkspace: false });

/** "Try the sample chain": a guest session on a sample workspace. */
export const mockGuest = (codeSignIn = true): MeResponse =>
  MeResponse.parse({ user: null, session: "guest", onboardingComplete: null, codeSignIn, workspace: { id: MOCK_WORKSPACE_ID, kind: "sample" }, canKeepWorkspace: true });

export const mockSignedIn = (user: AuthUser = MOCK_USER, onboardingComplete = true, codeSignIn = true): MeResponse =>
  MeResponse.parse({ user, session: "user", onboardingComplete, codeSignIn, workspace: { id: `acct_${user.id.slice(5)}`, kind: "account" }, canKeepWorkspace: false });

/** A fresh account: nothing is done yet, so every screen shows its empty state. */
export const mockFreshOnboarding = (): OnboardingState => OnboardingState.parse({ steps: [], current: null, complete: false, updatedAt: null });
