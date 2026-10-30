import { z } from "zod";
import { ChainCategory } from "./domain";
import type { RouteSpec } from "./route-spec";

/**
 * Accounts and onboarding (30 Oct). Email + password only: there is no email provider, so no codes and no reset emails.
 * The product is free to use (Qloo's hackathon key forbids production use): nothing here touches payments or plans.
 *
 * Session: the httpOnly cookie `le_sid` (opaque token, only its SHA-256 is stored). Sign-in also sets `le_ws` to the account's
 * workspace id (`acct_...`) so the connector OAuth callbacks keep working; the server never trusts an `acct_` id from `le_ws`
 * without a matching session.
 */

export const SESSION_COOKIE = "le_sid";
export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 128;

/** Lower-case, NFKC, trimmed. The one normal form used for lookup and uniqueness. */
export function normaliseEmail(raw: string): string {
  return raw.normalize("NFKC").trim().toLowerCase();
}

export const Email = z
  .string()
  .max(254, "Email is too long.")
  .transform(normaliseEmail)
  .pipe(z.email("Enter a valid email address."));

export const Password = z
  .string()
  .min(PASSWORD_MIN, `Use at least ${PASSWORD_MIN} characters.`)
  .max(PASSWORD_MAX, `Use at most ${PASSWORD_MAX} characters.`);

const DisplayName = z.string().trim().min(1, "Enter a name.").max(80);

export const SignupInput = z.object({
  name: DisplayName,
  email: Email,
  password: Password,
  chainName: z.string().trim().min(1, "Enter your chain's name.").max(80),
  /** True when a visitor who tried the sample chain wants to bring that workspace into the new account. */
  keepWorkspace: z.boolean().default(false),
});
export type SignupInput = z.infer<typeof SignupInput>;

export const SigninInput = z.object({
  email: Email,
  /** Not length-checked: a wrong password is `invalid_credentials`, whatever its length. */
  password: z.string().min(1).max(1024),
});
export type SigninInput = z.infer<typeof SigninInput>;

export const DeleteAccountInput = z.object({ password: z.string().min(1).max(1024) });
export type DeleteAccountInput = z.infer<typeof DeleteAccountInput>;

export const AuthUser = z.object({
  id: z.string().min(1).max(64),
  name: z.string(),
  email: z.string(),
  createdAt: z.string(),
});
export type AuthUser = z.infer<typeof AuthUser>;

export const AuthResult = z.object({
  user: AuthUser,
  workspaceId: z.string(),
  /** True when the visitor's sample workspace was carried into the account (`keepWorkspace`). */
  keptWorkspace: z.boolean(),
});
export type AuthResult = z.infer<typeof AuthResult>;

export const MeResponse = z.object({
  user: AuthUser.nullable(),
  /** The workspace this browser would use: the account's, the visitor's sample, or none yet. Never creates one. */
  workspace: z.object({ id: z.string(), kind: z.enum(["account", "sample"]) }).nullable(),
  /** A signed-out visitor with a live sample workspace: offer "keep my workspace" on the sign-up screen. */
  canKeepWorkspace: z.boolean(),
});
export type MeResponse = z.infer<typeof MeResponse>;

export const OkResponse = z.object({ ok: z.literal(true) });

/** Every code the auth and onboarding routes can answer with (HTTP status in the comment). The message is already user-facing. */
export const AUTH_ERROR_CODES = {
  invalid_input: 400, // a field failed validation: the message names it
  invalid_credentials: 401, // wrong email or password (the same answer for both)
  unauthenticated: 401, // no valid session
  bad_origin: 403, // a state-changing request from another site
  email_taken: 409, // sign-up with an address that already has an account
  not_skippable: 400, // onboarding: this step cannot be skipped
  too_many_attempts: 429, // repeated failures: back-off, `Retry-After` header carries the seconds
  rate_limited: 429, // too many sign-in / sign-up requests from this network or for this address
} as const;
export type AuthErrorCode = keyof typeof AUTH_ERROR_CODES;

// ---- Onboarding

export const ONBOARDING_STEPS = ["basics", "menu", "stores", "voice", "anchors", "tools", "build"] as const;
export const OnboardingStepId = z.enum(ONBOARDING_STEPS);
export type OnboardingStepId = z.infer<typeof OnboardingStepId>;

/** `done`: the data is there. `skipped`: the owner chose to move on (only optional steps). `todo`: neither; `missing` says what is lacking. */
export const OnboardingStepStatus = z.enum(["done", "skipped", "todo"]);

export const OnboardingStep = z.object({
  id: OnboardingStepId,
  title: z.string(),
  optional: z.boolean(),
  status: OnboardingStepStatus,
  /** Plain-language gaps, empty when done or skipped. */
  missing: z.array(z.string()),
  /** Steps that must be finished before this one can run (only `build`). */
  blockedBy: z.array(OnboardingStepId),
});
export type OnboardingStep = z.infer<typeof OnboardingStep>;

export const OnboardingState = z.object({
  steps: z.array(OnboardingStep),
  /** The step to show next: the saved pointer if it is still open, else the first open step; null when complete. */
  current: OnboardingStepId.nullable(),
  /** Every step is done or skipped. */
  complete: z.boolean(),
  updatedAt: z.string().nullable(),
});
export type OnboardingState = z.infer<typeof OnboardingState>;

export const OnboardingBasics = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  category: ChainCategory.optional(),
  city: z.object({ name: z.string().trim().min(1).max(80), lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) }).optional(),
});

export const OnboardingUpdate = z
  .object({
    /** Chain basics. Saving them (even unchanged) confirms the step. */
    basics: OnboardingBasics.optional(),
    skip: z.array(OnboardingStepId).max(ONBOARDING_STEPS.length).optional(),
    unskip: z.array(OnboardingStepId).max(ONBOARDING_STEPS.length).optional(),
    /** Remember which step the owner is on. */
    current: OnboardingStepId.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Send at least one of basics, skip, unskip or current." });
export type OnboardingUpdate = z.infer<typeof OnboardingUpdate>;

/** Steps the owner may skip. Everything else is needed before the first edition can be built. */
export const SKIPPABLE_STEPS: readonly OnboardingStepId[] = ["voice", "tools"];

// ---- Route table (not part of `routes`: these are cookie routes the typed client reaches through `call`)

export const authRoutes = {
  signup: { method: "POST", path: "/api/auth/signup", stream: "E", bodyKind: "json", sse: false, request: z.object({ body: SignupInput }), response: AuthResult },
  signin: { method: "POST", path: "/api/auth/signin", stream: "E", bodyKind: "json", sse: false, request: z.object({ body: SigninInput }), response: AuthResult },
  signout: { method: "POST", path: "/api/auth/signout", stream: "E", bodyKind: "none", sse: false, request: z.object({}), response: OkResponse },
  me: { method: "GET", path: "/api/auth/me", stream: "E", bodyKind: "none", sse: false, request: z.object({}), response: MeResponse },
  deleteAccount: { method: "DELETE", path: "/api/account", stream: "E", bodyKind: "json", sse: false, request: z.object({ body: DeleteAccountInput }), response: OkResponse },
  getOnboarding: { method: "GET", path: "/api/onboarding", stream: "E", bodyKind: "none", sse: false, request: z.object({}), response: OnboardingState },
  putOnboarding: { method: "PUT", path: "/api/onboarding", stream: "E", bodyKind: "json", sse: false, request: z.object({ body: OnboardingUpdate }), response: OnboardingState },
} as const satisfies Record<string, RouteSpec>;
