import { HttpError } from "../http/errors";

/**
 * Tokens at rest. AES-256-GCM through Web Crypto (Workers and Node). The key is the Worker secret SQUARE_TOKEN_KEY: 32 random
 * bytes, base64. The workspace id is bound in as additional data, so a ciphertext copied to another workspace's row will not open.
 * Format: `v1.<iv>.<ciphertext+tag>`, both base64url.
 */

const b64u = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = (s: string): Uint8Array => {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
};

async function importKey(rawKey: string | undefined): Promise<CryptoKey> {
  let bytes: Uint8Array = new Uint8Array(0);
  try {
    if (rawKey) bytes = unb64u(rawKey.trim());
  } catch {
    // not base64: treated as no key
  }
  if (bytes.length !== 32) throw new HttpError(503, "config_error", "Token encryption is not configured on the server.");
  return crypto.subtle.importKey("raw", bytes as BufferSource, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptToken(plain: string, workspaceId: string, rawKey: string | undefined): Promise<string> {
  const key = await importKey(rawKey);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: new TextEncoder().encode(workspaceId) }, key, new TextEncoder().encode(plain));
  return `v1.${b64u(iv)}.${b64u(new Uint8Array(data))}`;
}

export async function decryptToken(sealed: string, workspaceId: string, rawKey: string | undefined): Promise<string> {
  const [version, iv, data] = sealed.split(".");
  if (version !== "v1" || !iv || !data) throw new HttpError(500, "token_unreadable", "A stored connection token could not be read. Reconnect the tool.");
  const key = await importKey(rawKey);
  try {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: unb64u(iv) as BufferSource, additionalData: new TextEncoder().encode(workspaceId) },
      key,
      unb64u(data) as BufferSource,
    );
    return new TextDecoder().decode(plain);
  } catch {
    throw new HttpError(500, "token_unreadable", "A stored connection token could not be read. Reconnect the tool.");
  }
}

/** A fresh URL-safe secret of `bytes` random bytes (calendar tokens, OAuth state). */
export function randomToken(bytes = 24): string {
  return b64u(crypto.getRandomValues(new Uint8Array(bytes)));
}
