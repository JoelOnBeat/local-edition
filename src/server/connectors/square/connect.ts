import type { Connection, SquareStatus } from "@/contract";
import { SQUARE_RETURN_PATH } from "@/contract";
import { HttpError } from "../../http/errors";
import { createLogger } from "../../log";
import { decryptToken, encryptToken, randomToken } from "../crypto";
import type { StoredConnection } from "../ledger";
import { SquareClient, obtainToken, revokeToken } from "./client";
import { baseUrl, requireOAuthApp, requireSandboxToken, SQUARE_OAUTH_SCOPES } from "./config";
import { PROVIDER, recordEvent, type SquareDeps } from "./deps";
import { importFromSquare } from "./sync";

const log = createLogger("square-connect");
export const OAUTH_STATE_TTL_SECONDS = 600;

const CAPABILITIES = ["Reads the menu and locations", "Updates within seconds of a change in Square", "Publishes approved specials to the store's location"];

const emptyConnection = (): Connection => ({ provider: PROVIDER, status: "not_connected", mode: null, accountLabel: null, connectedAt: null, lastSyncAt: null, error: null, capabilities: CAPABILITIES });

export async function squareStatus(deps: SquareDeps, workspaceId: string): Promise<SquareStatus> {
  const stored = await deps.ledger.getConnection(workspaceId, PROVIDER);
  const workspace = await deps.repo.getWorkspace(workspaceId);
  const stores = workspace ? await deps.repo.listStores(workspace.chainId) : [];
  const links = await deps.ledger.listLocationLinks(workspaceId);
  const menu = workspace ? await deps.repo.listMenu(workspace.chainId) : [];
  return {
    connection: stored?.connection ?? emptyConnection(),
    merchantId: stored?.merchantId ?? null,
    sandboxAvailable: Boolean(deps.config.sandboxToken),
    oauthAvailable: Boolean(deps.config.appId && deps.config.appSecret && deps.config.tokenKey),
    locations: links.map((l) => ({ locationId: l.locationId, locationName: l.name, storeId: l.storeId, storeName: stores.find((s) => s.id === l.storeId)?.name ?? null })),
    menuItemCount: stored ? menu.length : 0,
    lastWebhookAt: stored?.meta.lastWebhookAt ?? null,
    lastCatalogChangeAt: stored?.meta.lastCatalogChangeAt ?? null,
    events: await deps.ledger.listEvents(workspaceId, PROVIDER, 20),
  };
}

/** The sample chain: connect with the server-held sandbox token and import. */
export async function connectSandbox(deps: SquareDeps, workspaceId: string) {
  const token = requireSandboxToken(deps.config);
  const workspace = await deps.repo.getWorkspace(workspaceId);
  const chain = workspace ? await deps.repo.getChain(workspace.chainId) : null;
  if (!chain) throw new HttpError(404, "not_found", "Workspace not found.");
  const merchant = await new SquareClient({ accessToken: token, env: "sandbox", mode: deps.config.mode, fetchImpl: deps.fetchImpl }).merchant();
  const now = deps.now().toISOString();
  const stored: StoredConnection = {
    connection: { ...emptyConnection(), status: "connected", mode: "sandbox", accountLabel: `${chain.name} · Square sandbox`, connectedAt: now },
    merchantId: merchant.id, tokenEnc: null, refreshEnc: null, tokenExpiresAt: null, meta: {},
  };
  await deps.ledger.putConnection(workspaceId, PROVIDER, stored);
  await recordEvent(deps, workspaceId, { direction: "in", kind: "connection.created", summary: `Connected ${chain.name} to Square sandbox.` });
  return importFromSquare(deps, workspaceId, { reason: "connect" });
}

/** OAuth, step 1: a one-use `state` bound to the workspace, then the Square authorize URL. */
export async function startOAuth(deps: SquareDeps, workspaceId: string): Promise<string> {
  const app = requireOAuthApp(deps.config);
  await encryptToken("probe", workspaceId, deps.config.tokenKey); // 503 now if the key is unusable, not after the owner has approved at Square
  const state = randomToken(24);
  await deps.ledger.putOAuthState(state, workspaceId, PROVIDER, OAUTH_STATE_TTL_SECONDS);
  const url = new URL(`${baseUrl(deps.config.oauthEnv)}/oauth2/authorize`);
  url.searchParams.set("client_id", app.appId);
  url.searchParams.set("scope", SQUARE_OAUTH_SCOPES.join(" "));
  url.searchParams.set("session", "false");
  url.searchParams.set("state", state);
  return url.toString();
}

