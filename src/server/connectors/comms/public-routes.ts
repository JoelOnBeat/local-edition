import { apiError, errorResponse, readLimited } from "../../http/api";
import { HttpError } from "../../http/errors";
import { runInBackground } from "../../jobs/background";
import { createLogger } from "../../log";
import { handleInteraction, parseInteraction } from "../slack/interactions";
import { completeInstall } from "../slack/install";
import { verifySlackSignature } from "../slack/verify";
import { completeMailConnect } from "../mail/connect";
import { handleComposioEvent, verifyComposioWebhook } from "../mail/webhook";
import { liveCommsDeps } from "./deps";

const log = createLogger("comms:routes");

/** Routes with no workspace cookie: they authenticate by signature (Slack, Composio) or by signed state (OAuth callbacks). */

const BODY_LIMIT = 256 * 1024;
const redirect = (location: string): Response => new Response(null, { status: 302, headers: { location, "cache-control": "no-store" } });

/** Slack interactivity. Verified over the exact bytes, answered inside 3 seconds, applied in the background. */
export async function slackInteractionsHandler(request: Request): Promise<Response> {
  try {
    const bytes = await readLimited(request, BODY_LIMIT);
    const rawBody = new TextDecoder().decode(bytes);
    const deps = await liveCommsDeps();
    const verdict = await verifySlackSignature({
      rawBody, signature: request.headers.get("x-slack-signature"), timestamp: request.headers.get("x-slack-request-timestamp"), signingSecret: deps.env.slackSigningSecret,
    });
    if (!verdict.ok) {
      if (verdict.reason === "no_secret") return apiError(503, "slack_not_configured", "Slack interactivity is not configured on this server.");
      return apiError(401, "bad_signature", "The request signature is not valid.");
    }
    const payload = parseInteraction(rawBody);
    if (payload) runInBackground(handleInteraction(deps, payload));
    return new Response(null, { status: 200 });
  } catch (e) {
    return errorResponse(e);
  }
}

/** Slack's OAuth redirect. Always ends on the connections page, with `?connected=slack` or `?error=...`. */
export async function slackCallbackHandler(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const deps = await liveCommsDeps();
  const back = (query: string) => redirect(`${deps.env.appUrl}/app/connections?${query}`);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (url.searchParams.get("error") || !code || !state) return back("error=slack_denied");
  try {
    await completeInstall(deps, { code, state });
    return back("connected=slack");
  } catch (e) {
    log.warn("slack install failed", { err: e });
    return back(`error=${e instanceof HttpError ? e.code : "slack_failed"}`);
  }
}

/** Composio redirects here after the consent screen (Gmail or Outlook). */
export async function mailCallbackHandler(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const deps = await liveCommsDeps();
  const back = (query: string) => redirect(`${deps.env.appUrl}/app/connections?${query}`);
  const state = url.searchParams.get("state");
  if (!state || url.searchParams.get("status") === "failed") return back("error=mail_denied");
  try {
    const { provider } = await completeMailConnect(deps, state);
    return back(`connected=${provider}`);
  } catch (e) {
    log.warn("mail connect failed", { err: e });
    return back(`error=${e instanceof HttpError ? e.code : "mail_failed"}`);
  }
}

/** Composio trigger events (new mail in a connected mailbox). */
export async function mailWebhookHandler(request: Request): Promise<Response> {
  try {
    const rawBody = new TextDecoder().decode(await readLimited(request, BODY_LIMIT));
    const deps = await liveCommsDeps();
    const verdict = await verifyComposioWebhook({
      rawBody, id: request.headers.get("webhook-id"), timestamp: request.headers.get("webhook-timestamp"), signature: request.headers.get("webhook-signature"), secret: deps.env.composioWebhookSecret,
    });
    if (!verdict.ok) {
      if (verdict.reason === "no_secret") return apiError(503, "webhook_not_configured", "The mail webhook is not configured on this server.");
      return apiError(401, "bad_signature", "The request signature is not valid.");
    }
    runInBackground(handleComposioEvent(deps, rawBody));
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
