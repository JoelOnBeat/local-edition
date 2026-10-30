import type { OnboardingMemory } from "@/lib/onboarding";

/** Persistence for accounts, sessions, onboarding progress and the sign-in counters. D1 in production, a key-value store in dev and tests. */

export interface UserRow {
  id: string;
  /** Normalised (NFKC, trimmed, lower-case). */
  email: string;
  name: string;
  passwordHash: string;
  workspaceId: string;
  createdAt: string;
}

export interface SessionRow {
  /** SHA-256 hex of the cookie token. */
  id: string;
  userId: string;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
}

/** What onboarding remembers (see src/lib/onboarding.ts). */
export type OnboardingDoc = OnboardingMemory;

export interface CounterState {
  count: number;
  /** Window start (rate-limit counter) or time of the last failure (failure counter), epoch ms. */
  at: number;
}

export class EmailTakenError extends Error {
  constructor() {
    super("That email already has an account.");
    this.name = "EmailTakenError";
  }
}

export interface AuthStore {
  /** Throws EmailTakenError when the email (or workspace) is already taken. */
  createUser(user: UserRow): Promise<void>;
  getUserByEmail(email: string): Promise<UserRow | null>;
  getUserById(id: string): Promise<UserRow | null>;
  setPasswordHash(userId: string, passwordHash: string): Promise<void>;
  /** The user, their sessions and their onboarding documents. */
  deleteUser(userId: string): Promise<void>;

  createSession(session: SessionRow): Promise<void>;
  /** The session and its user; null when unknown. Expiry is the caller's check (an expired row is still returned). */
  findSession(idHash: string): Promise<{ session: SessionRow; user: UserRow } | null>;
  touchSession(idHash: string, lastSeenAt: number, expiresAt: number): Promise<void>;
  deleteSession(idHash: string): Promise<void>;
  /** Keeps only the `keep` newest sessions of the user (never the one named in `protect`). */
  trimSessions(userId: string, keep: number, protect: string): Promise<void>;
  deleteExpiredSessions(now: number): Promise<void>;

  getOnboarding(workspaceId: string): Promise<OnboardingDoc | null>;
  putOnboarding(workspaceId: string, doc: OnboardingDoc): Promise<void>;
  deleteOnboarding(workspaceId: string): Promise<void>;

  /** Fixed-window counter: counts this call and returns the window's count (a window older than `windowMs` restarts at 1). */
  hit(key: string, windowMs: number, now: number): Promise<CounterState>;
  /** Failure counter: counts a failure and returns it (failures older than `resetMs` are forgotten first). */
  fail(key: string, resetMs: number, now: number): Promise<CounterState>;
  peek(key: string): Promise<CounterState | null>;
  clear(key: string): Promise<void>;
  deleteExpiredCounters(before: number): Promise<void>;
}