const back = (deps: SquareDeps, query: string): Response => Response.redirect(`${deps.config.appUrl}${SQUARE_RETURN_PATH}?${query}`, 302);

/**
 * OAuth, step 2. Square returns the browser here with `code` and `state`. The state must be one we issued, unexpired and unused, and
 * the browser's workspace cookie must be the workspace it was issued to; only then is the code exchanged. Always answers with a redirect to
 * /app/connections (?square=connected, or ?square=error&reason=<code>); no token or Square error text reaches the URL.
 */
export async function finishOAuth(
  deps: SquareDeps,
  input: { code?: string; state?: string; error?: string; cookieWorkspaceId: string | null },
): Promise<Response> {
  if (!input.state) return back(deps, "square=error&reason=state");
  const workspaceId = await deps.ledger.consumeOAuthState(input.state, PROVIDER); // single use: consumed even when the rest fails
  if (!workspaceId || workspaceId !== input.cookieWorkspaceId) return back(deps, "square=error&reason=state");
  if (input.error) return back(deps, "square=error&reason=denied");
  if (!input.code) return back(deps, "square=error&reason=code");
  try {
    const app = requireOAuthApp(deps.config);
    const env = deps.config.oauthEnv;
    const token = await obtainToken({ env, mode: deps.config.mode, fetchImpl: deps.fetchImpl }, {
      client_id: app.appId, client_secret: app.appSecret, code: input.code, grant_type: "authorization_code",
    });
    const merchant = await new SquareClient({ accessToken: token.access_token, env, mode: deps.config.mode, fetchImpl: deps.fetchImpl }).merchant();
    const stored: StoredConnection = {
      connection: { ...emptyConnection(), status: "connected", mode: env, accountLabel: merchant.businessName ?? "Square account", connectedAt: deps.now().toISOString() },
      merchantId: token.merchant_id ?? merchant.id,
      tokenEnc: await encryptToken(token.access_token, workspaceId, deps.config.tokenKey),
      refreshEnc: token.refresh_token ? await encryptToken(token.refresh_token, workspaceId, deps.config.tokenKey) : null,
      tokenExpiresAt: token.expires_at ?? null,
      meta: {},
    };
    await deps.ledger.putConnection(workspaceId, PROVIDER, stored);
    await recordEvent(deps, workspaceId, { direction: "in", kind: "connection.created", summary: `Connected ${stored.connection.accountLabel} to Square.` });
    await importFromSquare(deps, workspaceId, { reason: "connect" });
    return back(deps, "square=connected");
  } catch (e) {
    log.warn("square oauth failed", { code: e instanceof HttpError ? e.code : (e as Error).name });
    await recordEvent(deps, workspaceId, { direction: "in", kind: "connection.failed", summary: "Square did not complete the connection.", ok: false }).catch(() => undefined);
    return back(deps, "square=error&reason=exchange");
  }
}

/** Forgets the connection and its tokens (revoked at Square for OAuth chains). The imported menu and stores stay. */
export async function disconnectSquare(deps: SquareDeps, workspaceId: string): Promise<void> {
  const stored = await deps.ledger.getConnection(workspaceId, PROVIDER);
  if (!stored) return;
  if (stored.tokenEnc && deps.config.appId && deps.config.appSecret) {
    try {
      await revokeToken({ env: stored.connection.mode ?? "production", mode: deps.config.mode, fetchImpl: deps.fetchImpl }, { appId: deps.config.appId, appSecret: deps.config.appSecret }, await decryptToken(stored.tokenEnc, workspaceId, deps.config.tokenKey));
    } catch (e) {
      log.warn("square revoke failed", { err: (e as Error).name }); // the local copy is removed regardless
    }
  }
  await deps.ledger.deleteConnection(workspaceId, PROVIDER);
  await deps.ledger.replaceLocationLinks(workspaceId, []);
}
