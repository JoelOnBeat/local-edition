import type { EditionItem, ItemStatus } from "@/contract";
import { mockEditions } from "@/mocks/editions";
import { MOCK_WEEK_OF } from "@/mocks/helpers";
import { tagsFor } from "@/mocks/profiles";
import { SAMPLE_STORES } from "@/server/sample/chain";
import type { Brand } from "@/components/ui";

/**
 * Everything the landing shows. Store rows come from the labelled sample chain (Kettle & Kiln, src/mocks), so they never
 * drift from what "Try the sample chain" opens. Measured numbers come from docs/STATUS.md and the recorded NeMo job.
 */

export const WEEK_LABEL = new Date(`${MOCK_WEEK_OF}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

const special = (items: EditionItem[]) => items.find((i) => i.kind === "special");
const isDone = (s: ItemStatus) => s === "approved" || s === "edited";

export interface StoreRow {
  id: string;
  name: string;
  address: string;
  colorIndex: number;
  status: "approved" | "draft" | "flagged";
  special: string;
  approved: number;
  total: number;
  topTag: string;
  lift: number;
  evidence: number;
}

export const STORE_ROWS: StoreRow[] = SAMPLE_STORES.map((s) => {
  const ed = mockEditions.find((e) => e.storeId === s.id)!;
  const sp = special(ed.items);
  const top = tagsFor(s.id)[0]!;
  return {
    id: s.id,
    name: s.name,
    address: s.addressLabel,
    colorIndex: s.colorIndex,
    status: ed.status === "flagged" ? "flagged" : ed.status === "approved" ? "approved" : "draft",
    special: sp && "name" in sp ? sp.name : "",
    approved: ed.items.filter((i) => isDone(i.status)).length,
    total: ed.items.length,
    topTag: top.name,
    lift: top.lift,
    evidence: ed.evidence.length,
  };
});

export const LIFT_RANK = [...STORE_ROWS].sort((a, b) => b.lift - a.lift);

/** Measured, with where each number was recorded. */
export const MEASURED = {
  buildSeconds: 36,
  buildCost: "$0.0075",
  reviewCost: "$0.0008",
  redTeamCaught: 40,
  redTeamTotal: 40,
  benignBlocked: 0,
  benignTotal: 10,
  nemoJob: "local-edition-certify-eval-202610300615",
  date: "30 Oct 2026",
};

/** The Williamsburg evidence, as the evidence card shows it. */
export const WILLIAMSBURG = (() => {
  const s = SAMPLE_STORES[0]!;
  const tags = tagsFor(s.id).slice(0, 4);
  return { name: s.name, address: s.addressLabel, colorIndex: s.colorIndex, tags };
})();

/** The real guardrail rewrite in the sample chain (Astoria's special). */
export const GUARDRAIL_DIFF = {
  store: "Astoria",
  before: "Honey sesame iced latte packed with natural energy to power your afternoon.",
  after: "Iced latte shaken until frothy with a spoon of honey and a pinch of toasted sesame. A nod to the neighbourhood's long summers.",
  rail: "no-health-claims",
  reason: "Removed a claim that the drink boosts energy.",
};

export interface Integration {
  brand: Brand;
  role: string;
  what: string;
}

/** Each integration with the work it does here (README "Built on" and "Connectors"). */
export const INTEGRATIONS: Integration[] = [
  { brand: "qloo", role: "Taste", what: "What each block leans toward, and by how much against the city" },
  { brand: "nvidia", role: "Models", what: "Nemotron plans, writes and reviews; NeMo Guardrails checks" },
  { brand: "nebius", role: "Inference", what: "Token Factory serves every model; Serverless Jobs run the eval" },
  { brand: "tavily", role: "Local events", what: "This week's events near each store, and the brand-voice crawl" },
  { brand: "cloudflare", role: "Runtime", what: "Workers, D1, KV, R2, Durable Objects, Workflows and the Monday cron" },
  { brand: "square", role: "Menu", what: "Imports the menu and stores; publishes an approved special back" },
  { brand: "slack", role: "Approvals", what: "Head-office digest with Approve buttons; staff cards to each store" },
  { brand: "gmail", role: "Email", what: "Emails the staff card and sorts the managers' replies" },
  { brand: "outlook", role: "Email", what: "The same card and replies for Microsoft 365 chains" },
  { brand: "gcal", role: "Calendar", what: "A private feed per store with its event night" },
];

export const FAQ: Array<{ q: string; a: string[] }> = [
  {
    q: "What does a store get each week?",
    a: [
      "Four things: a special adapted from the chain's own menu, a sound brief for the room, a neighbouring place to partner with and an event night. Each line carries the evidence it came from, and a line without evidence is dropped.",
      "Once head office approves, the store gets a one-page staff card that opens on any phone.",
    ],
  },
  {
    q: "Where does the taste of a block come from?",
    a: [
      "From Qloo. For each store we ask what the people within about 800 metres over-index on (music, places, food, brands) and how that differs from the city. Only coordinates, entity ids and tags are sent, never anything about a customer.",
    ],
  },
  {
    q: "Who checks what the agent writes?",
    a: [
      "Every line goes through guardrails before anyone sees it: a health-claim rail, prompt-injection stripping and a self-check on NVIDIA Nemotron. NeMo Guardrails runs the full red-team set in a Nebius job; its recorded run caught 40 of 40 red-team phrases and blocked none of 10 ordinary ones.",
      "Then head office approves, edits or regenerates each line. Nothing reaches a store unapproved.",
    ],
  },
  {
    q: "Is Kettle & Kiln a real customer?",
    a: [
      "No. Kettle & Kiln is a labelled sample chain: eight coffee shops at real New York corners. Its partner shops and taste numbers are sample data, and every place that shows them says so.",
    ],
  },
  {
    q: "Which tools are connected today?",
    a: [
      "The Nemotron models on Nebius Token Factory, Tavily, Cloudflare and the calendar feed run on the live app, and Qloo calls go through a capped ledger with cached answers. The Square, Slack and Gmail or Outlook connectors are built and tested against each provider's documented API, and connect once a chain authorises its own account.",
    ],
  },
  {
    q: "What does it cost?",
    a: [
      "Local Edition is free to use. Behind the scenes one live store build took 36 seconds and $0.0075 of model time, and every visitor's workspace has its own spend cap.",
    ],
  },
];
