import { CODE_LENGTH } from "@/contract";
import { constantTimeEqual } from "./password";
import { sha256Hex } from "./sessions";

/** One-time codes: six digits from the system random source, stored only as a hash bound to the address. */

export const MAX_CODE_ATTEMPTS = 5;

export function newCode(): string {
  const limit = 10 ** CODE_LENGTH;
  const ceiling = Math.floor(2 ** 32 / limit) * limit; // reject the biased tail so every code is equally likely
  const buf = new Uint32Array(1);
  do crypto.getRandomValues(buf);
  while (buf[0] >= ceiling);
  return String(buf[0] % limit).padStart(CODE_LENGTH, "0");
}

export const hashCode = (email: string, code: string): Promise<string> => sha256Hex(`login-code\u0000${email}\u0000${code}`);

export async function codeMatches(email: string, code: string, storedHash: string): Promise<boolean> {
  const enc = new TextEncoder();
  return constantTimeEqual(enc.encode(await hashCode(email, code)), enc.encode(storedHash));
}
