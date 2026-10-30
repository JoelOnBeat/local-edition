/**
 * Password hashing: PBKDF2-SHA256 through Web Crypto (Workers and Node), a 16-byte random salt per user, a 32-byte output.
 * Stored as `pbkdf2-sha256$<iterations>$<salt b64u>$<hash b64u>` so the cost can be raised later and old hashes still verify.
 *
 * Cost: Workers' Web Crypto refuses more than 100,000 PBKDF2 iterations, so 100,000 is both the ceiling and the setting. Measured
 * on Node (OpenSSL) it takes about 12 ms; native crypto on Workers is in the same range. That is one hash per sign-in or sign-up
 * and it needs the paid Workers CPU limit, not the 10 ms free one. A hash that was made with fewer iterations is re-hashed on the
 * next successful sign-in (`needsRehash`).
 */

export const MAX_WORKERS_ITERATIONS = 100_000;
const SALT_BYTES = 16;
const HASH_BYTES = 32;
const SCHEME = "pbkdf2-sha256";

let iterations = MAX_WORKERS_ITERATIONS;
/** Tests lower the cost so a suite of sign-ins stays fast. Values above the Workers ceiling are clamped. */
export function setPasswordIterations(n: number | undefined): void {
  iterations = Math.min(MAX_WORKERS_ITERATIONS, Math.max(1, Math.trunc(n ?? MAX_WORKERS_ITERATIONS)));
}
export const passwordIterations = (): number => iterations;

export const b64u = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export const unb64u = (s: string): Uint8Array => {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
};

async function derive(password: string, salt: Uint8Array, rounds: number): Promise<Uint8Array> {
  // NFKC so the same typed password hashes the same whatever the keyboard or OS composed it with.
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password.normalize("NFKC")), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations: rounds }, key, HASH_BYTES * 8);
  return new Uint8Array(bits);
}

/** Compares two byte strings without stopping at the first difference. Different lengths are simply unequal. */
export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  let diff = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await derive(password, salt, iterations);
  return `${SCHEME}$${iterations}$${b64u(salt)}$${b64u(hash)}`;
}

export interface Verification {
  ok: boolean;
  /** The password is right but the stored hash is weaker than today's setting: store a fresh hash. */
  needsRehash: boolean;
}

/** A malformed or tampered record verifies as false (never throws), after the same work as a good one. */
export async function verifyPassword(password: string, stored: string): Promise<Verification> {
  const [scheme, rounds, salt, hash] = stored.split("$");
  const n = Number(rounds);
  if (scheme !== SCHEME || !salt || !hash || !Number.isInteger(n) || n < 1 || n > MAX_WORKERS_ITERATIONS) {
    await derive(password, new Uint8Array(SALT_BYTES), iterations);
    return { ok: false, needsRehash: false };
  }
  let expected: Uint8Array;
  let saltBytes: Uint8Array;
  try {
    expected = unb64u(hash);
    saltBytes = unb64u(salt);
  } catch {
    await derive(password, new Uint8Array(SALT_BYTES), iterations);
    return { ok: false, needsRehash: false };
  }
  const actual = await derive(password, saltBytes, n);
  const ok = constantTimeEqual(actual, expected);
  return { ok, needsRehash: ok && n < iterations };
}

let dummy: Promise<string> | undefined;
/**
 * Spends the time of a real check when the email has no account, so a sign-in does not reveal which addresses exist by how long it
 * takes. The answer is always false.
 */
export async function verifyAgainstDummy(password: string): Promise<void> {
  dummy ??= hashPassword("not-a-real-password-" + b64u(crypto.getRandomValues(new Uint8Array(8))));
  await verifyPassword(password, await dummy);
}
