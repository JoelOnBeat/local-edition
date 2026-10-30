import type { MailProvider } from "@/contract/connectors-comms";
import { HttpError } from "../../http/errors";
import { signState, verifyState } from "../comms/crypto";
import type { CommsDeps } from "../comms/deps";
import { recordEvent } from "../comms/events";
import type { MailConnRow } from "../comms/store";
import { ComposioClient, COMPOSIO_TOOLS, COMPOSIO_TRIGGERS } from "./composio";

const STATE_TTL_MS = 30 * 60_000;

const secretOf = (deps: CommsDeps): string => {
  const s = deps.env.encKey ?? deps.env.slackSigningSecret ?? deps.env.composioWebhookSecret;
  if (!s) throw new HttpError(503, "config_error", "Email connection is not configured on the server.");
  return s;
};

function authConfigFor(deps: CommsDeps, provider: MailProvider): string {
  const id = provider === "gmail" ? deps.env.authConfigGmail : deps.env.authConfigOutlook;
  if (!id) throw new HttpError(503, "mail_not_configured", `${provider === "gmail" ? "Gmail" : "Outlook"} is not set up on this server yet.`);
  return id;
}

/**
 * Step 1: a Composio-managed OAuth consent link for the visitor's workspace (Composio user_id = workspace id). We keep only the connected-account
 * id, as a pending row; the OAuth tokens stay with Composio. The browser returns to /api/connectors/mail/callback with our signed state.
 */
export async function startMailConnect(deps: CommsDeps, workspaceId: string, provider: MailProvider, client?: ComposioClient): Promise<string> {
  const composio = client ?? new ComposioClient(deps.env.composioApiKey, deps.fetchImpl);
  const state = await signState({ w: workspaceId, p: provider, exp: deps.now().getTime() + STATE_TTL_MS }, secretOf(deps));
  const link = await composio.createLink({
    authConfigId: authConfigFor(deps, provider), userId: workspaceId,
    callbackUrl: `${deps.env.appUrl}/api/connectors/mail/callback?state=${encodeURIComponent(state)}&provider=${provider}`,
  });
  await deps.store.putMailConn({
    workspaceId, provider, connectedAccountId: link.connectedAccountId, status: "pending", accountLabel: null, triggerId: null,
    createdAt: deps.now().toISOString(), lastSyncAt: null, error: null,
  });
  return link.redirectUrl;
}

async function accountEmail(composio: ComposioClient, row: MailConnRow): Promise<string | null> {
  const slug = row.provider === "gmail" ? COMPOSIO_TOOLS.gmailProfile : COMPOSIO_TOOLS.outlookProfile;
  const r = await composio.execute(slug, { userId: row.workspaceId, connectedAccountId: row.connectedAccountId, arguments: {} }).catch(() => null);
  const data = (r?.data as { response_data?: Record<string, unknown> } | null)?.response_data;
  const email = data?.emailAddress ?? data?.mail ?? data?.userPrincipalName;
  return typeof email === "string" ? email : null;
}

/**
 * Step 2 (callback): the pending account must be the one we created for this signed state, and Composio must report it ACTIVE. The id in the
 * query string is never trusted. Then, if the Composio webhook secret is configured, the real-time trigger is created; without it the
 * connection works and replies are read by polling.
 */
export async function completeMailConnect(deps: CommsDeps, state: string, client?: ComposioClient): Promise<{ workspaceId: string; provider: MailProvider }> {
  const claims = await verifyState<{ w: string; p: string }>(state, secretOf(deps), deps.now().getTime());
  if (!claims || (claims.p !== "gmail" && claims.p !== "outlook")) throw new HttpError(400, "bad_state", "This connection link expired. Start again from the connections page.");
  const provider = claims.p as MailProvider;
  const pending = await deps.store.getMailConn(claims.w, provider);
  if (!pending) throw new HttpError(400, "no_pending", "No connection was waiting for this link.");
  const composio = client ?? new ComposioClient(deps.env.composioApiKey, deps.fetchImpl);
  const account = await composio.getAccount(pending.connectedAccountId);
  if (account.status !== "ACTIVE") throw new HttpError(409, "not_active", "The mailbox was not connected. Try again and finish the consent screen.");

  let row: MailConnRow = { ...pending, status: "active", accountLabel: await accountEmail(composio, pending), error: null };
  if (deps.env.composioWebhookSecret) {
    try {
      row = { ...row, triggerId: await composio.upsertTrigger(COMPOSIO_TRIGGERS[provider], {
        userId: row.workspaceId, connectedAccountId: row.connectedAccountId, egressUrl: `${deps.env.appUrl}/api/connectors/mail/webhook`,
        config: provider === "gmail" ? { interval: 1, labelIds: "INBOX", userId: "me" } : { folder_id: "inbox" },
      }) };
    } catch {
      row = { ...row, error: null }; // polling still reads replies; the connections page shows "checks replies on demand"
    }
  }
  await deps.store.putMailConn(row);
  await recordEvent(deps.store, row.workspaceId, { provider, direction: "in", kind: "connection.connected", summary: `${provider === "gmail" ? "Gmail" : "Outlook"} mailbox ${row.accountLabel ?? ""} connected.`.replace(/\s+\./, "."), storeId: null, editionId: null, ok: true });
  return { workspaceId: row.workspaceId, provider };
}
