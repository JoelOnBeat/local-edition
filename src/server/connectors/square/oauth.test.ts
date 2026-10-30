import { describe, expect, it } from "vitest";
import { decryptToken } from "../crypto";
import { disconnectSquare, finishOAuth, OAUTH_STATE_TTL_SECONDS, squareStatus, startOAuth } from "./connect";
import { harness, TEST_ENV } from "./test-utils";

const stateOf = (authorizeUrl: string) => new URL(authorizeUrl).searchParams.get("state")!;
const location = (res: Response) => new URL(res.headers.get("location")!);

describe("OAuth start", () => {
  it("builds the sandbox authorize URL with the four scopes and a fresh state", async () => {
    const h = await harness();
    const url = new URL(await startOAuth(h.deps, h.workspaceId));
    expect(url.origin + url.pathname).toBe("https://connect.squareupsandbox.com/oauth2/authorize");
    expect(url.searchParams.get("client_id")).toBe("sandbox-sq0idb-test-app");
    expect(url.searchParams.get("scope")?.split(" ")).toEqual(["ITEMS_READ", "ITEMS_WRITE", "MERCHANT_PROFILE_READ", "ORDERS_READ"]);
    expect(url.searchParams.get("session")).toBe("false");
    expect(url.searchParams.get("state")).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(await startOAuth(h.deps, h.workspaceId)).not.toBe(url.toString());
  });
  it("a production application id uses the production host", async () => {
    const h = await harness({ ...TEST_ENV, SQUARE_APP_ID: "sq0idp-live" });
    expect(new URL(await startOAuth(h.deps, h.workspaceId)).origin).toBe("https://connect.squareup.com");
  });
  it("refuses with 503 when the token key is not a 32-byte key", async () => {
    const h = await harness({ ...TEST_ENV, SQUARE_TOKEN_KEY: "too-short" });
    await expect(startOAuth(h.deps, h.workspaceId)).rejects.toMatchObject({ status: 503, code: "config_error" });
  });
  it("refuses with 503 when the application is not configured", async () => {
    const h = await harness({ SQUARE_MODE: "live" });
    await expect(startOAuth(h.deps, h.workspaceId)).rejects.toMatchObject({ status: 503, code: "square_oauth_not_configured" });
  });
});

describe("OAuth callback", () => {
  async function start() {
    const h = await harness();
    const state = stateOf(await startOAuth(h.deps, h.workspaceId));
    return { h, state };
  }

  it("exchanges the code, stores the tokens encrypted, imports, and redirects to the connections page", async () => {
    const { h, state } = await start();
    const res = await finishOAuth(h.deps, { code: "good-code", state, cookieWorkspaceId: h.workspaceId });
    expect(res.status).toBe(302);
    expect(location(res).href).toBe("https://localedition.pages.dev/app/connections?square=connected");
    const stored = (await h.ledger.getConnection(h.workspaceId, "square"))!;
    expect(stored.tokenEnc).toMatch(/^v1\./);
    expect(JSON.stringify(stored)).not.toContain("oauth-access-1");
    expect(JSON.stringify(stored)).not.toContain("oauth-refresh-1");
    expect(await decryptToken(stored.tokenEnc!, h.workspaceId, h.deps.config.tokenKey)).toBe("oauth-access-1");
    // The import used the OAuth token, not the server's sandbox token.
    expect(h.fake.calls.find((c) => c.path === "/v2/catalog/search")?.headers.authorization).toBe("Bearer oauth-access-1");
    expect((await squareStatus(h.deps, h.workspaceId)).connection.status).toBe("connected");
  });

  it("a state is single use", async () => {
    const { h, state } = await start();
    await finishOAuth(h.deps, { code: "good-code", state, cookieWorkspaceId: h.workspaceId });
    const again = await finishOAuth(h.deps, { code: "good-code", state, cookieWorkspaceId: h.workspaceId });
    expect(location(again).search).toBe("?square=error&reason=state");
    expect(h.fake.tokens.issued).toBe(1);
  });

  it("rejects a missing, unknown or expired state without calling Square", async () => {
    const { h, state } = await start();
    for (const s of [undefined, "forged-state-value", ""]) {
      expect(location(await finishOAuth(h.deps, { code: "good-code", state: s, cookieWorkspaceId: h.workspaceId })).search).toBe("?square=error&reason=state");
    }
    h.now.value = new Date(h.now.value.getTime() + (OAUTH_STATE_TTL_SECONDS + 1) * 1000);
    // The memory ledger's own clock is real time, so expire by re-issuing with a zero ttl.
    await h.ledger.putOAuthState("old-state", h.workspaceId, "square", -1);
    expect(location(await finishOAuth(h.deps, { code: "good-code", state: "old-state", cookieWorkspaceId: h.workspaceId })).search).toBe("?square=error&reason=state");
    expect(h.fake.calls.filter((c) => c.path === "/oauth2/token")).toHaveLength(0);
    void state;
  });

  it("rejects a state replayed from a different browser session (CSRF)", async () => {
    const { h, state } = await start();
    const res = await finishOAuth(h.deps, { code: "good-code", state, cookieWorkspaceId: "ws_attacker" });
    expect(location(res).search).toBe("?square=error&reason=state");
    expect(h.fake.calls.filter((c) => c.path === "/oauth2/token")).toHaveLength(0);
    expect(await h.ledger.getConnection(h.workspaceId, "square")).toBeNull();
    // and with no cookie at all
    const { h: h2, state: s2 } = await start();
    expect(location(await finishOAuth(h2.deps, { code: "good-code", state: s2, cookieWorkspaceId: null })).search).toBe("?square=error&reason=state");
  });

  it("the owner pressing Deny returns reason=denied and connects nothing", async () => {
    const { h, state } = await start();
    const res = await finishOAuth(h.deps, { error: "access_denied", state, cookieWorkspaceId: h.workspaceId });
    expect(location(res).search).toBe("?square=error&reason=denied");
    expect(await h.ledger.getConnection(h.workspaceId, "square")).toBeNull();
  });

  it("a rejected code ends in reason=exchange, with no Square error text in the URL and nothing stored", async () => {
    const { h, state } = await start();
    const res = await finishOAuth(h.deps, { code: "bad-code", state, cookieWorkspaceId: h.workspaceId });
    expect(location(res).search).toBe("?square=error&reason=exchange");
    expect(await h.ledger.getConnection(h.workspaceId, "square")).toBeNull();
  });
});

