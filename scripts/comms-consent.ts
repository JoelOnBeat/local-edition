/**
 * Creates a Composio consent link for the sample chain's head-office mailbox (Gmail or Outlook), or checks that it went ACTIVE.
 *
 *   npx tsx scripts/comms-consent.ts link gmail|outlook      prints the consent URL and the connected-account id
 *   npx tsx scripts/comms-consent.ts status <connected_account_id>
 *   npx tsx scripts/comms-consent.ts trigger gmail|outlook <connected_account_id>   real-time new-mail trigger, delivered to our webhook only (egress_url)
 *
 * Environment (never printed): COMPOSIO_API_KEY, COMPOSIO_AUTH_CONFIG_GMAIL / COMPOSIO_AUTH_CONFIG_OUTLOOK, optional COMPOSIO_SAMPLE_USER_ID (default le-sample),
 * APP_URL. The connected-account id is not a secret; it becomes the COMPOSIO_SAMPLE_GMAIL_ACCOUNT variable.
 */
const BASE = "https://backend.composio.dev/api/v3.1";
const key = process.env.COMPOSIO_API_KEY;
if (!key) throw new Error("COMPOSIO_API_KEY is not set.");

async function call(path: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  const res = await fetch(`${BASE}${path}`, { ...init, headers: { "x-api-key": key as string, "content-type": "application/json" } });
  if (!res.ok) throw new Error(`Composio answered ${res.status} for ${path}`);
  return (await res.json()) as Record<string, unknown>;
}

async function main(): Promise<void> {
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === "link" && (arg === "gmail" || arg === "outlook")) {
    const authConfig = arg === "gmail" ? process.env.COMPOSIO_AUTH_CONFIG_GMAIL : process.env.COMPOSIO_AUTH_CONFIG_OUTLOOK;
    if (!authConfig) throw new Error(`COMPOSIO_AUTH_CONFIG_${arg.toUpperCase()} is not set.`);
    const appUrl = (process.env.APP_URL ?? "https://localedition.pages.dev").replace(/\/+$/, "");
    const out = await call("/connected_accounts/link", {
      method: "POST",
      body: JSON.stringify({ auth_config_id: authConfig, user_id: process.env.COMPOSIO_SAMPLE_USER_ID ?? "le-sample", alias: `local-edition-sample-${arg}`, callback_url: `${appUrl}/app/connections?connected=${arg}` }),
    });
    process.stdout.write(`consent_url=${String(out.redirect_url)}\nconnected_account_id=${String(out.connected_account_id)}\nexpires_at=${String(out.expires_at)}\n`);
  } else if (cmd === "status" && arg) {
    const out = (await call(`/connected_accounts/${encodeURIComponent(arg)}`)) as { id?: string; status?: string; toolkit?: { slug?: string } };
    process.stdout.write(`id=${out.id}\ntoolkit=${out.toolkit?.slug}\nstatus=${out.status}\n`); // the rest of the response holds OAuth state: never printed
  } else if (cmd === "trigger" && (arg === "gmail" || arg === "outlook") && process.argv[4]) {
    const appUrl = (process.env.APP_URL ?? "https://localedition.pages.dev").replace(/\/+$/, "");
    const slug = arg === "gmail" ? "GMAIL_NEW_GMAIL_MESSAGE" : "OUTLOOK_MESSAGE_TRIGGER";
    const out = await call(`/trigger_instances/${slug}/upsert`, {
      method: "POST",
      body: JSON.stringify({
        user_id: process.env.COMPOSIO_SAMPLE_USER_ID ?? "le-sample", connected_account_id: process.argv[4], egress_url: `${appUrl}/api/connectors/mail/webhook`,
        trigger_config: arg === "gmail" ? { interval: 1, labelIds: "INBOX", userId: "me" } : { folder_id: "inbox" },
      }),
    });
    process.stdout.write(`trigger_id=${String(out.trigger_id)}\n`);
  } else {
    process.stderr.write("usage: comms-consent.ts link gmail|outlook | status <connected_account_id> | trigger gmail|outlook <connected_account_id>\n");
    process.exit(2);
  }
}

main().catch((e: unknown) => {
  process.stderr.write(`${e instanceof Error ? e.message : "failed"}\n`);
  process.exit(1);
});
