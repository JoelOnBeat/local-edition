import { describe, expect, it } from "vitest";
import { decryptToken, encryptToken, safeEqual, signState, verifyState } from "./crypto";

const KEY = "test-encryption-key-0123456789abcdef";

describe("token sealing", () => {
  it("round-trips and never stores the token in clear", async () => {
    const sealed = await encryptToken("xoxb-secret-token", KEY, "ws_a");
    expect(sealed.startsWith("v1.")).toBe(true);
    expect(sealed).not.toContain("xoxb");
    expect(await decryptToken(sealed, KEY, "ws_a")).toBe("xoxb-secret-token");
  });

  it("produces a different ciphertext each time", async () => {
    expect(await encryptToken("same", KEY, "ws_a")).not.toBe(await encryptToken("same", KEY, "ws_a"));
  });

  it("refuses to open a row copied to another workspace, or with another key", async () => {
    const sealed = await encryptToken("xoxb-secret-token", KEY, "ws_a");
    await expect(decryptToken(sealed, KEY, "ws_b")).rejects.toThrow();
    await expect(decryptToken(sealed, "another-key", "ws_a")).rejects.toThrow();
    await expect(decryptToken("garbage", KEY, "ws_a")).rejects.toThrow();
  });
});

describe("signed state", () => {
  const exp = Date.now() + 60_000;
  it("verifies its own state and rejects tampering, another secret and expiry", async () => {
    const state = await signState({ w: "ws_a", exp }, KEY);
    expect(await verifyState<{ w: string }>(state, KEY)).toMatchObject({ w: "ws_a" });
    const [body, sig] = state.split(".");
    const forged = `${btoa(JSON.stringify({ w: "ws_b", exp })).replace(/=+$/, "")}.${sig}`;
    expect(await verifyState(forged, KEY)).toBeNull();
    expect(await verifyState(`${body}.AAAA`, KEY)).toBeNull();
    expect(await verifyState(state, "other-secret")).toBeNull();
    expect(await verifyState(state, KEY, exp + 1)).toBeNull();
    expect(await verifyState("nodots", KEY)).toBeNull();
  });
});

describe("safeEqual", () => {
  it("compares whole strings, including different lengths", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
    expect(safeEqual("", "")).toBe(true);
  });
});
