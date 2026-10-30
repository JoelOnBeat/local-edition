/**
 * One-time Gmail consent for the sign-in code sender (CODE_SENDER=gmail), run on Gabriel's machine:
 *
 *   npx tsx scripts/gmail-consent.ts
 *
 * Reads LOCALEDITION_GMAIL_CLIENT_ID and LOCALEDITION_GMAIL_CLIENT_SECRET from the vault, prints a consent URL (scope gmail.send only), waits on
 * http://127.0.0.1:<port>/callback for Google's redirect, exchanges the code and pipes the refresh token into
 * ~/.claude/vault/scripts/set-keys.py LOCALEDITION_GMAIL_REFRESH_TOKEN. No token is ever printed or written to a file.
 * The OAuth client must be a Desktop app (loopback redirects allowed) or list the redirect URI printed below. Then:
 * scripts/deploy-secrets.sh pushes GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET and GMAIL_REFRESH_TOKEN to the Worker.
 * If the consent screen is in "Testing", Google expires the refresh token after 7 days: publish the app (send-only scope needs no review for one's own account).
 */
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import { consentUrl, exchangeCode, newPkce } from "./gmail/consent-lib";
import { secretGet } from "./square/lib";

const out = (line: string) => process.stdout.write(`${line}\n`);
const PORT = Number(process.env.GMAIL_CONSENT_PORT ?? 53682);
const SENDER = "defiusmaximus@gmail.com";

async function main(): Promise<number> {
  const held = secretGet(["LOCALEDITION_GMAIL_CLIENT_ID", "LOCALEDITION_GMAIL_CLIENT_SECRET"]);
  const clientId = held.LOCALEDITION_GMAIL_CLIENT_ID;
  const clientSecret = held.LOCALEDITION_GMAIL_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    out("LOCALEDITION_GMAIL_CLIENT_ID / LOCALEDITION_GMAIL_CLIENT_SECRET are not in the vault yet. Create a Desktop OAuth client in Google Cloud (Gmail API enabled) and store both.");
    return 2;
  }
  const redirectUri = `http://127.0.0.1:${PORT}/callback`;
  const state = randomBytes(16).toString("hex");
  const pkce = newPkce();

  const code = await new Promise<string | null>((resolve) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", redirectUri);
      if (url.pathname !== "/callback") {
        res.writeHead(404).end();
        return;
      }
      const ok = url.searchParams.get("state") === state && url.searchParams.get("code");
      res.writeHead(ok ? 200 : 400, { "content-type": "text/plain" }).end(ok ? "Done. You can close this tab." : "That request did not match this run. Close this tab and run the script again.");
      server.close();
      resolve(ok ? url.searchParams.get("code") : null);
    });
    server.listen(PORT, "127.0.0.1", () => {
      out(`Redirect URI: ${redirectUri}`);
      out("Open this link signed in as the sender mailbox and allow \"Send email on your behalf\":");
      out(consentUrl({ clientId, redirectUri, state, challenge: pkce.challenge, loginHint: SENDER }));
    });
    setTimeout(() => { server.close(); resolve(null); }, 10 * 60_000).unref();
  });
  if (!code) {
    out("No valid consent came back (or ten minutes passed).");
    return 1;
  }
  const result = await exchangeCode({ clientId, clientSecret, code, redirectUri, verifier: pkce.verifier });
  if (!result.ok) {
    out(result.reason);
    return 1;
  }
  const stored = spawnSync(join(homedir(), ".claude", "vault", "scripts", "set-keys.py"), ["LOCALEDITION_GMAIL_REFRESH_TOKEN"], { input: `${result.refreshToken}\n`, stdio: ["pipe", "ignore", "ignore"] });
  out(stored.status === 0 ? "LOCALEDITION_GMAIL_REFRESH_TOKEN stored in the vault." : "Could not store the refresh token in the vault (nothing was printed or saved elsewhere).");
  return stored.status === 0 ? 0 : 1;
}

main().then((code) => process.exit(code));
