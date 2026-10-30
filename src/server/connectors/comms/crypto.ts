/** Web Crypto helpers for signatures, encrypted tokens and signed OAuth state. Workers-safe: no node:crypto. */

const enc = new TextEncoder();
const dec = new TextDecoder();

export const toHex = (bytes: ArrayBuffer | Uint8Array): string =>
  [...(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");

export function toB64(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const b of arr) s += String.fromCharCode(b);
  return btoa(s);
}

export function fromB64(text: string): Uint8Array {
  const s = atob(text);
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

const b64url = (text: string): string => text.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64url = (text: string): string => text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4);

async function hmacBytes(secret: string, message: string): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", key, enc.encode(message));
}

export const hmacHex = async (secret: string, message: string): Promise<string> => toHex(await hmacBytes(secret, message));
export const hmacBase64 = async (secret: string, message: string): Promise<string> => toB64(await hmacBytes(secret, message));

/** Constant-time string comparison: always walks the longer string, folds the length difference into the result. */
export function safeEqual(a: string, b: string): boolean {
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

async function aesKey(encKey: string, workspaceId: string): Promise<CryptoKey> {
  const material = await crypto.subtle.digest("SHA-256", enc.encode(`local-edition/comms/v1|${workspaceId}|${encKey}`));
  return crypto.subtle.importKey("raw", material, "AES-GCM", false, ["encrypt", "decrypt"]);
}

/** AES-256-GCM with a per-workspace key and the workspace id as associated data: a row copied to another workspace will not decrypt. */
export async function encryptToken(plain: string, encKey: string, workspaceId: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(workspaceId) }, await aesKey(encKey, workspaceId), enc.encode(plain));
  return `v1.${toB64(iv)}.${toB64(ct)}`;
}

export async function decryptToken(sealed: string, encKey: string, workspaceId: string): Promise<string> {
  const [v, iv, ct] = sealed.split(".");
  if (v !== "v1" || !iv || !ct) throw new Error("unsupported sealed token");
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromB64(iv) as BufferSource, additionalData: enc.encode(workspaceId) },
    await aesKey(encKey, workspaceId),
    fromB64(ct) as BufferSource,
  );
  return dec.decode(plain);
}

/** `<payload>.<sig>`: payload is JSON, signed with HMAC-SHA256. Used for OAuth `state`, which must survive a round trip through a third party. */
export async function signState(payload: Record<string, unknown>, secret: string): Promise<string> {
  const body = b64url(btoa(String.fromCharCode(...enc.encode(JSON.stringify(payload)))));
  return `${body}.${b64url(await hmacBase64(secret, body))}`;
}

export async function verifyState<T extends Record<string, unknown>>(state: string, secret: string, now = Date.now()): Promise<T | null> {
  const [body, sig] = state.split(".");
  if (!body || !sig) return null;
  if (!safeEqual(b64url(await hmacBase64(secret, body)), sig)) return null;
  try {
    const parsed = JSON.parse(dec.decode(Uint8Array.from(atob(unb64url(body)), (c) => c.charCodeAt(0)))) as T & { exp?: number };
    if (typeof parsed.exp !== "number" || parsed.exp < now) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Hex SHA-256 of a string. */
export async function sha256Hex(text: string): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", enc.encode(text)));
}
