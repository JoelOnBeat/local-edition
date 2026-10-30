import type { ConnectorProvider, SyncEvent } from "@/contract";
import { newId } from "@/lib/ids";
import { HttpError } from "../../http/errors";
import { getRepo, type Repo } from "../../store";
import { decryptToken, encryptToken } from "../crypto";
import { getLedger, type ConnectorLedger, type StoredConnection } from "../ledger";
import { SquareClient, obtainToken } from "./client";
import { readSquareConfig, requireOAuthApp, requireSandboxToken, type SquareConfig } from "./config";

/** Everything the Square code needs, injectable so tests run on a memory repo, a memory ledger and a fake fetch. */
export interface SquareDeps {
  ledger: ConnectorLedger;
  repo: Repo;
  config: SquareConfig;
  fetchImpl?: typeof fetch;
  now: () => Date;
}

export async function squareDeps(overrides: Partial<SquareDeps> = {}): Promise<SquareDeps> {
  return {
    ledger: overrides.ledger ?? (await getLedger()),
    repo: overrides.repo ?? (await getRepo()),
    config: overrides.config ?? readSquareConfig(),
    fetchImpl: overrides.fetchImpl,
    now: overrides.now ?? (() => new Date()),
  };
}

export const PROVIDER: ConnectorProvider = "square";
const REFRESH_WITHIN_MS = 24 * 3600_000;

export async function recordEvent(
  deps: SquareDeps,
  workspaceId: string,
  e: Pick<SyncEvent, "direction" | "kind" | "summary"> & Partial<Pick<SyncEvent, "storeId" | "editionId" | "ok">>,
): Promise<void> {
  await deps.ledger.addEvent(workspaceId, { id: newId("sync"), provider: PROVIDER, at: deps.now().toISOString(), storeId: null, editionId: null, ok: true, ...e });
}

/**
 * A client holding the workspace's token. The sample chain (no stored token) uses the server-held sandbox token; an OAuth chain's
 * token is decrypted, and refreshed first when it expires within a day (a refresh that fails marks the connection as errored).
 */
export async function squareClientFor(deps: SquareDeps, workspaceId: string, stored: StoredConnection): Promise<SquareClient> {
  const env = stored.connection.mode ?? "sandbox";
  const common = { env, mode: deps.config.mode, fetchImpl: deps.fetchImpl };
  if (!stored.tokenEnc) return new SquareClient({ ...common, accessToken: requireSandboxToken(deps.config) });

  let access = await decryptToken(stored.tokenEnc, workspaceId, deps.config.tokenKey);
  const expires = stored.tokenExpiresAt ? Date.parse(stored.tokenExpiresAt) : Number.POSITIVE_INFINITY;
  if (stored.refreshEnc && expires - deps.now().getTime() < REFRESH_WITHIN_MS) {
    const app = requireOAuthApp(deps.config);
    try {
      const fresh = await obtainToken(
        { env, mode: deps.config.mode, fetchImpl: deps.fetchImpl },
        { client_id: app.appId, client_secret: app.appSecret, grant_type: "refresh_token", refresh_token: await decryptToken(stored.refreshEnc, workspaceId, deps.config.tokenKey) },
      );
      access = fresh.access_token;
      stored.tokenEnc = await encryptToken(fresh.access_token, workspaceId, deps.config.tokenKey);
      if (fresh.refresh_token) stored.refreshEnc = await encryptToken(fresh.refresh_token, workspaceId, deps.config.tokenKey);
      stored.tokenExpiresAt = fresh.expires_at ?? null;
      await deps.ledger.putConnection(workspaceId, PROVIDER, stored);
    } catch (e) {
      stored.connection = { ...stored.connection, status: "error", error: "Square stopped accepting our access. Reconnect Square to keep the menu in sync." };
      await deps.ledger.putConnection(workspaceId, PROVIDER, stored);
      await recordEvent(deps, workspaceId, { direction: "in", kind: "token.refresh_failed", summary: "Square would not renew our access; the chain needs to reconnect.", ok: false });
      throw e instanceof HttpError ? e : new HttpError(502, "square_token_refresh_failed", "Square would not renew our access. Reconnect Square.");
    }
  }
  return new SquareClient({ ...common, accessToken: access });
}
