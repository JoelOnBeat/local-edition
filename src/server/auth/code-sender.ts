import { createLogger } from "../log";

/**
 * How a one-time sign-in code reaches a person. `CODE_SENDER` picks the implementation:
 *   gmail  the Gmail API directly, from the persona's own mailbox (gmail-sender.ts). Needs GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET and
 *          GMAIL_REFRESH_TOKEN (scripts/gmail-consent.ts makes the refresh token).
 *   log    development and tests only: the message is kept in memory and read back with `takeOutbox`, never sent. Ignored in production.
 * Unset (or `log` in production) means no sender: `codeSignIn` is false and the password form stays the only way in.
 */

export interface CodeMessage {
  to: string;
  code: string;
  expiresInMinutes: number;
}

export type EmailFailure = "unconfigured" | "revoked" | "refused" | "unreachable";

/** The code could not be sent. `reason` is for logs and tests; the person only ever sees `email_unavailable`. */
export class EmailUnavailableError extends Error {
  constructor(readonly reason: EmailFailure, message = "The sign-in code could not be sent.") {
    super(message);
    this.name = "EmailUnavailableError";
  }
}

export interface CodeSender {
  readonly name: string;
  send(message: CodeMessage): Promise<void>;
}

const log = createLogger("auth:code");

/** The mail: plain, with the code first. Subject and sender name are fixed by the product, not by the caller. */
export const CODE_SUBJECT = "Your Local Edition sign-in code";
export const CODE_FROM_NAME = "Local Edition";

export function codeEmail(m: CodeMessage): { subject: string; text: string; html: string } {
  const text = [
    `Your sign-in code is ${m.code}`,
    "",
    `It works for ${m.expiresInMinutes} minutes and only once. If you did not ask for it, you can ignore this email.`,
    "",
  ].join("\n");
  const html = `<p>Your sign-in code is</p><p style="font-size:24px;letter-spacing:4px"><strong>${m.code}</strong></p><p>It works for ${m.expiresInMinutes} minutes and only once. If you did not ask for it, you can ignore this email.</p>`;
  return { subject: CODE_SUBJECT, text, html };
}

// ---- log sender (development and tests)

interface Outbox {
  messages: { to: string; code: string; at: number }[];
}
const slot = globalThis as typeof globalThis & { __leCodeOutbox?: Outbox; __leCodeSender?: CodeSender | null };

class LogSender implements CodeSender {
  readonly name = "log";
  async send(m: CodeMessage): Promise<void> {
    const box = (slot.__leCodeOutbox ??= { messages: [] });
    box.messages.push({ to: m.to, code: m.code, at: Date.now() });
    box.messages.splice(0, Math.max(0, box.messages.length - 50));
    log.info("sign-in code written to the dev outbox", { to: m.to });
  }
}

/** The newest code `log` kept for the address (and forgets it). Always undefined outside development and tests. */
export function takeOutbox(email: string): string | undefined {
  if (process.env.NODE_ENV === "production") return undefined;
  const box = slot.__leCodeOutbox;
  const at = box ? box.messages.map((m) => m.to).lastIndexOf(email) : -1;
  return at === -1 ? undefined : box!.messages.splice(at, 1)[0].code;
}

// ---- choosing the sender

/** Tests inject a sender (or `null` for "none configured"); `undefined` goes back to CODE_SENDER. */
export function setCodeSender(sender: CodeSender | null | undefined): void {
  slot.__leCodeSender = sender;
}

/** The configured sender, or null. Never throws: a missing secret is "no sender", so sign-in by password keeps working. */
export async function getCodeSender(): Promise<CodeSender | null> {
  if (slot.__leCodeSender !== undefined) return slot.__leCodeSender;
  const choice = process.env.CODE_SENDER?.trim().toLowerCase();
  if (choice === "log") return process.env.NODE_ENV === "production" ? null : new LogSender();
  if (choice === "gmail") {
    const { gmailSenderFromEnv } = await import("./gmail-sender");
    return gmailSenderFromEnv();
  }
  return null;
}
