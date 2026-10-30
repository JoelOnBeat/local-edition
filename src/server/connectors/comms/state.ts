import type { Connection } from "@/contract/connectors";
import type { CommsState } from "@/contract/connectors-comms";
import type { CommsDeps } from "./deps";
import { resolveTarget } from "./events";

const SLACK_CAPS = ["Posts the weekly digest to #head-office with Approve and Regenerate buttons", "Posts each approved staff card to its store channel"];
const MAIL_CAPS = ["Emails each store manager their staff card from head office's mailbox", "Reads their replies and files them next to the edition"];

/** Everything the connections page and the edition page read from this lane. Never includes a token. */
export async function buildCommsState(deps: CommsDeps, workspaceId: string): Promise<CommsState> {
  const workspace = await deps.repo.getWorkspace(workspaceId);
  const chain = workspace ? await deps.repo.getChain(workspace.chainId) : null;
  const stores = chain ? await deps.repo.listStores(chain.id) : [];
  const isSample = chain?.isSample ?? false;

  const slack = await deps.store.getSlackInstall(workspaceId);
  const sampleSlack = !slack && isSample && !!deps.env.slackBotToken;
  const slackConn: Connection = slack
    ? {
        provider: "slack", status: slack.error ? "error" : "connected", mode: slack.source === "oauth" ? "production" : "sandbox",
        accountLabel: `${slack.teamName ?? slack.teamId} · #${slack.headOfficeChannel}`, connectedAt: slack.createdAt, lastSyncAt: slack.lastSyncAt, error: slack.error, capabilities: SLACK_CAPS,
      }
    : {
        provider: "slack", status: sampleSlack ? "connected" : "not_connected", mode: sampleSlack ? "sandbox" : null,
        accountLabel: sampleSlack ? `Sample Slack workspace · #${deps.env.sampleHeadOfficeChannel}` : null, connectedAt: null, lastSyncAt: null, error: null, capabilities: SLACK_CAPS,
      };

  const mailConn = async (provider: "gmail" | "outlook"): Promise<Connection> => {
    const row = await deps.store.getMailConn(workspaceId, provider);
    const name = provider === "gmail" ? "Gmail" : "Outlook";
    const sample = !row && provider === "gmail" && isSample && !!deps.env.sampleGmailAccount;
    return {
      provider,
      status: row ? (row.error ? "error" : row.status === "active" ? "connected" : "connecting") : sample ? "connected" : "not_connected",
      mode: row ? "production" : sample ? "sandbox" : null,
      accountLabel: row?.accountLabel ?? (sample ? "Sample head-office mailbox" : null),
      connectedAt: row?.status === "active" ? row.createdAt : null,
      lastSyncAt: row?.lastSyncAt ?? null,
      error: row?.error ?? null,
      capabilities: provider === "gmail" ? MAIL_CAPS : [`Same as Gmail, from an ${name} mailbox`],
    };
  };

  const saved = await deps.store.listTargets(workspaceId);
  const targets = chain ? stores.map((s) => resolveTarget(s, chain, saved, deps.env)) : [];
  return {
    connections: [slackConn, await mailConn("gmail"), await mailConn("outlook")],
    events: await deps.store.listEvents(workspaceId, 30),
    targets,
    deliveries: await deps.store.listDeliveries(workspaceId),
    notes: await deps.store.listNotes(workspaceId),
    suggestions: (await deps.store.listSuggestions(workspaceId)).filter((s) => s.status === "open"),
  };
}
