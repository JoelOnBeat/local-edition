import type { NebiusCredentials } from "./credentials";
import { NebiusError } from "./errors";

/** Web APIs only (crypto.subtle, TextEncoder, atob/btoa): runs in workerd, Node 20+ and browsers. */

const encoder = new TextEncoder();

/** Nebius: "The JWT is based on RS256 and expires five minutes after its creation." Hard ceiling, in seconds. */
export const MAX_JWT_LIFETIME_SECONDS = 300;
/** Default lifetime: 4 minutes leaves a minute of margin for clock skew against Nebius. */
export const DEFAULT_JWT_LIFETIME_SECONDS = 240;

export function base64UrlEncode(input: Uint8Array | string): string {
  const bytes = typeof input === "string" ? encoder.encode(input) : input;
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64Decode(b64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function derLength(n: number): number[] {
  if (n < 0x80) return [n];
  const bytes: number[] = [];
  for (let v = n; v > 0; v = Math.floor(v / 256)) bytes.unshift(v & 0xff);
  return [0x80 | bytes.length, ...bytes];
}

function derWrap(tag: number, content: Uint8Array): Uint8Array<ArrayBuffer> {
  const head = [tag, ...derLength(content.length)];
  const out = new Uint8Array(head.length + content.length);
  out.set(head, 0);
  out.set(content, head.length);
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** AlgorithmIdentifier { rsaEncryption (1.2.840.113549.1.1.1), NULL }. */
const RSA_ALGORITHM_IDENTIFIER = Uint8Array.from([0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00]);

/**
 * Wraps a PKCS#1 RSAPrivateKey (`BEGIN RSA PRIVATE KEY`, what `openssl genrsa` wrote before OpenSSL 3)
 * into a PKCS#8 PrivateKeyInfo, the only private format WebCrypto imports:
 *   SEQUENCE { INTEGER 0, AlgorithmIdentifier, OCTET STRING { pkcs1 } }
 */
export function pkcs1ToPkcs8(pkcs1: Uint8Array): Uint8Array<ArrayBuffer> {
  const version = Uint8Array.from([0x02, 0x01, 0x00]);
  return derWrap(0x30, concat(version, RSA_ALGORITHM_IDENTIFIER, derWrap(0x04, pkcs1)));
}

/** Returns PKCS#8 DER bytes from a PEM in either PKCS#8 or PKCS#1 form. Never echoes key material in errors. */
export function pemToPkcs8(pem: string): Uint8Array<ArrayBuffer> {
  const normalized = pem.replace(/\\n/g, "\n"); // tolerate a secret whose newlines stayed escaped
  const match = /-----BEGIN ([A-Z ]+)-----([\s\S]*?)-----END \1-----/.exec(normalized);
  if (!match) throw new NebiusError("nebius_auth", "The service-account private key is not a PEM block.");
  const label = match[1];
  let der: Uint8Array<ArrayBuffer>;
  try {
    der = base64Decode(match[2].replace(/\s+/g, ""));
  } catch {
    throw new NebiusError("nebius_auth", "The service-account private key PEM body is not valid base64.");
  }
  if (label === "PRIVATE KEY") return der;
  if (label === "RSA PRIVATE KEY") return pkcs1ToPkcs8(der);
  throw new NebiusError("nebius_auth", `Unsupported private key type "${label}": expected PRIVATE KEY (PKCS#8) or RSA PRIVATE KEY (PKCS#1).`);
}

export async function importSigningKey(pem: string): Promise<CryptoKey> {
  const der = pemToPkcs8(pem);
  try {
    return await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  } catch {
    throw new NebiusError("nebius_auth", "The service-account private key could not be imported as an RSA key.");
  }
}

export interface SignJwtOptions {
  /** Unix seconds; injectable for tests. Default: now. */
  nowSeconds?: number;
  /** Seconds until `exp`, clamped to 1..300. Default 240. */
  lifetimeSeconds?: number;
}

/**
 * RS256 JWT for the token exchange:
 *   header { alg: "RS256", typ: "JWT", kid: <authorized key id> }
 *   claims { iss: <service account id>, sub: <service account id>, iat, exp }
 * Nebius requires no `aud`. Mirrors `jwt encode --alg RS256 --kid K --iss SA --sub SA --exp +5min`.
 */
export async function signJwt(credentials: NebiusCredentials, opts: SignJwtOptions = {}): Promise<string> {
  const iat = Math.floor(opts.nowSeconds ?? Date.now() / 1000);
  const lifetime = Math.min(Math.max(Math.floor(opts.lifetimeSeconds ?? DEFAULT_JWT_LIFETIME_SECONDS), 1), MAX_JWT_LIFETIME_SECONDS);
  const header = { alg: "RS256", typ: "JWT", kid: credentials.keyId };
  const claims = { iss: credentials.issuer, sub: credentials.subject, iat, exp: iat + lifetime };
  const signingInput = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(claims))}`;
  const key = await importSigningKey(credentials.privateKeyPem);
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, encoder.encode(signingInput));
  return `${signingInput}.${base64UrlEncode(new Uint8Array(signature))}`;
}
