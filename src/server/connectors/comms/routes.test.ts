import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SLACK_ACTIONS } from "@/contract/connectors-comms";
import { setAgentDeps } from "../../agent/deps";
import type { AgentDeps } from "../../agent/ports";
import { setRepo } from "../../store";
import { hmacBase64, hmacHex } from "./crypto";
import { mailWebhookHandler, slackCallbackHandler, slackInteractionsHandler } from "./public-routes";
import { makeHarness, SECRETS, slackOk, type Harness } from "./test-utils";
import { setCommsStore } from "./store";
import { buttonValue } from "../slack/blocks";
import { postDigest } from "../slack/digest";
import { setDocDb } from "./docs";

let h: Harness;
const realFetch = globalThis.fetch;

beforeEach(async () => {
  for (const [k, v] of Object.entries(SECRETS)) vi.stubEnv(k, v);
  vi.stubEnv("COMPOSIO_SAMPLE_GMAIL_ACCOUNT", "");
  h = await makeHarness({ env: { COMPOSIO_SAMPLE_GMAIL_ACCOUNT: undefined } });
  setRepo(h.repo);
  setCommsStore(h.store);
  setAgentDeps({ repo: h.repo, chat: h.chat, now: () => new Date() } as unknown as AgentDeps);
  slackOk(h.net);
  globalThis.fetch = h.net.fetch; // fetchJson uses the global fetch in the live wiring
});

afterEach(() => {
  vi.unstubAllEnvs();
  globalThis.fetch = realFetch;
  setCommsStore(undefined);
  setAgentDeps(undefined);
  setDocDb(undefined);
});

const nowSeconds = () => Math.floor(Date.now() / 1000);

async function slackRequest(body: string, opts: { ts?: number; secret?: string; sign?: boolean } = {}): Promise<Request> {
  const ts = opts.ts ?? nowSeconds();
  const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded", "x-slack-request-timestamp": String(ts) };
  if (opts.sign !== false) headers["x-slack-signature"] = `v0=${await hmacHex(opts.secret ?? SECRETS.SLACK_SIGNING_SECRET, `v0:${ts}:${body}`)}`;
  return new Request("https://localedition.example/api/connectors/slack/interactions", { method: "POST", headers, body });
}

const formBody = (payload: unknown) => `payload=${encodeURIComponent(JSON.stringify(payload))}`;

describe("POST /api/connectors/slack/interactions", () => {
  it("rejects an unsigned, tampered, stale or wrongly signed request before reading it", async () => {
    const body = formBody({ type: "block_actions", user: { id: "U1" }, actions: [] });
    expect((await slackInteractionsHandler(await slackRequest(body, { sign: false }))).status).toBe(401);
    expect((await slackInteractionsHandler(await slackRequest(body, { secret: "not-the-secret" }))).status).toBe(401);
    expect((await slackInteractionsHandler(await slackRequest(body, { ts: nowSeconds() - 600 }))).status).toBe(401);
    const tampered = await slackRequest(body);
    const res = await slackInteractionsHandler(new Request(tampered.url, { method: "POST", headers: tampered.headers, body: body + "&x=1" }));
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "bad_signature" });
  });

  it("answers 503 in words when the signing secret is not configured", async () => {
    vi.stubEnv("SLACK_SIGNING_SECRET", "");
    const res = await slackInteractionsHandler(await slackRequest("payload=%7B%7D"));
    expect(res.status).toBe(503);
    expect((await res.json() as { error: string }).error).toMatch(/not configured/);
  });

  it("acknowledges a valid click with an empty 200, then approves in the background", async () => {
    await postDigest(h.deps, h.workspace.id);
    const edition = h.editions[0];
    const body = formBody({
      type: "block_actions", user: { id: "U0HANNAH" }, team: { id: "T0SAMPLE1" }, container: { message_ts: "1761436500.000200" },
      actions: [{ action_id: SLACK_ACTIONS.approve, value: buttonValue(h.workspace.id, edition.id) }],
    });
    const res = await slackInteractionsHandler(await slackRequest(body));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("");
    for (let i = 0; i < 50 && (await h.repo.getEdition(edition.id))!.status !== "approved"; i++) await new Promise((r) => setTimeout(r, 20));
    expect((await h.repo.getEdition(edition.id))!.status).toBe("approved");
  });

  it("acknowledges (and ignores) a signed body that is not a block action", async () => {
    const res = await slackInteractionsHandler(await slackRequest("payload=%7B%22type%22%3A%22view_submission%22%7D"));
    expect(res.status).toBe(200);
  });

  it("refuses a body over the size limit", async () => {
    const res = await slackInteractionsHandler(await slackRequest("x".repeat(300 * 1024)));
    expect(res.status).toBe(413);
  });
});

describe("POST /api/connectors/mail/webhook", () => {
  const body = JSON.stringify({ id: "m1", type: "composio.trigger.message", metadata: { trigger_slug: "GITHUB_PUSH" }, data: {} });
  const request = async (opts: { secret?: string; ts?: number; raw?: string } = {}) => {
    const ts = opts.ts ?? nowSeconds();
    const raw = opts.raw ?? body;
    const sig = await hmacBase64(opts.secret ?? SECRETS.COMPOSIO_WEBHOOK_SECRET, `wh_1.${ts}.${body}`);
    return new Request("https://localedition.example/api/connectors/mail/webhook", { method: "POST", headers: { "webhook-id": "wh_1", "webhook-timestamp": String(ts), "webhook-signature": `v1,${sig}` }, body: raw });
  };

  it("accepts a signed event and rejects tampering, a wrong secret and a stale timestamp", async () => {
    expect((await mailWebhookHandler(await request())).status).toBe(200);
    expect((await mailWebhookHandler(await request({ raw: body + " " }))).status).toBe(401);
    expect((await mailWebhookHandler(await request({ secret: "wrong" }))).status).toBe(401);
    expect((await mailWebhookHandler(await request({ ts: nowSeconds() - 400 }))).status).toBe(401);
    expect((await mailWebhookHandler(new Request("https://x.example/", { method: "POST", body }))).status).toBe(401);
  });

  it("says so when the webhook secret is not configured", async () => {
    vi.stubEnv("COMPOSIO_WEBHOOK_SECRET", "");
    expect((await mailWebhookHandler(await request())).status).toBe(503);
  });
});

describe("GET /api/connectors/slack/callback", () => {
  it("sends a denied or malformed callback back to the connections page without touching anything", async () => {
    const denied = await slackCallbackHandler(new Request("https://localedition.example/api/connectors/slack/callback?error=access_denied&state=x"));
    expect(denied.status).toBe(302);
    expect(denied.headers.get("location")).toBe("https://localedition.example/app/connections?error=slack_denied");
    const forged = await slackCallbackHandler(new Request("https://localedition.example/api/connectors/slack/callback?code=abc&state=forged.state"));
    expect(forged.headers.get("location")).toBe("https://localedition.example/app/connections?error=bad_state");
    expect(await h.store.getSlackInstall(h.workspace.id)).toBeNull();
  });
});
