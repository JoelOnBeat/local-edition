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

/** What a job request's MAC covers besides the body: protocol tag, header timestamp, HTTP method, path and the job name. */
export interface RequestScope {
  method: string;
  /** URL path without query or host, e.g. `/api/jobs/results`. */
  path: string;
  /** Epoch seconds from `x-le-timestamp`; empty for scheme 1, where `ts` is inside the signed body. */
  ts?: string;
  /** The job's name (`x-le-job-id`); empty for a request signed with the shared secret by an operator. */
  jobId?: string;
}

/**
 * The exact bytes a signature covers: `le2\n<ts>\n<METHOD>\n<path>\n<jobId>\n` then the body. Signing the method and
 * path means a MAC captured on one endpoint is useless on another; the job name binds a derived per-job secret to its job.
 */
export function signedBytes(scope: RequestScope, body: SignedBody): Uint8Array<ArrayBuffer> {
  const head = encoder.encode(`le2\n${scope.ts ?? ""}\n${scope.method.toUpperCase()}\n${scope.path}\n${scope.jobId ?? ""}\n`);
  const payload = typeof body === "string" ? encoder.encode(body) : body;
  const out = new Uint8Array(new ArrayBuffer(head.length + payload.length));
  out.set(head, 0);
  out.set(payload, head.length);
  return out;
}

/** Hex signature of a whole request, as `jobs/le_http.py` computes it. */
export function signRequest(secret: string, scope: RequestScope, body: SignedBody = ""): Promise<string> {
  return signBody(secret, signedBytes(scope, body));
}

/** The per-job secret: hex HMAC-SHA256 of the job's name keyed by the shared `LE_JOB_SECRET`. Only this goes into the Nebius job. */
export function deriveJobSecret(masterSecret: string, jobName: string): Promise<string> {
  return signBody(masterSecret, jobName);
}
