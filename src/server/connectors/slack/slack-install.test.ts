import { describe, expect, it } from "vitest";
import { SLACK_ACTIONS } from "@/contract/connectors-comms";
import { makeHarness, EXTRA_ENV, type Harness } from "../comms/test-utils";
import { postDigest } from "./digest";
import { buttonValue } from "./blocks";
import { handleInteraction, type SlackInteraction } from "./interactions";

const NO_MAIL = { COMPOSIO_SAMPLE_GMAIL_ACCOUNT: undefined };
const TEAM = "T0SAMPLE1";

const click = (h: Harness, editionId: string, action: "approve" | "regenerate", over: Partial<SlackInteraction> = {}): SlackInteraction => ({
  type: "block_actions",
  user: { id: "U0HANNAH", username: "hannah" },
  team: { id: TEAM },
  container: { message_ts: "1761436500.000200", channel_id: "C0HEADOFFICE" },
  response_url: "https://hooks.slack.com/actions/T0SAMPLE1/1/abc",
  actions: [{ action_id: action === "approve" ? SLACK_ACTIONS.approve : SLACK_ACTIONS.regenerate, value: buttonValue(h.workspace.id, editionId) }],
  ...over,
});

describe("incoming-webhook fallback", () => {
  it("posts the digest through the webhook when there is no bot token, and edits it through the click's response_url", async () => {
    const h = await makeHarness({ env: { ...NO_MAIL, SLACK_BOT_TOKEN: undefined, ...EXTRA_ENV } });
    h.net.handlers.push((c) => (c.url.includes("hooks.slack.com") ? new Response("ok") : undefined));
    const out = await postDigest(h.deps, h.workspace.id);
    expect(out.posted).toBe(8);
    expect(h.net.to("hooks.slack.com/services")).toHaveLength(1);
    expect(h.net.to("slack.com/api")).toHaveLength(0);
    const edition = h.editions[0];
    await handleInteraction(h.deps, click(h, edition.id, "approve", { container: { message_ts: "1761436500.000200" } }));
    expect((await h.repo.getEdition(edition.id))!.status).toBe("approved");
    const replaced = h.net.to("hooks.slack.com/actions");
    expect(replaced).toHaveLength(1);
    expect(JSON.parse(replaced[0].body)).toMatchObject({ replace_original: true });
  });

  it("reports a dead webhook as a revoked connection", async () => {
    const h = await makeHarness({ env: { ...NO_MAIL, SLACK_BOT_TOKEN: undefined, ...EXTRA_ENV } });
    h.net.handlers.push((c) => (c.url.includes("hooks.slack.com") ? new Response("no_service", { status: 404 }) : undefined));
    const out = await postDigest(h.deps, h.workspace.id);
    expect(out.note).toMatch(/revoked/i);
  });
});

describe("Slack install", () => {
  it("builds a signed authorize URL and seals the bot token per workspace", async () => {
    const { installUrl, completeInstall } = await import("./install");
    const { decryptToken } = await import("../comms/crypto");
    const h = await makeHarness({ sample: false });
    const url = new URL(await installUrl(h.deps, h.workspace.id));
    expect(url.origin + url.pathname).toBe("https://slack.com/oauth/v2/authorize");
    expect(url.searchParams.get("scope")).toBe("chat:write,chat:write.public,channels:read");
    expect(url.searchParams.get("redirect_uri")).toBe("https://localedition.example/api/connectors/slack/callback");
    h.net
      .on("oauth.v2.access", () => ({ ok: true, access_token: "xoxb-from-oauth-not-real", team: { id: "T0REAL999", name: "Hearth & Hand" }, bot_user_id: "U0BOT" }))
      .on("conversations.list", () => ({ ok: true, channels: [{ id: "C0HEAD", name: "head-office" }] }));
    const state = url.searchParams.get("state")!;
    expect(await completeInstall(h.deps, { code: "oauth-code", state })).toBe(h.workspace.id);
    const row = (await h.store.getSlackInstall(h.workspace.id))!;
    expect(row).toMatchObject({ teamId: "T0REAL999", teamName: "Hearth & Hand", source: "oauth", error: null });
    expect(JSON.stringify(row)).not.toContain("xoxb-from-oauth");
    expect(await decryptToken(row.botTokenSealed!, "test-encryption-key-0123456789abcdef", h.workspace.id)).toBe("xoxb-from-oauth-not-real");
    expect(new URLSearchParams(h.net.to("oauth.v2.access")[0].body).get("code")).toBe("oauth-code");
    // the state is single use
    await expect(completeInstall(h.deps, { code: "again", state })).rejects.toMatchObject({ code: "state_used" });
  });

  it("rejects a forged state, warns when #head-office is missing, and reports a not-configured server", async () => {
    const { installUrl, completeInstall } = await import("./install");
    const h = await makeHarness({ sample: false });
    await expect(completeInstall(h.deps, { code: "c", state: "forged.state" })).rejects.toMatchObject({ code: "bad_state" });
    h.net.on("oauth.v2.access", () => ({ ok: true, access_token: "xoxb-x", team: { id: "T0REAL999" } })).on("conversations.list", () => ({ ok: true, channels: [{ id: "C1", name: "general" }] }));
    const state = new URL(await installUrl(h.deps, h.workspace.id)).searchParams.get("state")!;
    await completeInstall(h.deps, { code: "c", state });
    expect((await h.store.getSlackInstall(h.workspace.id))!.error).toMatch(/no #head-office channel/);
    const bare = await makeHarness({ sample: false, env: { SLACK_CLIENT_ID: undefined } });
    await expect(installUrl(bare.deps, bare.workspace.id)).rejects.toMatchObject({ status: 503, code: "slack_not_configured" });
  });
});
