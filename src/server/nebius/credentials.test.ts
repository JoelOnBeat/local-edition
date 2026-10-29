import { describe, expect, it } from "vitest";
import { parseCredentials } from "./credentials";
import { NebiusError } from "./errors";
import { testKeys } from "./test-utils";

describe("parseCredentials", () => {
  it("reads the subject-credentials block of the service-account file", () => {
    const k = testKeys();
    const c = parseCredentials(k.credentialsFileJson);
    expect(c).toEqual({ keyId: k.credentials.keyId, issuer: k.credentials.issuer, subject: k.credentials.subject, privateKeyPem: k.pkcs8Pem });
  });

  it.each([undefined, "", "   "])("rejects a missing secret (%j) with nebius_auth", (raw) => {
    expect(() => parseCredentials(raw)).toThrowError(expect.objectContaining({ code: "nebius_auth" }));
  });

  it("rejects non-JSON without echoing it", () => {
    try {
      parseCredentials("this is not json -----BEGIN PRIVATE KEY\u002d\u002d\u002d\u002d\u002d");
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(NebiusError);
      expect((e as NebiusError).message).not.toContain("BEGIN");
    }
  });

  it("names the invalid fields, never their values", () => {
    const k = testKeys();
    const bad = JSON.stringify({ "subject-credentials": { alg: "HS256", "private-key": k.pkcs8Pem, iss: k.credentials.issuer, sub: "" } });
    try {
      parseCredentials(bad);
      expect.unreachable();
    } catch (e) {
      const msg = (e as NebiusError).message;
      expect((e as NebiusError).code).toBe("nebius_auth");
      expect(msg).toMatch(/alg/);
      expect(msg).toMatch(/kid/);
      expect(msg).not.toContain("BEGIN");
      expect(msg).not.toContain("HS256");
    }
  });
});
