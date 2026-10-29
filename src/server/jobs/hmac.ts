/** HMAC-SHA256 request signing for /api/jobs/monday. Web Crypto only, so it runs on Workers. */

const encoder = new TextEncoder();

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function fromHex(text: string): Uint8Array<ArrayBuffer> | null {
  if (text.length === 0 || text.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(text)) return null;
  const out = new Uint8Array(new ArrayBuffer(text.length / 2));
  for (let i = 0; i < out.length; i++) out[i] = parseInt(text.slice(i * 2, i * 2 + 2), 16);
  return out;
}

async function key(secret: string, usage: "sign" | "verify"): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [usage]);
}

/** A string is signed as its UTF-8 bytes; bytes are signed as they are (what a server receives). */
export type SignedBody = string | Uint8Array;
const bytesOf = (body: SignedBody): BufferSource => (typeof body === "string" ? encoder.encode(body) : (body as Uint8Array<ArrayBuffer>));

/** Hex signature of `body`, as the job script sends it in `x-le-signature`. */
export async function signBody(secret: string, body: SignedBody): Promise<string> {
  return hex(await crypto.subtle.sign("HMAC", await key(secret, "sign"), bytesOf(body)));
}

/** Hex sha256 of the (normalised) signature: the replay-cache key. The signature itself is never stored. */
export async function signatureDigest(signature: string): Promise<string> {
  const normal = signature.trim().replace(/^sha256=/i, "").toLowerCase();
  return hex(await crypto.subtle.digest("SHA-256", encoder.encode(normal)));
}

/**
 * Constant-time check (`subtle.verify` compares MACs in constant time). Accepts hex, optionally
 * prefixed `sha256=`. Malformed input is simply false.
 */
export async function verifySignature(secret: string, body: SignedBody, signature: string): Promise<boolean> {
  const sig = fromHex(signature.trim().replace(/^sha256=/i, ""));
  if (!sig || sig.length !== 32) return false;
  return crypto.subtle.verify("HMAC", await key(secret, "verify"), sig, bytesOf(body));
}
