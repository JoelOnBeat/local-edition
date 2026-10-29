import { beforeEach, describe, expect, it } from "vitest";
import { JOB_BODY_MAX_BYTES, SIGNATURE_MAX_AGE_SECONDS, runMondayJob } from "@/server/handlers/jobs";
import { signBody, signatureDigest, verifySignature } from "@/server/jobs/hmac";
import type { BuildEditions } from "@/server/jobs/ports";
import { fakePorts, freshApp, req } from "../e/helpers";

const SECRET = "f1-job-secret-not-real-0123456789abcdef"; // 40 chars
const done: BuildEditions = async function* ({ stores, runId }) {
  yield { type: "run_started", runId, storeIds: stores.map((s) => s.id) };
  yield { type: "run_done", runId, editionIds: [] };
};
const nowSec = () => Math.floor(Date.now() / 1000);

beforeEach(() => {
  freshApp({ LE_JOB_SECRET: SECRET }, fakePorts({ buildEditions: done, background: () => undefined }));
});

async function post(body: unknown, opts: { raw?: string | Uint8Array; secret?: string; signature?: string; headers?: Record<string, string> } = {}) {
  const raw = opts.raw ?? JSON.stringify(body);
  const signature = opts.signature ?? (await signBody(opts.secret ?? SECRET, typeof raw === "string" ? raw : raw));
  return runMondayJob(req("/api/jobs/monday", {
    method: "POST",
    headers: { "content-type": "application/json", "x-le-signature": signature, ...opts.headers },
    body: raw as BodyInit,
  }));
}

describe("M1 job HMAC: ts, window, replay, bytes, size, secret", () => {
  it("accepts a fresh signed request with ts", async () => {
    const res = await post({ trigger: "manual", ts: nowSec() });
    expect(res.status).toBe(200);
  });

  it("requires ts: a body signed without it is refused (it used to be valid forever)", async () => {
    const res = await post({ trigger: "manual" });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "invalid_input" });
  });

  it("uses a 300 s window in both directions", async () => {
    expect(SIGNATURE_MAX_AGE_SECONDS).toBe(300);
    for (const skew of [-(300 + 5), 300 + 5]) {
      const res = await post({ ts: nowSec() + skew });
      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({ code: "stale_signature" });
    }
    expect((await post({ ts: nowSec() - 280 })).status).toBe(200);
  });

  it("rejects a replayed signature even inside the window, and a changed ts is a new signature", async () => {
    const ts = nowSec();
    const first = await post({ ts, nebiusJobId: "j1" });
    expect(first.status).toBe(200);
    const again = await post({ ts, nebiusJobId: "j1" });
    expect(again.status).toBe(401);
    expect(await again.json()).toMatchObject({ code: "replayed_signature" });
    expect((await post({ ts: ts + 1, nebiusJobId: "j1" })).status).toBe(200);
  });

  it("replay entries store only a sha256 digest of the signature, never the signature", async () => {
    const raw = JSON.stringify({ ts: nowSec() });
    const sig = await signBody(SECRET, raw);
    await post({}, { raw, signature: sig });
    const digest = await signatureDigest(sig);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(digest).not.toContain(sig.slice(0, 16));
    // `sha256=` prefix and upper case map to the same entry.
    const replay = await post({}, { raw, signature: `sha256=${sig.toUpperCase()}` });
    expect(replay.status).toBe(401);
  });

  it("authenticates BEFORE parsing: a bad signature on malformed JSON is 401, not 400", async () => {
    const res = await post({}, { raw: "{ not json", signature: "ab".repeat(32) });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "bad_signature" });
  });

  it("verifies over the exact bytes: a BOM or a different byte string for the same decoded text does not verify", async () => {
    const text = JSON.stringify({ ts: nowSec() });
    const sig = await signBody(SECRET, text);
    const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(text)]);
    expect((await post({}, { raw: bom, signature: sig })).status).toBe(401);
    // signing the bytes with the BOM verifies those bytes
    expect(await verifySignature(SECRET, bom, await signBody(SECRET, bom))).toBe(true);
    expect(await verifySignature(SECRET, bom, sig)).toBe(false);
    // invalid UTF-8 that decodes (with U+FFFD) to the same text as another byte string cannot share a signature
    const a = new Uint8Array([0x7b, 0xff, 0x7d]);
    const b = new Uint8Array([0x7b, 0xfe, 0x7d]);
    expect(await verifySignature(SECRET, b, await signBody(SECRET, a))).toBe(false);
  });

  it("refuses a body over the cap with 413 before reading it (Content-Length) and when chunked", async () => {
    const big = "x".repeat(JOB_BODY_MAX_BYTES + 1);
    const declared = await runMondayJob(req("/api/jobs/monday", {
      method: "POST",
      headers: { "content-type": "application/json", "x-le-signature": "ab".repeat(32), "content-length": String(big.length) },
      body: big,
    }));
    expect(declared.status).toBe(413);
    const res = await post({}, { raw: big });
    expect(res.status).toBe(413);
  });

  it("requires a secret of at least 32 characters (503 job_secret_weak) and one that is set (503 job_secret_missing)", async () => {
    const weak = "short-secret-24-characters";
    freshApp({ LE_JOB_SECRET: weak }, fakePorts({ buildEditions: done, background: () => undefined }));
    const res = await post({ ts: nowSec() }, { secret: weak });
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: "job_secret_weak" });
    freshApp({}, fakePorts());
    const none = await post({ ts: nowSec() });
    expect(none.status).toBe(503);
    expect(await none.json()).toMatchObject({ code: "job_secret_missing" });
  });

  it("a wrong secret is 401 and a missing signature header is 400", async () => {
    expect((await post({ ts: nowSec() }, { secret: "z".repeat(40) })).status).toBe(401);
    const noHeader = await runMondayJob(req("/api/jobs/monday", { method: "POST", body: JSON.stringify({ ts: nowSec() }) }));
    expect(noHeader.status).toBe(400);
  });
});
