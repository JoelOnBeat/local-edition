import type { Edition, EditionItem, StaffCard, Store } from "@/contract";
import { SLACK_ACTIONS } from "@/contract/connectors-comms";
import type { Resolution } from "../comms/store";

/** Block Kit builders. Slack allows 50 blocks per message: a digest chunk holds 15 stores at three blocks each plus a header. */

export const DIGEST_CHUNK = 15;

export const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Button value: Slack echoes it back on click. Slack signs the request; we also check the workspace's team id. */
export const buttonValue = (workspaceId: string, editionId: string): string => `v1|${workspaceId}|${editionId}`;

export function parseButtonValue(value: string | undefined): { workspaceId: string; editionId: string } | null {
  const parts = (value ?? "").split("|");
  if (parts.length !== 3 || parts[0] !== "v1" || !parts[1] || !parts[2] || parts[1].length > 64 || parts[2].length > 64) return null;
  return { workspaceId: parts[1], editionId: parts[2] };
}

const live = (edition: Edition): EditionItem[] => edition.items.filter((i) => i.status !== "rejected");

export const specialOf = (edition: Edition) => live(edition).find((i): i is Extract<EditionItem, { kind: "special" }> => i.kind === "special");
export const eventOf = (edition: Edition) => live(edition).find((i): i is Extract<EditionItem, { kind: "event" }> => i.kind === "event");

export interface DigestEntry {
  workspaceId: string;
  store: Store;
  edition: Edition;
  resolution: Resolution | null;
}

/** `<!date^unix^{time}|fallback>` renders in each viewer's own time zone. */
const clock = (atUnix: number): string => `<!date^${atUnix}^{time}|${new Date(atUnix * 1000).toISOString().slice(11, 16)} UTC>`;

function resolutionText(r: Resolution): string {
  switch (r.kind) {
    case "approved": return `:white_check_mark: Approved by <@${r.userId}> at ${clock(r.atUnix)}`;
    case "partial": return `:warning: <@${r.userId}> approved ${r.approved} of ${r.total} items at ${clock(r.atUnix)}. The rest need a look in Local Edition.`;
    case "regenerated": return `:arrows_counterclockwise: New special requested by <@${r.userId}> at ${clock(r.atUnix)}. Review it in Local Edition.`;
    case "app": return `:white_check_mark: Approved in Local Edition at ${clock(r.atUnix)}`;
    case "failed": return `:x: <@${r.userId}> tried at ${clock(r.atUnix)}, but it did not go through: ${esc(r.reason)}`;
  }
}

function storeSection(entry: DigestEntry, appUrl: string): unknown[] {
  const { store, edition, resolution } = entry;
  const special = specialOf(edition);
  const event = eventOf(edition);
  const url = `${appUrl}/app/stores/${store.id}`;
  const lines = [
    `*<${url}|${esc(store.name)}>*  ·  ${esc(store.addressLabel)}`,
    special ? `*Special:* ${esc(special.name)}. ${esc(special.staffLine)}` : "_No special in this edition._",
    event ? `*Event:* ${esc(event.title)}, ${event.day} ${event.time}` : null,
  ].filter(Boolean);
  const blocks: unknown[] = [{ type: "section", block_id: `s_${edition.id}`.slice(0, 255), text: { type: "mrkdwn", text: lines.join("\n") } }];
  const approvedNow = resolution?.kind === "approved" || edition.status === "approved";
  if (resolution && (resolution.kind === "approved" || resolution.kind === "app" || resolution.kind === "failed")) {
    blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: resolutionText(resolution) }] });
  } else {
    const value = buttonValue(entry.workspaceId, edition.id);
    const buttons: unknown[] = [];
    if (!approvedNow) {
      buttons.push({ type: "button", action_id: SLACK_ACTIONS.approve, style: "primary", text: { type: "plain_text", text: "Approve" }, value });
    }
    buttons.push({ type: "button", action_id: SLACK_ACTIONS.regenerate, text: { type: "plain_text", text: "Regenerate" }, value });
    buttons.push({ type: "button", action_id: SLACK_ACTIONS.open, text: { type: "plain_text", text: "Open" }, url });
    blocks.push({ type: "actions", block_id: `a_${edition.id}`.slice(0, 255), elements: buttons });
    if (resolution) blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: resolutionText(resolution) }] });
  }
  blocks.push({ type: "divider" });
  return blocks;
}

export function digestMessage(input: { chainName: string; weekOf: string; entries: DigestEntry[]; appUrl: string; part: number; parts: number }): { text: string; blocks: unknown[] } {
  const { chainName, weekOf, entries, appUrl } = input;
  const title = `This week's editions: ${chainName}`;
  const sub = `Week of ${weekOf}. ${entries.length} store${entries.length === 1 ? "" : "s"} ready for head office${input.parts > 1 ? ` (part ${input.part} of ${input.parts})` : ""}.`;
  return {
    text: `${title}. ${sub}`,
    blocks: [
      { type: "header", text: { type: "plain_text", text: title.slice(0, 150) } },
      { type: "context", elements: [{ type: "mrkdwn", text: `${sub} Approve here or open the edition for the evidence behind it.` }] },
      ...entries.flatMap((e) => storeSection(e, appUrl)),
    ],
  };
}

export function cardMessage(input: { store: Store; card: StaffCard; weekOf: string; issueNo: number; appUrl: string }): { text: string; blocks: unknown[] } {
  const { store, card, weekOf, issueNo, appUrl } = input;
  const link = `${appUrl}/card/${card.token}`;
  return {
    text: `Staff card for ${store.name}, week of ${weekOf}. ${link}`,
    blocks: [
      { type: "header", text: { type: "plain_text", text: `${store.name}: this week` } },
      { type: "context", elements: [{ type: "mrkdwn", text: `Issue ${issueNo}  ·  Week of ${weekOf}  ·  Approved by head office` }] },
      ...card.lines.map((l) => ({ type: "section", text: { type: "mrkdwn", text: `*${esc(l.heading)}*\n${esc(l.body)}` } })),
      { type: "actions", elements: [{ type: "button", action_id: SLACK_ACTIONS.open, text: { type: "plain_text", text: "Open the staff card" }, url: link }] },
    ],
  };
}