describe("token refresh and disconnect", () => {
  it("refreshes a token that expires within a day and stores the new one encrypted", async () => {
    const { h, state } = await (async () => { const h = await harness(); return { h, state: stateOf(await startOAuth(h.deps, h.workspaceId)) }; })();
    await finishOAuth(h.deps, { code: "good-code", state, cookieWorkspaceId: h.workspaceId });
    h.now.value = new Date("2026-11-30T00:00:00Z"); // the stored token expires at exactly this time
    const { importFromSquare } = await import("./sync");
    await importFromSquare(h.deps, h.workspaceId, { reason: "sync" });
    expect(h.fake.tokens.refreshed).toBe(1);
    const stored = (await h.ledger.getConnection(h.workspaceId, "square"))!;
    expect(await decryptToken(stored.tokenEnc!, h.workspaceId, h.deps.config.tokenKey)).toBe("oauth-access-2");
    expect(h.fake.calls.filter((c) => c.path === "/v2/catalog/search").pop()?.headers.authorization).toBe("Bearer oauth-access-2");
  });

  it("a failed refresh marks the connection as errored, in plain words", async () => {
    const h = await harness();
    const state = stateOf(await startOAuth(h.deps, h.workspaceId));
    await finishOAuth(h.deps, { code: "good-code", state, cookieWorkspaceId: h.workspaceId });
    h.now.value = new Date("2026-11-30T00:00:00Z");
    h.fake.failNext.set("/oauth2/token", 401);
    const { importFromSquare } = await import("./sync");
    await expect(importFromSquare(h.deps, h.workspaceId, { reason: "sync" })).rejects.toBeTruthy();
    const status = await squareStatus(h.deps, h.workspaceId);
    expect(status.connection.status).toBe("error");
    expect(status.connection.error).toMatch(/Reconnect Square/);
  });

  it("disconnect revokes at Square and forgets the connection and its locations", async () => {
    const h = await harness();
    const state = stateOf(await startOAuth(h.deps, h.workspaceId));
    await finishOAuth(h.deps, { code: "good-code", state, cookieWorkspaceId: h.workspaceId });
    await disconnectSquare(h.deps, h.workspaceId);
    expect(h.fake.calls.some((c) => c.path === "/oauth2/revoke")).toBe(true);
    expect(await h.ledger.getConnection(h.workspaceId, "square")).toBeNull();
    expect(await h.ledger.listLocationLinks(h.workspaceId)).toEqual([]);
  });
});
