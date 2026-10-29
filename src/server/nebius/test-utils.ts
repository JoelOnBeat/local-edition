import { generateKeyPairSync, createPublicKey, type KeyObject } from "node:crypto";
import type { NebiusCredentials } from "./credentials";

/** Test helpers: a throwaway RSA key (never a real credential) and a scripted fetch. */
export interface TestKeys {
  credentials: NebiusCredentials;
  credentialsFileJson: string;
  publicKey: KeyObject;
  pkcs8Pem: string;
  pkcs1Pem: string;
}

let cached: TestKeys | undefined;

export function testKeys(): TestKeys {
  if (cached) return cached;
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pkcs8Pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const pkcs1Pem = privateKey.export({ type: "pkcs1", format: "pem" }).toString();
  const credentials: NebiusCredentials = {
    keyId: "publickey-test0000000000",
    issuer: "serviceaccount-test0000000000",
    subject: "serviceaccount-test0000000000",
    privateKeyPem: pkcs8Pem,
  };
  const credentialsFileJson = JSON.stringify({
    "subject-credentials": { type: "JWT", alg: "RS256", "private-key": pkcs8Pem, kid: credentials.keyId, iss: credentials.issuer, sub: credentials.subject },
  });
  cached = { credentials, credentialsFileJson, publicKey: createPublicKey(privateKey), pkcs8Pem, pkcs1Pem };
  return cached;
}

export interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
}

type Reply = { status?: number; body?: unknown; text?: string } | Error;

/** Replies in order; the last reply repeats. Records every call. */
export function scriptedFetch(...replies: Reply[]): { fetchImpl: typeof fetch; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      headers: Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>)),
      body: typeof init?.body === "string" ? init.body : undefined,
    });
    const reply = replies[Math.min(calls.length - 1, replies.length - 1)];
    if (reply instanceof Error) throw reply;
    const text = reply.text ?? JSON.stringify(reply.body ?? {});
    return new Response(text, { status: reply.status ?? 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

export const FAKE_TOKEN = "v1.TESTTOKEN.abcdefghijklmnopqrstuvwxyz0123456789";
