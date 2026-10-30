import { AuthUser, AuthResult, MeResponse, OnboardingState } from "@/contract";
import { MOCK_NOW, MOCK_WORKSPACE_ID } from "./helpers";

/** Sample accounts for the mock backend. Never a real person: the address is on a reserved example domain. */

export const MOCK_USER: AuthUser = AuthUser.parse({
  id: "user_mock0001",
  name: "Maya Okafor",
  email: "maya@kettleandkiln.example",
  createdAt: MOCK_NOW,
});
export const MOCK_PASSWORD = "correct horse battery";

export const mockAuthResult = (user: AuthUser = MOCK_USER, keptWorkspace = false): AuthResult =>
  AuthResult.parse({ user, workspaceId: `acct_${user.id.slice(5)}`, keptWorkspace });

export const mockSignedOut = (): MeResponse =>
  MeResponse.parse({ user: null, workspace: { id: MOCK_WORKSPACE_ID, kind: "sample" }, canKeepWorkspace: true });

export const mockSignedIn = (user: AuthUser = MOCK_USER): MeResponse =>
  MeResponse.parse({ user, workspace: { id: `acct_${user.id.slice(5)}`, kind: "account" }, canKeepWorkspace: false });

/** A fresh account: nothing is done yet, so every screen shows its empty state. */
export const mockFreshOnboarding = (): OnboardingState => OnboardingState.parse({ steps: [], current: null, complete: false, updatedAt: null });
