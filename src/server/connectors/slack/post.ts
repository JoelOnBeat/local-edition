import type { CommsDeps } from "../comms/deps";
import { postMessage, postWebhook, type SlackMessage } from "./api";
import type { SlackBinding } from "./binding";

/** One message out: through the bot token (we learn its channel id and ts, so it can be edited later) or, as the fallback, the incoming webhook. */
export async function sendMessage(deps: CommsDeps, binding: SlackBinding, msg: SlackMessage): Promise<{ channel: string | null; ts: string | null }> {
  if (binding.token) return postMessage(binding.token, msg, deps.fetchImpl);
  if (!binding.webhookUrl) throw new Error("no Slack credentials");
  const { channel: _channel, ...rest } = msg;
  void _channel;
  await postWebhook(binding.webhookUrl, rest, deps.fetchImpl);
  return { channel: null, ts: null };
}
