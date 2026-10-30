import { HttpError } from "../../http/errors";
import { encryptToken, signState, verifyState } from "../comms/crypto";
import type { CommsDeps } from "../comms/deps";
import { recordEvent } from "../comms/events";
import { exchangeCode, findChannelId } from "./api";

export const SLACK_SCOPES = "chat:write,chat:write.public,channels:read";
const STATE_TTL_MS = 10 * 60_000;

const stateSecret = (deps: CommsDeps): string => {
  const secret = deps.env.encKey ?? deps.env.slackSigningSecret;
  if (!secret) throw new HttpError(503, "config_error", "Slack install is not configured on the server.");
  return secret;
};

const redirectUri = (deps: CommsDeps): string => `${deps.env.appUrl}/api/connectors/slack/callback`;

/** The Slack authorize URL for this workspace. `state` is signed and expires in ten minutes, so the callback knows who is installing. */
export async function installUrl(deps: CommsDeps, workspaceId: string): Promise<string> {
  if (!deps.env.slackClientId || !deps.env.slackClientSecret) throw new HttpError(503, "slack_not_configured", "Slack install is not set up on this server yet.");
  const nonce = crypto.randomUUID();
  const state = await signState({ w: workspaceId, n: nonce, exp: deps.now().getTime() + STATE_TTL_MS }, stateSecret(deps));
  const params = new URLSearchParams({ client_id: deps.env.slackClientId, scope: SLACK_SCOPES, redirect_uri: redirectUri(deps), state });
  return `https://slack.com/oauth/v2/authorize?${params.toString()}`;
}

/** Exchanges the code, seals the bot token for this workspace and saves the install. Returns the workspace id it belongs to. */
export async function completeInstall(deps: CommsDeps, input: { code: string; state: string }): Promise<string> {
  const claims = await verifyState<{ w: string; n: string }>(input.state, stateSecret(deps), deps.now().getTime());
  if (!claims || typeof claims.w !== "string" || typeof claims.n !== "string") throw new HttpError(400, "bad_state", "This Slack install link expired. Start again from the connections page.");
  if (!(await deps.store.claim(`slack-oauth:${claims.n}`, deps.now().getTime()))) throw new HttpError(400, "state_used", "This Slack install link was already used.");
  if (!deps.env.slackClientId || !deps.env.slackClientSecret || !deps.env.encKey) throw new HttpError(503, "slack_not_configured", "Slack install is not set up on this server yet.");
  const access = await exchangeCode({ clientId: deps.env.slackClientId, clientSecret: deps.env.slackClientSecret, code: input.code, redirectUri: redirectUri(deps) }, deps.fetchImpl);
  // channels:read lets us say so now, rather than at the first digest, when #head-office does not exist (the bot cannot create channels).
  const channelId = await findChannelId(access.access_token, deps.env.sampleHeadOfficeChannel, deps.fetchImpl).catch(() => "unknown");
  await deps.store.putSlackInstall({
    workspaceId: claims.w,
    teamId: access.team.id,
    teamName: access.team.name ?? null,
    botTokenSealed: await encryptToken(access.access_token, deps.env.encKey, claims.w),
    headOfficeChannel: deps.env.sampleHeadOfficeChannel,
    source: "oauth",
    createdAt: deps.now().toISOString(),
    lastSyncAt: null,
    error: channelId === null ? `Slack is connected, but there is no #${deps.env.sampleHeadOfficeChannel} channel yet. Create it in Slack and the next digest will post there.` : null,
  });
  await recordEvent(deps.store, claims.w, { provider: "slack", direction: "in", kind: "connection.connected", summary: `Slack workspace ${access.team.name ?? access.team.id} connected.`, storeId: null, editionId: null, ok: true });
  return claims.w;
}
