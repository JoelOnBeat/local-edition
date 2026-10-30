import { describe, expect, it } from "vitest";
import { approveInRepo, FakeNet, makeHarness, putCard, type Harness } from "../comms/test-utils";
import { buildCommsState } from "../comms/state";
import { completeMailConnect, startMailConnect } from "./connect";
import { dispatchMailWith } from "./dispatch";
import { renderCardEmail, subjectFor } from "./html";
import { buildMime } from "./mime";
import { normalizeSubject, parseSender, stripQuoted } from "./quote";

const sent = (h: Harness) => h.net.to("tools/execute/proxy");

async function approvedHarness(opts: Parameters<typeof makeHarness>[0] = {}): Promise<{ h: Harness; editionId: string }> {
  const h = await makeHarness(opts);
  const editionId = h.editions[0].id;
  await putCard(h, editionId);
  await approveInRepo(h, editionId);
  return { h, editionId };
}

const proxyAccepts = (net: FakeNet, body: unknown = { data: { id: "msg_18c", threadId: "thr_18c", labelIds: ["SENT"] }, successful: true }) => net.on("tools/execute/proxy", () => body);

describe("card email", () => {
  it("has the required subject and an HTML part and a plain-text part with the card's words", async () => {
    const { h } = await approvedHarness();
    const edition = (await h.repo.getEdition(h.editions[0].id))!;
    const store = h.stores.find((s) => s.id === edition.storeId)!;
    const card = (await h.repo.getStaffCardByEdition(edition.id))!;
    const mail = renderCardEmail({ chainName: "Kettle & Kiln (sample chain)", store, edition, card, cardUrl: "https://localedition.example/card/tok", managerName: "Dana Okafor", isSample: true });
    expect(mail.subject).toBe(subjectFor(store, edition));
    expect(mail.subject).toMatch(/^This week at Williamsburg: .+/);
    expect(mail.html).toContain("<!doctype html>");
    expect(mail.html).toContain("Hi Dana,");
    expect(mail.html).toContain("Sample chain: this email comes from Local Edition&#39;s demo");
    expect(mail.text).toContain("Hi Dana,");
    expect(mail.text).toContain("Open the staff card: https://localedition.example/card/tok");
    for (const l of card.lines) { expect(mail.html).toContain(l.heading.replace(/'/g, "&#39;")); expect(mail.text).toContain(l.body); }
  });

  it("escapes markup in card text", async () => {
    const { h } = await approvedHarness();
    const edition = (await h.repo.getEdition(h.editions[0].id))!;
    const store = h.stores.find((s) => s.id === edition.storeId)!;
    const mail = renderCardEmail({ chainName: "K&K", store, edition, cardUrl: "https://x.example/c", managerName: null, isSample: false, card: { editionId: edition.id, storeId: store.id, token: "t", guardrail: { status: "passed", reasons: [] }, lines: [{ heading: "Hot <b>", body: "<script>alert(1)</script>" }] } });
    expect(mail.html).not.toContain("<script>");
    expect(mail.html).toContain("&lt;script&gt;");
  });

  it("builds multipart/alternative MIME, encodes non-ASCII subjects and strips header injection", () => {
    const mime = buildMime({ to: "a@example.com", subject: "Café special\r\nBcc: evil@example.com", text: "plain", html: "<p>html</p>", boundary: "b1" });
    expect(mime).toContain('Content-Type: multipart/alternative; boundary="b1"');
    expect(mime).toContain("Content-Type: text/plain");
    expect(mime.indexOf("text/plain")).toBeLessThan(mime.indexOf("text/html"));
    expect(mime).toMatch(/Subject: =\?UTF-8\?B\?/);
    expect(mime.split("\r\n").some((l) => l.startsWith("Bcc:"))).toBe(false);
  });
});

describe("sending the card on approval", () => {
  it("emails the sample inbox through Composio, with both parts, and records the thread, delivery and event", async () => {
    const { h, editionId } = await approvedHarness();
    proxyAccepts(h.net);
    await dispatchMailWith(h.deps, { workspaceId: h.workspace.id, editionId });
    const [call] = sent(h);
    expect(call.headers["x-api-key"]).toBe("ck_test_not_real");
    const body = JSON.parse(call.body) as { connected_account_id: string; user_id: string; endpoint: string; body: { raw: string } };
    expect(body).toMatchObject({ connected_account_id: "ca_sample_gmail", user_id: h.workspace.id, endpoint: "https://gmail.googleapis.com/gmail/v1/users/me/messages/send" });
    const mime = Buffer.from(body.body.raw.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    expect(mime).toContain("To: \"Williamsburg manager\" <test-inbox@example.com>");
    expect(mime).toContain("multipart/alternative");
    const state = await buildCommsState(h.deps, h.workspace.id);
    expect(state.deliveries.find((d) => d.provider === "gmail")).toMatchObject({ status: "sent", externalId: "thr_18c", itemId: "staff-card" });
    expect(state.events.find((e) => e.kind === "mail.sent")).toMatchObject({ ok: true, direction: "out", storeId: h.editions[0].storeId });
    expect((await h.store.findThread("gmail", "thr_18c"))?.editionId).toBe(editionId);
  });

  it("sends once per card: a second approval of the same wording sends nothing", async () => {
    const { h, editionId } = await approvedHarness();
    proxyAccepts(h.net);
    await dispatchMailWith(h.deps, { workspaceId: h.workspace.id, editionId });
    await dispatchMailWith(h.deps, { workspaceId: h.workspace.id, editionId });
    expect(sent(h)).toHaveLength(1);
    await putCard(h, editionId, [{ heading: "This week's special", body: "A different line after head office edited the copy." }, { heading: "On the speakers", body: "Same." }]);
    await dispatchMailWith(h.deps, { workspaceId: h.workspace.id, editionId });
    expect(sent(h)).toHaveLength(2);
  });

  it("never mails an address nobody gave it: a real chain with no manager email is skipped in words", async () => {
    const { h, editionId } = await approvedHarness({ sample: false });
    await h.store.putMailConn({ workspaceId: h.workspace.id, provider: "gmail", connectedAccountId: "ca_own", status: "active", accountLabel: "ops@chain.example", triggerId: null, createdAt: "2026-10-27T00:00:00.000Z", lastSyncAt: null, error: null });
    await dispatchMailWith(h.deps, { workspaceId: h.workspace.id, editionId });
    expect(h.net.calls).toHaveLength(0);
    const d = (await buildCommsState(h.deps, h.workspace.id)).deliveries.find((x) => x.provider === "gmail");
    expect(d?.status).toBe("skipped");
    expect(d?.note).toMatch(/No manager email is set for Williamsburg/);
  });

  it("does nothing without a connected mailbox", async () => {
    const { h, editionId } = await approvedHarness({ sample: false });
    await dispatchMailWith(h.deps, { workspaceId: h.workspace.id, editionId });
    expect(h.net.calls).toHaveLength(0);
  });

  it("falls back to the Gmail tool when the proxy refuses, and does not double-send when the proxy accepted", async () => {
    const a = await approvedHarness();
    a.h.net.on("tools/execute/proxy", () => ({ error: "nope" }), 400).on("tools/execute/GMAIL_SEND_EMAIL", () => ({ successful: true, data: { response_data: { id: "msg_t", threadId: "thr_t" } } }));
    await dispatchMailWith(a.h.deps, { workspaceId: a.h.workspace.id, editionId: a.editionId });
    expect(a.h.net.to("GMAIL_SEND_EMAIL")).toHaveLength(1);
    expect(JSON.parse(a.h.net.to("GMAIL_SEND_EMAIL")[0].body).arguments).toMatchObject({ recipient_email: "test-inbox@example.com", is_html: true });
    expect((await a.h.store.findThread("gmail", "thr_t"))?.editionId).toBe(a.editionId);

    const b = await approvedHarness();
    proxyAccepts(b.h.net, { data: { weird: true }, successful: true });
    await dispatchMailWith(b.h.deps, { workspaceId: b.h.workspace.id, editionId: b.editionId });
    expect(b.h.net.to("GMAIL_SEND_EMAIL")).toHaveLength(0);
    const edB = (await b.h.repo.getEdition(b.editionId))!;
    const storeB = b.h.stores.find((x) => x.id === edB.storeId)!;
    expect((await b.h.store.findThread("gmail", `subj:${normalizeSubject(subjectFor(storeB, edB))}`))?.editionId).toBe(b.editionId);
  });

  it("reports an expired mailbox and lets the send be retried", async () => {
    const { h, editionId } = await approvedHarness({ sample: false });
    await h.store.putMailConn({ workspaceId: h.workspace.id, provider: "gmail", connectedAccountId: "ca_own", status: "active", accountLabel: "ops@chain.example", triggerId: null, createdAt: "2026-10-27T00:00:00.000Z", lastSyncAt: null, error: null });
    await h.store.putTargets(h.workspace.id, [{ storeId: h.editions[0].storeId, slackChannel: null, managerName: "Dana Okafor", managerEmail: "dana@chain.example" }], "2026-10-28T00:00:00.000Z");
    h.net.on("tools/execute/", () => ({ successful: false, error: "Connected account expired. Please reconnect." }));
    await dispatchMailWith(h.deps, { workspaceId: h.workspace.id, editionId });
    const state = await buildCommsState(h.deps, h.workspace.id);
    expect(state.deliveries.find((d) => d.provider === "gmail")).toMatchObject({ status: "failed" });
    const gmail = state.connections.find((c) => c.provider === "gmail")!;
    expect(gmail.status).toBe("error");
    expect(gmail.error).toMatch(/Reconnect/);
    // after reconnecting, the same card goes out
    h.net.handlers.length = 0;
    h.net.calls.length = 0;
    await h.store.putMailConn({ workspaceId: h.workspace.id, provider: "gmail", connectedAccountId: "ca_own", status: "active", accountLabel: "ops@chain.example", triggerId: null, createdAt: "2026-10-27T00:00:00.000Z", lastSyncAt: null, error: null });
    proxyAccepts(h.net);
    await dispatchMailWith(h.deps, { workspaceId: h.workspace.id, editionId });
    expect(sent(h)).toHaveLength(1);
  });

  it("caps the shared sample mailbox per day", async () => {
    const { h, editionId } = await approvedHarness();
    for (let n = 1; n <= 20; n++) await h.store.claim(`sample-quota:mail:2026-10-28:${n}`);
    await dispatchMailWith(h.deps, { workspaceId: h.workspace.id, editionId });
    expect(h.net.calls).toHaveLength(0);
    expect((await buildCommsState(h.deps, h.workspace.id)).deliveries.find((d) => d.provider === "gmail")?.note).toMatch(/sending limit/);
  });
});

describe("connecting a mailbox", () => {
  const link = { redirect_url: "https://connect.composio.dev/link/lk_abc", connected_account_id: "ca_new", link_token: "lk_abc", expires_at: "2026-10-28T03:00:00Z" };

  it("makes a Composio link for the workspace and keeps only the connected-account id", async () => {
    const h = await makeHarness({ sample: false });
    h.net.on("/connected_accounts/link", () => link);
    const url = await startMailConnect(h.deps, h.workspace.id, "gmail");
    expect(url).toBe(link.redirect_url);
    const body = JSON.parse(h.net.to("/connected_accounts/link")[0].body) as { auth_config_id: string; user_id: string; callback_url: string };
    expect(body).toMatchObject({ auth_config_id: "ac_test_gmail", user_id: h.workspace.id });
    expect(body.callback_url).toMatch(/^https:\/\/localedition\.example\/api\/connectors\/mail\/callback\?state=.+&provider=gmail$/);
    const row = await h.store.getMailConn(h.workspace.id, "gmail");
    expect(row).toMatchObject({ connectedAccountId: "ca_new", status: "pending" });
    expect(JSON.stringify(row)).not.toMatch(/token|secret/i);
  });

  it("activates the account only when Composio says ACTIVE, and creates the real-time trigger for it", async () => {
    const h = await makeHarness({ sample: false });
    h.net.on("/connected_accounts/link", () => link);
    await startMailConnect(h.deps, h.workspace.id, "gmail");
    const callback = JSON.parse(h.net.to("/connected_accounts/link")[0].body).callback_url as string;
    const state = new URL(callback).searchParams.get("state")!;

    h.net.handlers.length = 0;
    h.net.on("/connected_accounts/ca_new", () => ({ id: "ca_new", status: "INITIATED", toolkit: { slug: "gmail" } }));
    await expect(completeMailConnect(h.deps, state)).rejects.toMatchObject({ status: 409 });
    expect((await h.store.getMailConn(h.workspace.id, "gmail"))?.status).toBe("pending");

    h.net.handlers.length = 0;
    h.net.on("/connected_accounts/ca_new", () => ({ id: "ca_new", status: "ACTIVE", toolkit: { slug: "gmail" }, state: { val: { access_token: "ya29.must-never-be-kept" } } }))
      .on("GMAIL_GET_PROFILE", () => ({ successful: true, data: { response_data: { emailAddress: "ops@kettleandkiln.example" } } }))
      .on("/trigger_instances/GMAIL_NEW_GMAIL_MESSAGE/upsert", () => ({ trigger_id: "ti_abc" }));
    const done = await completeMailConnect(h.deps, state);
    expect(done).toEqual({ workspaceId: h.workspace.id, provider: "gmail" });
    const row = await h.store.getMailConn(h.workspace.id, "gmail");
    expect(row).toMatchObject({ status: "active", accountLabel: "ops@kettleandkiln.example", triggerId: "ti_abc" });
    expect(JSON.stringify(row)).not.toContain("ya29");
    const trigger = JSON.parse(h.net.to("/trigger_instances/")[0].body) as { egress_url: string; user_id: string; connected_account_id: string };
    expect(trigger).toMatchObject({ egress_url: "https://localedition.example/api/connectors/mail/webhook", user_id: h.workspace.id, connected_account_id: "ca_new" });
  });

  it("rejects a forged, expired or foreign state", async () => {
    const h = await makeHarness({ sample: false });
    await expect(completeMailConnect(h.deps, "forged.state")).rejects.toMatchObject({ status: 400 });
    h.net.on("/connected_accounts/link", () => link);
    await startMailConnect(h.deps, h.workspace.id, "outlook");
    const state = new URL(JSON.parse(h.net.to("/connected_accounts/link")[0].body).callback_url).searchParams.get("state")!;
    h.deps.now = () => new Date(Date.now() + 3_600_000 * 24 * 365);
    await expect(completeMailConnect(h.deps, state)).rejects.toMatchObject({ status: 400 });
  });

  it("explains an unconfigured provider instead of failing", async () => {
    const h = await makeHarness({ sample: false, env: { COMPOSIO_AUTH_CONFIG_OUTLOOK: undefined } });
    await expect(startMailConnect(h.deps, h.workspace.id, "outlook")).rejects.toMatchObject({ status: 503, code: "mail_not_configured" });
  });
});

describe("quoted-reply stripping", () => {
  it("keeps what the manager wrote and drops quoted history and signatures", () => {
    expect(stripQuoted("Gone by 11 both days!\n\nOn Mon, Oct 26, 2026 at 9:14 AM Head Office <ho@k.example> wrote:\n> Hi Dana, here is this week's card")).toBe("Gone by 11 both days!");
    expect(stripQuoted("Thanks!\n\nFrom: Head Office\nSent: Monday\nTo: Dana\nSubject: This week")).toBe("Thanks!");
    expect(stripQuoted("Good.\n-- \nDana Okafor\nStore manager")).toBe("Good.");
    expect(stripQuoted("> only a quote")).toBe("");
  });
  it("parses senders and subjects", () => {
    expect(parseSender('"Dana Okafor" <Dana.Okafor@Example.com>')).toEqual({ name: "Dana Okafor", email: "dana.okafor@example.com" });
    expect(parseSender("plain@example.com")).toEqual({ name: null, email: "plain@example.com" });
    expect(normalizeSubject("RE: Re: Fwd: This week at Williamsburg:  Bun")).toBe("this week at williamsburg: bun");
  });
});
