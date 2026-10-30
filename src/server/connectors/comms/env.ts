/**
 * Secrets and settings for the Slack and mail connectors, read from process.env (Worker secrets and vars are copied there).
 * Every field is optional: a missing one makes that feature report "not configured" instead of crashing other routes.
 *   SLACK_BOT_TOKEN        sample chain's bot token (xoxb-...)        SLACK_SIGNING_SECRET   verifies interactivity requests
 *   SLACK_CLIENT_ID/SECRET OAuth install for real chains               COMPOSIO_API_KEY       Composio (Gmail, Outlook)
 *   COMPOSIO_WEBHOOK_SECRET verifies Composio webhooks                 COMPOSIO_AUTH_CONFIG_GMAIL / _OUTLOOK  auth config ids (local-edition-gmail / -outlook)
 *   COMMS_ENC_KEY          encrypts Slack tokens at rest               APP_URL                public base URL
 *   COMMS_SAMPLE_MANAGER_EMAIL  every sample-chain store card goes here (a test inbox), never to invented addresses
 */
export interface CommsEnv {
  slackBotToken?: string;
  slackSigningSecret?: string;
  slackClientId?: string;
  slackClientSecret?: string;
  composioApiKey?: string;
  composioWebhookSecret?: string;
  authConfigGmail?: string;
  authConfigOutlook?: string;
  encKey?: string;
  appUrl: string;
  sampleManagerEmail?: string;
  /** Sample chain's connected mailbox in Composio (connected account id), used when the visitor has none of their own. */
  sampleGmailAccount?: string;
  sampleHeadOfficeChannel: string;
}

const val = (v: string | undefined): string | undefined => (v && v.trim() !== "" ? v.trim() : undefined);

export function commsEnv(source: Record<string, string | undefined> = process.env): CommsEnv {
  return {
    slackBotToken: val(source.SLACK_BOT_TOKEN),
    slackSigningSecret: val(source.SLACK_SIGNING_SECRET),
    slackClientId: val(source.SLACK_CLIENT_ID),
    slackClientSecret: val(source.SLACK_CLIENT_SECRET),
    composioApiKey: val(source.COMPOSIO_API_KEY),
    composioWebhookSecret: val(source.COMPOSIO_WEBHOOK_SECRET),
    authConfigGmail: val(source.COMPOSIO_AUTH_CONFIG_GMAIL),
    authConfigOutlook: val(source.COMPOSIO_AUTH_CONFIG_OUTLOOK),
    encKey: val(source.COMMS_ENC_KEY),
    appUrl: (val(source.APP_URL) ?? "https://localedition.pages.dev").replace(/\/+$/, ""),
    sampleManagerEmail: val(source.COMMS_SAMPLE_MANAGER_EMAIL),
    sampleGmailAccount: val(source.COMPOSIO_SAMPLE_GMAIL_ACCOUNT),
    sampleHeadOfficeChannel: val(source.SLACK_HEAD_OFFICE_CHANNEL) ?? "head-office",
  };
}
