import { decryptToken } from "../comms/crypto";
import type { CommsDeps } from "../comms/deps";
import { recordEvent } from "../comms/events";
import type { SlackInstallRow } from "../comms/store";
import { authTest, SlackApiError } from "./api";

/** The Slack credentials a workspace posts with: its own OAuth install, or (sample chain only) the server's bot-token secret. */
export interface SlackBinding {
  token: string;
  install: SlackInstallRow;
}

export async function getBinding(deps: CommsDeps, workspaceId: string, isSample: boolean): Promise<SlackBinding | null> {
  let install = await deps.store.getSlackInstall(workspaceId);
  if (install?.botTokenSealed) {
    if (!deps.env.encKey) return null;
    try {
      return { token: await decryptToken(install.botTokenSealed, deps.env.encKey, workspaceId), install };
    } catch {
      await markError(deps, workspaceId, install, "The stored Slack token could not be read. Reconnect Slack.");
      return null;
    }
  }
  if (install?.source === "bot_token_secret" && deps.env.slackBotToken) return { token: deps.env.slackBotToken, install };
  if (!install && isSample && deps.env.slackBotToken) {
    // First use by a sample workspace: learn which Slack workspace the secret belongs to, so clicks can be checked against it.
    const team = await authTest(deps.env.slackBotToken, deps.fetchImpl).catch(() => null);
    if (!team) return null;
    install = {
      workspaceId, teamId: team.teamId, teamName: team.teamName, botTokenSealed: null, headOfficeChannel: deps.env.sampleHeadOfficeChannel,
      source: "bot_token_secret", createdAt: deps.now().toISOString(), lastSyncAt: null, error: null,
    };
    await deps.store.putSlackInstall(install);
    return { token: deps.env.slackBotToken, install };
  }
  return null;
}

async function markError(deps: CommsDeps, workspaceId: string, install: SlackInstallRow, message: string): Promise<void> {
  await deps.store.putSlackInstall({ ...install, error: message });
  await recordEvent(deps.store, workspaceId, { provider: "slack", direction: "out", kind: "connection.error", summary: message, storeId: null, editionId: null, ok: false });
}

/** Turns a Slack failure into words for the connections page, and marks the install broken when the token is gone. */
export async function describeFailure(deps: CommsDeps, workspaceId: string, binding: SlackBinding, e: unknown, channel: string): Promise<string> {
  if (e instanceof SlackApiError) {
    if (e.kind === "revoked") {
      const text = "Slack access was revoked or the app was removed. Reconnect Slack to keep posting.";
      await markError(deps, workspaceId, binding.install, text);
      return text;
    }
    if (e.kind === "channel") return `#${channel} was not found or is archived. Create it in Slack, or choose another channel.`;
    return `Slack refused the message (${e.slackError}).`;
  }
  return "Could not reach Slack. It will be tried again on the next approval.";
}

export async function touchSync(deps: CommsDeps, binding: SlackBinding): Promise<void> {
  await deps.store.putSlackInstall({ ...binding.install, lastSyncAt: deps.now().toISOString(), error: null });
}
