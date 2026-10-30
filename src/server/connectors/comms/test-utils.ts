import type { Edition, EditionItem, GuardrailResult, StaffCard, Store, Workspace } from "@/contract";
import { buildMockEdition } from "@/mocks/editions";
import { sampleSeed } from "../../sample/chain";
import type { AgentDeps, ChatClient, ChatRequest, ChatResponse } from "../../agent/ports";
import { createMemoryRepo } from "../../store/memory";
import type { Repo } from "../../store/repo";
import type { CommsDeps } from "./deps";
import { createMemoryDocDb } from "./docs";
import { commsEnv, type CommsEnv } from "./env";
import { dispatchMailWith } from "../mail/dispatch";
import { dispatchSlackWith } from "../slack/dispatch";
import { CommsStore } from "./store";

/** Test doubles for the comms lane: an in-memory workspace with draft editions, a scripted network and a scripted chat model. Sample data only. */

export const NOW = new Date("2026-10-28T02:00:00.000Z");

export const SECRETS = {
  SLACK_SIGNING_SECRET: "test-signing-secret-0123456789abcdef",
  SLACK_BOT_TOKEN: "xoxb-test-token-not-real",
  SLACK_CLIENT_ID: "1111.2222",
  SLACK_CLIENT_SECRET: "test-client-secret",
  COMPOSIO_API_KEY: "ck_test_not_real",
  COMPOSIO_WEBHOOK_SECRET: "whsec-test-0123456789",
  COMPOSIO_AUTH_CONFIG_GMAIL: "ac_test_gmail",
  COMPOSIO_AUTH_CONFIG_OUTLOOK: "ac_test_outlook",
  COMMS_ENC_KEY: "test-encryption-key-0123456789abcdef",
  APP_URL: "https://localedition.example",
  COMMS_SAMPLE_MANAGER_EMAIL: "test-inbox@example.com",
  COMPOSIO_SAMPLE_GMAIL_ACCOUNT: "ca_sample_gmail",
} as const;

/** Optional extras a test can switch on. */
export const EXTRA_ENV = { SLACK_INCOMING_WEBHOOK_URL: "https://hooks.slack.com/services/T0SAMPLE1/B0TEST/not-a-real-hook", SLACK_TEAM_ID: "T0SAMPLE1" } as const;

export type NetCall = { url: string; method: string; headers: Record<string, string>; body: string };
export type NetHandler = (call: NetCall) => Response | Promise<Response> | undefined;

/** A scripted network: handlers are tried in order, the first to return a Response wins; unmatched calls fail loudly. */
export class FakeNet {
  calls: NetCall[] = [];
  handlers: NetHandler[] = [];
  readonly fetch: typeof fetch = async (input, init) => {
    const call: NetCall = {
      url: typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
      method: init?.method ?? "GET",
      headers: Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v])),
      body: typeof init?.body === "string" ? init.body : "",
    };
    this.calls.push(call);
    for (const h of this.handlers) {
      const r = await h(call);
      if (r) return r;
    }
    return Response.json({ ok: false, error: "unscripted_call" }, { status: 500 });
  };
  on(match: string | RegExp, respond: (call: NetCall) => unknown, status = 200): this {
    this.handlers.push((call) => ((typeof match === "string" ? call.url.includes(match) : match.test(call.url)) ? Response.json(respond(call), { status }) : undefined));
    return this;
  }
  to(match: string | RegExp): NetCall[] {
    return this.calls.filter((c) => (typeof match === "string" ? c.url.includes(match) : match.test(c.url)));
  }
}

export const slackOk = (net: FakeNet): FakeNet =>
  net
    .on("slack.com/api/auth.test", () => ({ ok: true, team_id: "T0SAMPLE1", team: "Kettle & Kiln HQ (sample)", user_id: "U0BOT" }))
    .on("slack.com/api/chat.postMessage", (c) => ({ ok: true, ts: "1761436500.000200", channel: `C0${(JSON.parse(c.body).channel as string).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10)}` }))
    .on("slack.com/api/chat.update", () => ({ ok: true }));

export class FakeChat implements ChatClient {
  requests: ChatRequest[] = [];
  constructor(private readonly respond: (req: ChatRequest) => string | Error) {}
  async complete(req: ChatRequest): Promise<ChatResponse> {
    this.requests.push(req);
    const out = this.respond(req);
    if (out instanceof Error) throw out;
    return { content: out, toolCalls: [] };
  }
}

export interface Harness {
  deps: CommsDeps;
  repo: Repo;
  store: CommsStore;
  net: FakeNet;
  chat: FakeChat;
  workspace: Workspace;
  stores: Store[];
  editions: Edition[];
  env: CommsEnv;
}

const passed = (): GuardrailResult => ({ status: "passed", reasons: [], checkedBy: "live" });

const asDraft = (e: Edition): Edition => ({
  ...e, status: "draft",
  items: e.items.map((i): EditionItem => ({ ...i, status: "draft", version: 0, guardrail: passed() })),
});

export async function makeHarness(opts: { sample?: boolean; env?: Partial<Record<keyof typeof SECRETS | keyof typeof EXTRA_ENV, string | undefined>>; chat?: (req: ChatRequest) => string | Error } = {}): Promise<Harness> {
  const repo = createMemoryRepo();
  const seed = sampleSeed();
  seed.chain.isSample = opts.sample ?? true;
  const workspace = await repo.createWorkspace(seed);
  const stores = await repo.listStores(workspace.chainId);
  const editions: Edition[] = [];
  for (const s of stores) editions.push(await repo.putEdition(asDraft(buildMockEdition(s))));
  const env = commsEnv({ ...SECRETS, ...opts.env } as Record<string, string | undefined>);
  const store = new CommsStore(createMemoryDocDb());
  const net = new FakeNet();
  const chat = new FakeChat(opts.chat ?? (() => JSON.stringify({ category: "other", summary: "A reply." })));
  const deps: CommsDeps = { store, env, repo, fetchImpl: net.fetch, now: () => new Date(NOW), agent: async () => ({ repo, chat, now: () => new Date(NOW) } as unknown as AgentDeps),
    dispatch: async () => undefined };
  deps.dispatch = async (a) => { await dispatchSlackWith(deps, a); await dispatchMailWith(deps, a); };
  return { deps, repo, store, net, chat, workspace, stores, editions, env };
}

/** Stores a passed staff card for the edition, so `getOrCreateCard` returns it without calling a model. */
export async function putCard(h: Harness, editionId: string, lines = [{ heading: "This week's special", body: "Cardamom Morning Bun with orange zest. Say it like you mean it." }, { heading: "On the speakers", body: "Soul and a little Khruangbin." }]): Promise<StaffCard> {
  const edition = (await h.repo.getEdition(editionId))!;
  return h.repo.putStaffCard({ editionId, storeId: edition.storeId, token: `tok_${editionId}`.slice(0, 24), lines, guardrail: passed() });
}

/** Approves every item of an edition directly (as the app would). */
export async function approveInRepo(h: Harness, editionId: string): Promise<Edition> {
  const e = (await h.repo.getEdition(editionId))!;
  for (const item of e.items) await h.repo.updateEditionItem(editionId, { ...item, status: "approved" }, item.version);
  return h.repo.setEditionStatus(editionId, "approved");
}
