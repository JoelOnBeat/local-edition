import { beforeEach, describe, expect, it, vi } from "vitest";
import { SLACK_ACTIONS } from "@/contract/connectors-comms";
import type { AgentEvent } from "@/contract";
import { putCard, makeHarness, slackOk, NOW, type Harness } from "../comms/test-utils";
import { buildCommsState } from "../comms/state";
import { postDigest } from "./digest";
import { buttonValue, parseButtonValue } from "./blocks";
import { handleInteraction, parseInteraction, type SlackInteraction } from "./interactions";
import { dispatchSlackWith } from "./dispatch";

const regenerateMock = vi.fn();
vi.mock("../../agent/regenerate", () => ({ regenerateItem: (...args: unknown[]) => regenerateMock(...args) }));

const NO_MAIL = { COMPOSIO_SAMPLE_GMAIL_ACCOUNT: undefined };
const TEAM = "T0SAMPLE1";

async function setup(opts: Parameters<typeof makeHarness>[0] = {}): Promise<Harness> {
  const h = await makeHarness({ env: NO_MAIL, ...opts });
  slackOk(h.net);
  return h;
}

const click = (h: Harness, editionId: string, action: "approve" | "regenerate", over: Partial<SlackInteraction> = {}): SlackInteraction => ({
  type: "block_actions",
  user: { id: "U0HANNAH", username: "hannah" },
  team: { id: TEAM },
  container: { message_ts: "1761436500.000200", channel_id: "C0HEADOFFICE" },
  response_url: "https://hooks.slack.com/actions/T0SAMPLE1/1/abc",
  actions: [{ action_id: action === "approve" ? SLACK_ACTIONS.approve : SLACK_ACTIONS.regenerate, value: buttonValue(h.workspace.id, editionId) }],
  ...over,
});

const updates = (h: Harness) => h.net.to("chat.update").map((c) => JSON.parse(c.body) as { text: string; blocks: { type: string; text?: { text: string }; elements?: { text?: string | { text: string } }[] }[] });
const allText = (u: ReturnType<typeof updates>[number]) => JSON.stringify(u.blocks);

