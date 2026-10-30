import { afterEach, describe, expect, it } from "vitest";
import { MAX_WORKERS_ITERATIONS, constantTimeEqual, hashPassword, passwordIterations, setPasswordIterations, verifyPassword } from "@/server/auth/password";

afterEach(() => setPasswordIterations(undefined));

describe("password hashing (PBKDF2-SHA256, Web Crypto)", () => {
  it("stores scheme, iterations, salt and hash, and never the password", async () => {
    setPasswordIterations(2000);
    const stored = await hashPassword("correct horse battery staple");
    const [scheme, rounds, salt, hash] = stored.split("$");
    expect([scheme, rounds]).toEqual(["pbkdf2-sha256", "2000"]);
    expect(salt.length).toBeGreaterThanOrEqual(21); // 16 bytes, base64url
    expect(hash.length).toBeGreaterThanOrEqual(42); // 32 bytes
    expect(stored).not.toContain("correct");
  });

  it("uses a different salt for every hash, so equal passwords never look equal", async () => {
    setPasswordIterations(1000);
    const [a, b] = await Promise.all([hashPassword("same password here"), hashPassword("same password here")]);
    expect(a).not.toBe(b);
    expect((await verifyPassword("same password here", a)).ok).toBe(true);
    expect((await verifyPassword("same password here", b)).ok).toBe(true);
  });

  it("verifies the right password and refuses a wrong, empty or near-miss one", async () => {
    setPasswordIterations(1000);
    const stored = await hashPassword("Tr0ub4dor&3 correct");
    expect((await verifyPassword("Tr0ub4dor&3 correct", stored)).ok).toBe(true);
    for (const wrong of ["", "tr0ub4dor&3 correct", "Tr0ub4dor&3 correc", "Tr0ub4dor&3 correct "]) {
      expect((await verifyPassword(wrong, stored)).ok).toBe(false);
    }
  });

  it("treats the same text composed two ways as one password (NFKC)", async () => {
    setPasswordIterations(1000);
    const stored = await hashPassword("café au lait 2026");
    expect((await verifyPassword("café au lait 2026", stored)).ok).toBe(true);
  });

  it("never throws on a damaged record: it is simply not a match", async () => {
    setPasswordIterations(1000);
    for (const bad of ["", "plaintext", "pbkdf2-sha256$abc$x$y", "pbkdf2-sha256$1000$$", "md5$1000$aa$bb", `pbkdf2-sha256$${MAX_WORKERS_ITERATIONS + 1}$aa$bb`, "pbkdf2-sha256$0$aa$bb", "pbkdf2-sha256$1000$***$***"]) {
      expect((await verifyPassword("anything at all", bad)).ok).toBe(false);
    }
  });

  it("caps the cost at the Workers Web Crypto ceiling and asks for a re-hash of older hashes", async () => {
    setPasswordIterations(5_000_000);
    expect(passwordIterations()).toBe(MAX_WORKERS_ITERATIONS);
    setPasswordIterations(1000);
    const old = await hashPassword("a password to upgrade");
    setPasswordIterations(2000);
    expect(await verifyPassword("a password to upgrade", old)).toEqual({ ok: true, needsRehash: true });
    expect((await verifyPassword("wrong password entirely", old)).needsRehash).toBe(false);
  });

  it("compares bytes without stopping at the first difference", () => {
    const a = new Uint8Array([1, 2, 3, 4]);
    expect(constantTimeEqual(a, new Uint8Array([1, 2, 3, 4]))).toBe(true);
    expect(constantTimeEqual(a, new Uint8Array([1, 2, 3, 5]))).toBe(false);
    expect(constantTimeEqual(a, new Uint8Array([9, 2, 3, 4]))).toBe(false);
    expect(constantTimeEqual(a, new Uint8Array([1, 2, 3]))).toBe(false);
    expect(constantTimeEqual(new Uint8Array(), new Uint8Array())).toBe(true);
  });

  it("hashes at the production cost within a Workers-sized budget", async () => {
    setPasswordIterations(undefined);
    const started = performance.now();
    const stored = await hashPassword("measured at full cost");
    const ms = performance.now() - started;
    expect(stored.startsWith(`pbkdf2-sha256$${MAX_WORKERS_ITERATIONS}$`)).toBe(true);
    expect(ms).toBeLessThan(250); // about 12 ms on a laptop; the bound only catches an accidental order-of-magnitude slowdown
  });
});
