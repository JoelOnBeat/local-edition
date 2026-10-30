import { hmacHex, safeEqual } from "../comms/crypto";

/** Slack request signing: v0=HMAC_SHA256(signing secret, "v0:<timestamp>:<raw body>"), rejected when older than five minutes. */

export const SLACK_MAX_AGE_SECONDS = 300;

export type SlackVerdict = { ok: true } | { ok: false; reason: "missing_headers" | "stale" | "bad_signature" | "no_secret" };

export async function verifySlackSignature(input: {
  rawBody: string;
  signature: string | null;
  timestamp: string | null;
  signingSecret: string | undefined;
  nowSeconds?: number;
}): Promise<SlackVerdict> {
  if (!input.signingSecret) return { ok: false, reason: "no_secret" };
  if (!input.signature || !input.timestamp) return { ok: false, reason: "missing_headers" };
  const ts = Number(input.timestamp);
  if (!Number.isInteger(ts)) return { ok: false, reason: "missing_headers" };
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > SLACK_MAX_AGE_SECONDS) return { ok: false, reason: "stale" };
  const expected = `v0=${await hmacHex(input.signingSecret, `v0:${input.timestamp}:${input.rawBody}`)}`;
  return safeEqual(expected, input.signature) ? { ok: true } : { ok: false, reason: "bad_signature" };
}