describe("head-office digest", () => {
  it("posts one message with a section, an Approve and a Regenerate button per store", async () => {
    const h = await setup();
    const out = await postDigest(h.deps, h.workspace.id);
    expect(out.posted).toBe(8);
    expect(out.note).toBeNull();
    const posts = h.net.to("chat.postMessage");
    expect(posts).toHaveLength(1);
    expect(posts[0].headers.authorization).toBe("Bearer xoxb-test-token-not-real");
    const msg = JSON.parse(posts[0].body) as { channel: string; blocks: { type: string; elements?: { action_id: string; value?: string }[] }[] };
    expect(msg.channel).toBe("head-office");
    expect(msg.blocks.length).toBeLessThanOrEqual(50);
    expect(msg.blocks.filter((b) => b.type === "section")).toHaveLength(8);
    const actions = msg.blocks.filter((b) => b.type === "actions").flatMap((b) => b.elements ?? []);
    expect(actions.filter((a) => a.action_id === SLACK_ACTIONS.approve)).toHaveLength(8);
    expect(actions.filter((a) => a.action_id === SLACK_ACTIONS.regenerate)).toHaveLength(8);
    expect(parseButtonValue(actions[0].value)?.workspaceId).toBe(h.workspace.id);
    expect(JSON.stringify(msg.blocks)).toContain("Special:");
    expect(JSON.stringify(msg.blocks)).toContain("Event:");
  });

  it("does not post the same digest twice", async () => {
    const h = await setup();
    await postDigest(h.deps, h.workspace.id);
    const again = await postDigest(h.deps, h.workspace.id);
    expect(again.posted).toBe(0);
    expect(again.note).toMatch(/already posted/);
    expect(h.net.to("chat.postMessage")).toHaveLength(1);
  });

  it("splits more than 15 stores into several messages under Slack's 50-block limit", async () => {
    const h = await setup();
    for (let i = 0; i < 12; i++) {
      const base = h.stores[i % h.stores.length];
      const store = await h.repo.putStore({ ...base, id: `store_extra_${i}`, name: `Extra ${i}` });
      await h.repo.putEdition({ ...h.editions[0], id: `ed_extra_${i}`, storeId: store.id });
    }
    const out = await postDigest(h.deps, h.workspace.id);
    expect(out.posted).toBe(20);
    const posts = h.net.to("chat.postMessage").map((c) => JSON.parse(c.body) as { blocks: unknown[] });
    expect(posts).toHaveLength(2);
    for (const p of posts) expect(p.blocks.length).toBeLessThanOrEqual(50);
  });

  it("reports a missing channel in words and records a failed delivery", async () => {
    const h = await makeHarness({ env: NO_MAIL });
    h.net.on("auth.test", () => ({ ok: true, team_id: TEAM, team: "HQ" })).on("chat.postMessage", () => ({ ok: false, error: "channel_not_found" }));
    const out = await postDigest(h.deps, h.workspace.id);
    expect(out.posted).toBe(0);
    expect(out.note).toMatch(/#head-office was not found/);
    expect(out.deliveries.every((d) => d.status === "failed")).toBe(true);
    const state = await buildCommsState(h.deps, h.workspace.id);
    expect(state.events.some((e) => e.kind === "digest.posted" && !e.ok)).toBe(true);
    // a retry after the channel exists posts (the failed attempt must not hold the idempotency claim)
    h.net.handlers.length = 0;
    slackOk(h.net);
    expect((await postDigest(h.deps, h.workspace.id)).posted).toBe(8);
  });

  it("marks Slack as errored when the token was revoked", async () => {
    const h = await makeHarness({ env: NO_MAIL });
    h.net.on("auth.test", () => ({ ok: true, team_id: TEAM, team: "HQ" })).on("chat.postMessage", () => ({ ok: false, error: "token_revoked" }));
    const out = await postDigest(h.deps, h.workspace.id);
    expect(out.note).toMatch(/revoked/i);
    const state = await buildCommsState(h.deps, h.workspace.id);
    const slack = state.connections.find((c) => c.provider === "slack")!;
    expect(slack.status).toBe("error");
    expect(slack.error).toMatch(/Reconnect Slack/);
  });

  it("says Slack is not connected when a real chain has no install", async () => {
    const h = await setup({ sample: false });
    const out = await postDigest(h.deps, h.workspace.id);
    expect(out).toMatchObject({ posted: 0, note: "Slack is not connected." });
    expect(h.net.calls).toHaveLength(0);
  });

  it("stops the shared sample Slack at its daily limit", async () => {
    const h = await setup();
    for (let n = 1; n <= 40; n++) await h.store.claim(`sample-quota:slack:${NOW.toISOString().slice(0, 10)}:${n}`);
    const out = await postDigest(h.deps, h.workspace.id);
    expect(out.posted).toBe(0);
    expect(out.note).toMatch(/posting limit/);
  });
});

describe("interaction parsing", () => {
  it("reads a block_actions payload from the form body and ignores everything else", () => {
    const payload = { type: "block_actions", user: { id: "U1" }, team: { id: "T1" }, actions: [{ action_id: "le_approve", value: "v1|ws|ed" }] };
    expect(parseInteraction(`payload=${encodeURIComponent(JSON.stringify(payload))}`)?.actions[0].action_id).toBe("le_approve");
    expect(parseInteraction(`payload=${encodeURIComponent(JSON.stringify({ ...payload, type: "view_submission" }))}`)).toBeNull();
    expect(parseInteraction("payload=not-json")).toBeNull();
    expect(parseInteraction("nothing=here")).toBeNull();
    expect(parseInteraction(`payload=${encodeURIComponent(JSON.stringify({ type: "block_actions" }))}`)).toBeNull();
  });

  it("rejects malformed button values", () => {
    expect(parseButtonValue("v1|ws|ed")).toEqual({ workspaceId: "ws", editionId: "ed" });
    for (const bad of [undefined, "", "v2|ws|ed", "v1|ws", "v1||ed", `v1|${"x".repeat(65)}|ed`, "v1|a|b|c"]) expect(parseButtonValue(bad)).toBeNull();
  });
});

describe("Approve and Regenerate buttons", () => {
  let h: Harness;
  beforeEach(async () => {
    regenerateMock.mockReset();
    h = await setup();
    await postDigest(h.deps, h.workspace.id);
    h.net.calls.length = 0;
  });

  it("approves through the app's approval path and edits the message to name who approved", async () => {
    const edition = h.editions[0];
    await handleInteraction(h.deps, click(h, edition.id, "approve"));
    const after = (await h.repo.getEdition(edition.id))!;
    expect(after.status).toBe("approved");
    expect(after.items.every((i) => i.status === "approved")).toBe(true);
    const [update] = updates(h);
    expect(allText(update)).toContain("Approved by <@U0HANNAH> at <!date^");
    expect((await buildCommsState(h.deps, h.workspace.id)).events.some((e) => e.kind === "approval.clicked" && e.ok)).toBe(true);
  });

  it("posts the staff card to the store's channel once the edition is approved", async () => {
    const edition = h.editions[0];
    await putCard(h, edition.id);
    await handleInteraction(h.deps, click(h, edition.id, "approve"));
    const posts = h.net.to("chat.postMessage").map((c) => JSON.parse(c.body) as { channel: string; text: string });
    expect(posts).toHaveLength(1);
    expect(posts[0].channel).toMatch(/^store-/);
    expect(posts[0].text).toContain("Staff card for");
    const state = await buildCommsState(h.deps, h.workspace.id);
    expect(state.deliveries.some((d) => d.provider === "slack" && d.itemId === "staff-card" && d.status === "sent")).toBe(true);
    // dispatching the same approved card again sends nothing new
    await dispatchSlackWith(h.deps, { workspaceId: h.workspace.id, editionId: edition.id });
    expect(h.net.to("chat.postMessage")).toHaveLength(1);
  });

  it("treats a double click as one approval", async () => {
    const edition = h.editions[1];
    await Promise.all([handleInteraction(h.deps, click(h, edition.id, "approve")), handleInteraction(h.deps, click(h, edition.id, "approve"))]);
    await handleInteraction(h.deps, click(h, edition.id, "approve"));
    expect(updates(h)).toHaveLength(1);
    const events = (await buildCommsState(h.deps, h.workspace.id)).events.filter((e) => e.kind === "approval.clicked");
    expect(events).toHaveLength(1);
  });

  it("ignores a click from another Slack workspace", async () => {
    const edition = h.editions[0];
    await handleInteraction(h.deps, click(h, edition.id, "approve", { team: { id: "T0OTHER99" }, user: { id: "U0EVIL" } }));
    expect((await h.repo.getEdition(edition.id))!.status).toBe("draft");
    expect(h.net.calls).toHaveLength(0);
  });

  it("ignores a click on a message that is not the posted digest, an unknown edition and a forged workspace", async () => {
    const edition = h.editions[0];
    await handleInteraction(h.deps, click(h, edition.id, "approve", { container: { message_ts: "1700000000.000001" } }));
    await handleInteraction(h.deps, click(h, "ed_does_not_exist", "approve"));
    await handleInteraction(h.deps, { ...click(h, edition.id, "approve"), actions: [{ action_id: SLACK_ACTIONS.approve, value: buttonValue("ws_forged", edition.id) }] });
    expect((await h.repo.getEdition(edition.id))!.status).toBe("draft");
  });

  it("ignores the Open link button", async () => {
    const edition = h.editions[0];
    await handleInteraction(h.deps, { ...click(h, edition.id, "approve"), actions: [{ action_id: SLACK_ACTIONS.open }] });
    expect(h.net.calls).toHaveLength(0);
  });

  it("approves only what guardrails cleared and says the rest needs review", async () => {
    const edition = h.editions[2];
    const risky = edition.items[0];
    await h.repo.updateEditionItem(edition.id, { ...risky, guardrail: { status: "unchecked", reasons: ["Guardrails could not be reached."] } }, risky.version);
    await handleInteraction(h.deps, click(h, edition.id, "approve"));
    const after = (await h.repo.getEdition(edition.id))!;
    expect(after.status).not.toBe("approved");
    expect(after.items.find((i) => i.id === risky.id)!.status).toBe("draft");
    const [update] = updates(h);
    expect(allText(update)).toMatch(/approved \d+ of \d+ items/);
    expect(h.net.to("chat.postMessage")).toHaveLength(0); // no card until the edition is fully approved
  });

  it("shows an edition approved in the app as such instead of crediting the clicker", async () => {
    const edition = h.editions[3];
    for (const item of edition.items) await h.repo.updateEditionItem(edition.id, { ...item, status: "approved" }, item.version);
    await h.repo.setEditionStatus(edition.id, "approved");
    await handleInteraction(h.deps, click(h, edition.id, "approve"));
    expect(allText(updates(h)[0])).toContain("Approved in Local Edition");
  });

  it("keeps working when the message update fails because the token was revoked", async () => {
    const edition = h.editions[0];
    h.net.handlers.unshift((c) => (c.url.includes("chat.update") ? Response.json({ ok: false, error: "token_revoked" }) : undefined));
    await handleInteraction(h.deps, click(h, edition.id, "approve"));
    expect((await h.repo.getEdition(edition.id))!.status).toBe("approved");
  });

  it("regenerates the special and leaves the decision to head office", async () => {
    const edition = h.editions[0];
    regenerateMock.mockImplementation(async function* (): AsyncGenerator<AgentEvent> { yield { type: "store_started", storeId: edition.storeId }; });
    await handleInteraction(h.deps, click(h, edition.id, "regenerate"));
    expect(regenerateMock).toHaveBeenCalledTimes(1);
    const params = regenerateMock.mock.calls[0][0] as { editionId: string; itemId: string };
    expect(params.editionId).toBe(edition.id);
    expect(edition.items.find((i) => i.id === params.itemId)?.kind).toBe("special");
    expect(allText(updates(h)[0])).toContain("asked for a new special");
    expect(allText(updates(h)[updates(h).length - 1])).toContain("New special requested by <@U0HANNAH>");
    expect((await h.repo.getEdition(edition.id))!.status).toBe("draft");
  });

  it("shows why a regenerate failed and lets the click be retried", async () => {
    const edition = h.editions[0];
    regenerateMock.mockImplementation(async function* (): AsyncGenerator<AgentEvent> { yield { type: "error", code: "spend_cap", message: "The spend cap was reached." }; });
    await handleInteraction(h.deps, click(h, edition.id, "regenerate"));
    expect(allText(updates(h)[updates(h).length - 1])).toContain("The spend cap was reached.");
    regenerateMock.mockImplementation(async function* (): AsyncGenerator<AgentEvent> { /* ok */ });
    await handleInteraction(h.deps, click(h, edition.id, "regenerate"));
    expect(regenerateMock).toHaveBeenCalledTimes(2);
  });
});

describe("staff card in Slack", () => {
  it("reports a missing store channel as a failed delivery without losing the approval", async () => {
    const h = await makeHarness({ env: NO_MAIL });
    h.net.on("auth.test", () => ({ ok: true, team_id: TEAM, team: "HQ" })).on("chat.postMessage", () => ({ ok: false, error: "channel_not_found" }));
    const edition = h.editions[0];
    await putCard(h, edition.id);
    for (const item of edition.items) await h.repo.updateEditionItem(edition.id, { ...item, status: "approved" }, item.version);
    await h.repo.setEditionStatus(edition.id, "approved");
    await dispatchSlackWith(h.deps, { workspaceId: h.workspace.id, editionId: edition.id });
    const state = await buildCommsState(h.deps, h.workspace.id);
    const failed = state.deliveries.find((d) => d.itemId === "staff-card");
    expect(failed?.status).toBe("failed");
    expect(failed?.note).toMatch(/#store-.* was not found/);
  });

  it("skips the card when guardrails have not cleared it", async () => {
    const h = await setup();
    const edition = h.editions[0];
    const card = await putCard(h, edition.id);
    await h.repo.putStaffCard({ ...card, guardrail: { status: "unchecked", reasons: ["down"] } });
    for (const item of edition.items) await h.repo.updateEditionItem(edition.id, { ...item, status: "approved" }, item.version);
    await h.repo.setEditionStatus(edition.id, "approved");
    await dispatchSlackWith(h.deps, { workspaceId: h.workspace.id, editionId: edition.id });
    expect(h.net.to("chat.postMessage")).toHaveLength(0);
    expect((await buildCommsState(h.deps, h.workspace.id)).deliveries.find((d) => d.itemId === "staff-card")?.status).toBe("skipped");
  });
});
