import { describe, expect, it } from "vitest";
import { decryptToken, encryptToken, randomToken } from "./crypto";

const KEY = Buffer.from(new Uint8Array(32).map((_, i) => i + 3)).toString("base64");

describe("token encryption at rest", () => {
  it("round-trips, never contains the plaintext, and differs on every call", async () => {
    const a = await encryptToken("EAAAEOxampleToken", "ws_1", KEY);
    expect(a).toMatch(/^v1\.[\w-]+\.[\w-]+$/);
    expect(a).not.toContain("EAAAEOxample");
    expect(await encryptToken("EAAAEOxampleToken", "ws_1", KEY)).not.toBe(a);
    expect(await decryptToken(a, "ws_1", KEY)).toBe("EAAAEOxampleToken");
  });
  it("will not open in another workspace, with another key, or after tampering", async () => {
    const sealed = await encryptToken("secret", "ws_1", KEY);
    await expect(decryptToken(sealed, "ws_2", KEY)).rejects.toMatchObject({ code: "token_unreadable" });
    const other = Buffer.from(new Uint8Array(32).fill(9)).toString("base64");
    await expect(decryptToken(sealed, "ws_1", other)).rejects.toMatchObject({ code: "token_unreadable" });
    const parts = sealed.split(".");
    const flipped = `${parts[0]}.${parts[1]}.${parts[2].slice(0, -2)}${parts[2].endsWith("AA") ? "BB" : "AA"}`;
    await expect(decryptToken(flipped, "ws_1", KEY)).rejects.toMatchObject({ code: "token_unreadable" });
    await expect(decryptToken("garbage", "ws_1", KEY)).rejects.toMatchObject({ code: "token_unreadable" });
  });
  it("refuses to run without a 32-byte key", async () => {
    for (const bad of [undefined, "", "short", "!!!not base64!!!"]) {
      await expect(encryptToken("x", "ws_1", bad)).rejects.toMatchObject({ status: 503, code: "config_error" });
    }
  });
  it("mints distinct URL-safe random tokens", () => {
    const set = new Set(Array.from({ length: 50 }, () => randomToken(24)));
    expect(set.size).toBe(50);
    expect([...set].every((t) => /^[A-Za-z0-9_-]{32}$/.test(t))).toBe(true);
  });
});
