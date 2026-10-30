import type { Brand } from "@/components/ui";

/**
 * What the landing shows that is not read from the demo workspace. This week's editions, taste tags and lifts come from live Qloo
 * answers at request time (src/server/landing/sample.ts); nothing of them is written here. Measured numbers come from docs/STATUS.md and the recorded NeMo job.
 */

/** "28 Oct" from an ISO Monday. */
export const weekLabel = (weekOf: string): string =>
  new Date(`${weekOf}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

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
      "No. Kettle & Kiln is a labelled sample chain: eight coffee shops at real New York corners. The chain, its stores and its menu are sample data, and every place that shows them says so. The taste numbers and editions come from live Qloo calls.",
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
