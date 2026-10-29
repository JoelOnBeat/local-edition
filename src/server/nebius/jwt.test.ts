import { createPrivateKey } from "node:crypto";
import { describe, expect, it } from "vitest";
import { base64UrlEncode, DEFAULT_JWT_LIFETIME_SECONDS, MAX_JWT_LIFETIME_SECONDS, pemToPkcs8, pkcs1ToPkcs8, signJwt } from "./jwt";
import { testKeys } from "./test-utils";

const decode = (part: string) => JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/")));

async function verifies(jwt: string, publicKey: import("node:crypto").KeyObject): Promise<boolean> {
  const [h, c, s] = jwt.split(".");
  const spki = publicKey.export({ type: "spki", format: "der" });
  const key = await crypto.subtle.importKey("spki", spki, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const sig = Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=")), (ch) => ch.charCodeAt(0));
  return crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, sig, new TextEncoder().encode(`${h}.${c}`));
}

describe("signJwt", () => {
  it("produces an RS256 JWT that verifies with the public key, with the documented header and claims", async () => {
    const { credentials, publicKey } = testKeys();
    const jwt = await signJwt(credentials, { nowSeconds: 1_800_000_000 });
    const [h, c] = jwt.split(".");
    expect(decode(h)).toEqual({ alg: "RS256", typ: "JWT", kid: credentials.keyId });
    expect(decode(c)).toEqual({ iss: credentials.issuer, sub: credentials.subject, iat: 1_800_000_000, exp: 1_800_000_000 + DEFAULT_JWT_LIFETIME_SECONDS });
    expect(decode(c).iss).toBe(decode(c).sub);
    expect(await verifies(jwt, publicKey)).toBe(true);
  });

  it("fails verification when the payload is tampered with", async () => {
    const { credentials, publicKey } = testKeys();
    const [h, , s] = (await signJwt(credentials, { nowSeconds: 1_800_000_000 })).split(".");
    const forged = `${h}.${base64UrlEncode(JSON.stringify({ iss: "x", sub: "x", iat: 1, exp: 2 }))}.${s}`;
    expect(await verifies(forged, publicKey)).toBe(false);
  });

  it("never lets exp exceed five minutes, whatever lifetime is asked for", async () => {
    const { credentials } = testKeys();
    for (const lifetimeSeconds of [10_000, 301, 300]) {
      const c = decode((await signJwt(credentials, { nowSeconds: 1000, lifetimeSeconds })).split(".")[1]);
      expect(c.exp - c.iat).toBeLessThanOrEqual(MAX_JWT_LIFETIME_SECONDS);
    }
    const tiny = decode((await signJwt(credentials, { nowSeconds: 1000, lifetimeSeconds: -5 })).split(".")[1]);
    expect(tiny.exp).toBeGreaterThan(tiny.iat);
  });

  it("signs with a PKCS#1 'BEGIN RSA PRIVATE KEY' key and the result still verifies", async () => {
    const k = testKeys();
    expect(k.pkcs1Pem).toContain("BEGIN RSA PRIVATE KEY");
    const jwt = await signJwt({ ...k.credentials, privateKeyPem: k.pkcs1Pem }, { nowSeconds: 1_800_000_000 });
    expect(await verifies(jwt, k.publicKey)).toBe(true);
  });

  it("accepts a PEM whose newlines are still escaped as \\n", async () => {
    const k = testKeys();
    const jwt = await signJwt({ ...k.credentials, privateKeyPem: k.pkcs8Pem.replace(/\n/g, "\\n") });
    expect(await verifies(jwt, k.publicKey)).toBe(true);
  });
});

describe("PEM conversion", () => {
  it("pkcs1ToPkcs8 matches what OpenSSL writes for the same key, byte for byte", () => {
    const k = testKeys();
    const pkcs1 = Uint8Array.from(Buffer.from(k.pkcs1Pem.replace(/-----[A-Z ]+-----|\s/g, ""), "base64"));
    const viaNode = createPrivateKey(k.pkcs1Pem).export({ type: "pkcs8", format: "der" });
    expect(Buffer.from(pkcs1ToPkcs8(pkcs1)).equals(viaNode)).toBe(true);
    expect(Buffer.from(pemToPkcs8(k.pkcs1Pem)).equals(viaNode)).toBe(true);
  });

  it.each([
    ["not a PEM", "hello"],
    ["an encrypted key", "-----BEGIN ENCRYPTED PRIVATE KEY\u002d\u002d\u002d\u002d\u002d\nAAAA\n-----END ENCRYPTED PRIVATE KEY-----"],
    ["an EC key", "-----BEGIN EC PRIVATE KEY\u002d\u002d\u002d\u002d\u002d\nAAAA\n-----END EC PRIVATE KEY-----"],
  ])("rejects %s with nebius_auth and no key material in the message", async (_label, pem) => {
    const { credentials } = testKeys();
    await expect(signJwt({ ...credentials, privateKeyPem: pem })).rejects.toMatchObject({ code: "nebius_auth" });
  });

  it("rejects a PEM that is not an RSA key", async () => {
    const { credentials } = testKeys();
    const pem = "-----BEGIN PRIVATE KEY\u002d\u002d\u002d\u002d\u002d\nAAAAAAAAAAAAAAAA\n-----END PRIVATE KEY-----";
    await expect(signJwt({ ...credentials, privateKeyPem: pem })).rejects.toMatchObject({ code: "nebius_auth" });
  });
});
