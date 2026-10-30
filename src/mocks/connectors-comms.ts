import type { Connection, Delivery, SyncEvent } from "@/contract/connectors";
import type { CommsState, RegenerateSuggestion, StoreCommsTarget, StoreNote } from "@/contract/connectors-comms";
import { SAMPLE_STORES } from "@/server/sample/chain";
import { MOCK_NOW, slugify } from "./helpers";
import { mockEditionId } from "./editions";

/** Sample data for the Slack and mail connectors (UI-B renders the connections page from this under DATA_MODE=mock). Labelled sample everywhere it shows. */

const at = (minutes: number) => new Date(Date.parse(MOCK_NOW) + minutes * 60_000).toISOString();

export const SAMPLE_MANAGERS: Record<string, string> = {
  Williamsburg: "Dana Okafor",
  "Park Slope": "Priya Raman",
  Astoria: "Nikos Pappas",
  Harlem: "Marcus Bell",
  "West Village": "Elena Rossi",
  "Lower East Side": "Tomas Lindqvist",
  "Upper East Side": "Grace Whitfield",
  "Long Island City": "Sam Adeyemi",
};

/** Sample managers use the example.com domain on purpose: nothing can be delivered to them by accident. */
export const mockCommsTargets: StoreCommsTarget[] = SAMPLE_STORES.map((s) => ({
  storeId: s.id,
  slackChannel: `store-${slugify(s.name)}`,
  managerName: SAMPLE_MANAGERS[s.name] ?? null,
  managerEmail: `${slugify(SAMPLE_MANAGERS[s.name] ?? s.name).replace(/-/g, ".")}@example.com`,
}));

export const mockCommsConnections: Connection[] = [
  {
    provider: "slack", status: "connected", mode: "sandbox", accountLabel: "Kettle & Kiln HQ (sample) · #head-office",
    connectedAt: at(-600), lastSyncAt: at(-4), error: null,
    capabilities: ["Posts the weekly digest to #head-office", "Approve and Regenerate buttons", "Posts each staff card to its store channel"],
  },
  {
    provider: "gmail", status: "connected", mode: "sandbox", accountLabel: "headoffice@kettleandkiln.example (sample)",
    connectedAt: at(-590), lastSyncAt: at(-2), error: null,
    capabilities: ["Emails each store manager their staff card", "Reads replies in the edition thread", "Turns replies into a note and a next-week signal"],
  },
  { provider: "outlook", status: "not_connected", mode: null, accountLabel: null, connectedAt: null, lastSyncAt: null, error: null, capabilities: ["Same as Gmail, from an Outlook mailbox"] },
];

const wb = SAMPLE_STORES[0];
const ps = SAMPLE_STORES[1];

export const mockCommsEvents: SyncEvent[] = [
  { id: "se_comms_6", provider: "gmail", at: at(-2), direction: "in", kind: "mail.reply", summary: "Dana Okafor (Williamsburg) replied: sold out of the Orange Peel Cortado by 11am.", storeId: wb.id, editionId: mockEditionId(wb.id), ok: true },
  { id: "se_comms_5", provider: "gmail", at: at(-3), direction: "out", kind: "mail.sent", summary: "Staff card emailed to Dana Okafor (Williamsburg).", storeId: wb.id, editionId: mockEditionId(wb.id), ok: true },
  { id: "se_comms_4", provider: "slack", at: at(-3), direction: "out", kind: "card.posted", summary: "Staff card posted to #store-williamsburg.", storeId: wb.id, editionId: mockEditionId(wb.id), ok: true },
  { id: "se_comms_3", provider: "slack", at: at(-4), direction: "in", kind: "approval.clicked", summary: "Approved by Hannah (head office), Williamsburg.", storeId: wb.id, editionId: mockEditionId(wb.id), ok: true },
  { id: "se_comms_2", provider: "slack", at: at(-9), direction: "out", kind: "digest.posted", summary: "Digest for 8 stores posted to #head-office.", storeId: null, editionId: null, ok: true },
  { id: "se_comms_1", provider: "gmail", at: at(-590), direction: "out", kind: "connection.error", summary: "Token refresh failed once; reconnected automatically.", storeId: null, editionId: null, ok: false },
];

export const mockCommsDeliveries: Delivery[] = [
  { provider: "slack", editionId: mockEditionId(wb.id), itemId: null, status: "sent", externalId: "C0SAMPLE02:1761436500.000200", url: null, at: at(-3), note: "#store-williamsburg" },
  { provider: "gmail", editionId: mockEditionId(wb.id), itemId: null, status: "sent", externalId: "thr_sample_williamsburg", url: null, at: at(-3), note: "to Dana Okafor" },
];

export const mockStoreNotes: StoreNote[] = [
  {
    id: "note_sample_1", editionId: mockEditionId(wb.id), storeId: wb.id, at: at(-2), provider: "gmail", fromEmail: "dana.okafor@example.com", fromName: "Dana Okafor",
    category: "sold_out", summary: "Orange Peel Cortado sold out by 11am on Monday and Tuesday.",
    excerpt: "Hi, the Orange Peel Cortado was gone by 11 both days. Could we get more orange peel in the Thursday delivery? Thanks, Dana",
    threadId: "thr_sample_williamsburg", messageId: "msg_sample_williamsburg_1",
  },
  {
    id: "note_sample_2", editionId: mockEditionId(ps.id), storeId: ps.id, at: at(-1), provider: "gmail", fromEmail: "priya.raman@example.com", fromName: "Priya Raman",
    category: "change_request", summary: "Asks for a non-dairy version of the special; the block is full of stroller parents.",
    excerpt: "Love the maple oat latte idea but most of our Saturday crowd is parents with toddlers. Can we do something that works for them?",
    threadId: "thr_sample_parkslope", messageId: "msg_sample_parkslope_1",
  },
];

export const mockSuggestions: RegenerateSuggestion[] = [
  {
    id: "sug_sample_1", editionId: mockEditionId(ps.id), storeId: ps.id, itemId: null, noteId: "note_sample_2",
    hint: "The Park Slope manager says Saturday's crowd is parents with toddlers; offer a kid-friendly alternative.", status: "open", createdAt: at(-1),
  },
];

export const mockCommsState: CommsState = {
  connections: mockCommsConnections, events: mockCommsEvents, targets: mockCommsTargets,
  deliveries: mockCommsDeliveries, notes: mockStoreNotes, suggestions: mockSuggestions,
};
