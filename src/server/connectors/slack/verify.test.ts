import { describe, expect, it } from "vitest";
import { hmacHex } from "../comms/crypto";
import { verifySlackSignature } from "./verify";

const SECRET = "8f742231b10e8888abcd99yyyzzz85a5";
const NOW = 1_761_436_500;
const body = "payload=%7B%22type%22%3A%22block_actions%22%7D";

async function sign(raw: string, ts: number, secret = SECRET): Promise<string> {
  return `v0=${await hmacHex(secret, `v0:${ts}:${raw}`)}`;
}

describe("Slack request signature", () => {
  it("accepts a request signed with the signing secret", async () => {
    const v = await verifySlackSignature({ rawBody: body, signature: await sign(body, NOW), timestamp: String(NOW), signingSecret: SECRET, nowSeconds: NOW + 5 });
    expect(v).toEqual({ ok: true });
  });

  it("rejects a tampered body", async () => {
    const v = await verifySlackSignature({ rawBody: body + "x", signature: await sign(body, NOW), timestamp: String(NOW), signingSecret: SECRET, nowSeconds: NOW });
    expect(v).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rejects a signature made with another secret", async () => {
    const v = await verifySlackSignature({ rawBody: body, signature: await sign(body, NOW, "someone-elses-secret"), timestamp: String(NOW), signingSecret: SECRET, nowSeconds: NOW });
    expect(v.ok).toBe(false);
  });

  it("rejects a request older than five minutes, even when the signature is right", async () => {
    const old = NOW - 301;
    const v = await verifySlackSignature({ rawBody: body, signature: await sign(body, old), timestamp: String(old), signingSecret: SECRET, nowSeconds: NOW });
    expect(v).toEqual({ ok: false, reason: "stale" });
  });

  it("accepts exactly five minutes old and rejects a timestamp from the future", async () => {
    const edge = NOW - 300;
    expect((await verifySlackSignature({ rawBody: body, signature: await sign(body, edge), timestamp: String(edge), signingSecret: SECRET, nowSeconds: NOW })).ok).toBe(true);
    const future = NOW + 600;
    expect((await verifySlackSignature({ rawBody: body, signature: await sign(body, future), timestamp: String(future), signingSecret: SECRET, nowSeconds: NOW })).ok).toBe(false);
  });

  it("rejects a replayed signature with a fresh timestamp", async () => {
    const v = await verifySlackSignature({ rawBody: body, signature: await sign(body, NOW - 1000), timestamp: String(NOW), signingSecret: SECRET, nowSeconds: NOW });
    expect(v).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("reports missing headers, a malformed timestamp and a missing secret", async () => {
    expect(await verifySlackSignature({ rawBody: body, signature: null, timestamp: String(NOW), signingSecret: SECRET, nowSeconds: NOW })).toEqual({ ok: false, reason: "missing_headers" });
    expect(await verifySlackSignature({ rawBody: body, signature: "v0=abc", timestamp: "yesterday", signingSecret: SECRET, nowSeconds: NOW })).toEqual({ ok: false, reason: "missing_headers" });
    expect(await verifySlackSignature({ rawBody: body, signature: "v0=abc", timestamp: String(NOW), signingSecret: undefined, nowSeconds: NOW })).toEqual({ ok: false, reason: "no_secret" });
  });

  it("rejects a signature of the wrong length without throwing", async () => {
    const v = await verifySlackSignature({ rawBody: body, signature: "v0=short", timestamp: String(NOW), signingSecret: SECRET, nowSeconds: NOW });
    expect(v).toEqual({ ok: false, reason: "bad_signature" });
  });
});
