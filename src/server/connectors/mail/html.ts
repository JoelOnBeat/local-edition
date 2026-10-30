import type { Edition, StaffCard, Store } from "@/contract";
import { specialOf } from "../slack/blocks";

/** The store manager's email: the staff card as a small front page, in the product's editorial style (paper, ink, one colour per store). */

const STORE_COLORS = ["#d4500f", "#2f7d4f", "#1f69ad", "#8a3fa6", "#a87c08", "#c0265e", "#0d8486", "#5d6a24"] as const;
export const storeColor = (colorIndex: number): string => STORE_COLORS[(Math.max(1, colorIndex) - 1) % STORE_COLORS.length];

export const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

export function subjectFor(store: Store, edition: Edition): string {
  const special = specialOf(edition);
  return special ? `This week at ${store.name}: ${special.name}` : `This week at ${store.name}`;
}

const datelineOf = (weekOf: string): string => {
  const d = new Date(`${weekOf}T12:00:00Z`);
  return `Week of ${new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(d)}`;
};

export interface CardEmailInput {
  chainName: string;
  store: Store;
  edition: Edition;
  card: StaffCard;
  cardUrl: string;
  managerName: string | null;
  /** Labelled on the email itself so nobody mistakes a sample for a customer. */
  isSample: boolean;
}

export function renderCardEmail(input: CardEmailInput): { subject: string; html: string; text: string } {
  const { chainName, store, edition, card, cardUrl, managerName, isSample } = input;
  const subject = subjectFor(store, edition);
  const colour = storeColor(store.colorIndex);
  const dateline = datelineOf(edition.weekOf);
  const greeting = managerName ? `Hi ${managerName.split(" ")[0]},` : "Hi,";
  const intro = "Here is this week's card for your team, approved by head office. Reply to this email with anything we should know: a sell-out, a hit, a change you would like, or a problem.";
  const sample = isSample ? "Sample chain: this email comes from Local Edition's demo, not from a real business." : "";

  const sections = card.lines.map((l) => `
        <tr><td style="padding:18px 0 0 0;border-top:1px solid #d9d1c1;">
          <div style="font:600 11px/1.2 'Helvetica Neue',Arial,sans-serif;letter-spacing:.12em;text-transform:uppercase;color:${colour};">${escapeHtml(l.heading)}</div>
          <div style="font:400 17px/1.5 Georgia,'Times New Roman',serif;color:#1b1915;padding:6px 0 18px 0;">${escapeHtml(l.body)}</div>
        </td></tr>`).join("");

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#f7f4ec;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f4ec;"><tr><td align="center" style="padding:24px 12px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fffdf7;border:1px solid #d9d1c1;">
    <tr><td style="border-top:6px solid ${colour};padding:22px 28px 6px 28px;">
      <div style="font:600 11px/1.2 'Helvetica Neue',Arial,sans-serif;letter-spacing:.14em;text-transform:uppercase;color:#6e675a;">${escapeHtml(chainName)}  ·  Issue ${edition.issueNo}  ·  ${escapeHtml(dateline)}</div>
      <div style="font:700 34px/1.1 Georgia,'Times New Roman',serif;color:#1b1915;padding-top:10px;">${escapeHtml(store.name)}</div>
      <div style="font:400 14px/1.4 'Helvetica Neue',Arial,sans-serif;color:#6e675a;padding-top:4px;">${escapeHtml(store.addressLabel)}</div>
    </td></tr>
    <tr><td style="padding:14px 28px 4px 28px;font:400 15px/1.55 'Helvetica Neue',Arial,sans-serif;color:#1b1915;">${escapeHtml(greeting)}<br>${escapeHtml(intro)}</td></tr>
    <tr><td style="padding:8px 28px 0 28px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${sections}</table></td></tr>
    <tr><td style="padding:4px 28px 26px 28px;">
      <a href="${escapeHtml(cardUrl)}" style="display:inline-block;background:#1b1915;color:#fffdf7;font:600 14px/1 'Helvetica Neue',Arial,sans-serif;padding:13px 20px;text-decoration:none;">Open the staff card</a>
      <div style="font:400 12px/1.5 'Helvetica Neue',Arial,sans-serif;color:#6e675a;padding-top:16px;">${escapeHtml(sample || "Sent by head office through Local Edition. Replies come back to head office and appear next to this edition.")}</div>
    </td></tr>
  </table>
</td></tr></table>
</body></html>`;

  const text = [
    `${chainName}  ·  Issue ${edition.issueNo}  ·  ${dateline}`,
    store.name.toUpperCase(),
    store.addressLabel,
    "",
    greeting,
    intro,
    "",
    ...card.lines.flatMap((l) => [l.heading.toUpperCase(), l.body, ""]),
    `Open the staff card: ${cardUrl}`,
    "",
    sample || "Sent by head office through Local Edition. Replies come back to head office and appear next to this edition.",
  ].join("\n");

  return { subject, html, text };
}
