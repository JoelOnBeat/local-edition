import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AgentEvent, type Edition } from "@/contract";
import { setRepo } from "../store";
import { sseResponse } from "../http/sse";
import { buildEditions } from "./build";
import { cardRoute, buildRoute, regenerateRoute, reviewRoute } from "./handlers";
import { mondayOf } from "./util";
import { setAgentDeps } from "./deps";
import { call, harness, scriptedChat, turn, WEEK_OF, type Harness } from "./test-utils";

function req(path: string, ws: string | null, init: RequestInit = {}): Request {
  return new Request(`http://localhost${path}`, { ...init, headers: { "content-type": "application/json", ...(ws ? { cookie: `le_ws=${ws}` } : {}) } });
}
const args = (p: Record<string, string>) => ({ params: Promise.resolve(p) });

function parseSse(text: string): { events: AgentEvent[]; comments: string[] } {
  const events: AgentEvent[] = [];
  const comments: string[] = [];
  for (const block of text.split("\n\n").filter(Boolean)) {
    if (block.startsWith(":")) comments.push(block);
    else {
      expect(block.startsWith("data: ")).toBe(true);
      events.push(AgentEvent.parse(JSON.parse(block.slice(6))));
    }
  }
  return { events, comments };
}

describe("SSE framing", () => {
  it("frames each AgentEvent as `data: <json>` with a blank line, opens with a comment, and closes", async () => {
    const h = await harness({ storeCount: 1 });
    const res = sseResponse(buildEditions({ workspaceId: h.workspaceId, weekOf: WEEK_OF }, h.deps), { heartbeatMs: 60_000 });
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(res.headers.get("cache-control")).toContain("no-cache");
    const raw = await res.text();
    expect(raw.startsWith(": open\n\n")).toBe(true);
    expect(raw.endsWith("\n\n")).toBe(true);
    const { events } = parseSse(raw);
    expect(events[0].type).toBe("run_started");
    expect(events.at(-1)!.type).toBe("run_done");
    expect(events.filter((e) => e.type === "item_drafted")).toHaveLength(4);
  });

  it("turns a crashed generator into one generic error event with no internals", async () => {
    async function* boom(): AsyncGenerator<AgentEvent> {
      yield { type: "run_started", runId: "r", storeIds: [] };
      throw new Error("secret=abc at /srv/app/agent.js:9");
    }
    const raw = await sseResponse(boom()).text();
    const { events } = parseSse(raw);
    expect(events.at(-1)).toMatchObject({ type: "error", code: "stream_failed" });
    expect(raw).not.toContain("secret");
    expect(raw).not.toContain("/srv");
  });
});

describe("routes", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await harness({ storeCount: 2 });
    setRepo(h.repo);
    setAgentDeps(h.deps);
  });
  afterEach(() => {
    setRepo(undefined);
    setAgentDeps(undefined);
  });

  async function runBuild(storeIds?: string[]) {
    const res = await buildRoute(req("/api/editions/build", h.workspaceId, { method: "POST", body: JSON.stringify(storeIds ? { storeIds } : {}) }));
    return { res, ...parseSse(await res.text()) };
  }

  it("POST /api/editions/build streams a build for the cookie's workspace", async () => {
    const { res, events } = await runBuild();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(events.filter((e) => e.type === "store_done")).toHaveLength(2);
  });

  it("rejects bad input before streaming: unknown store 404, wrong body 400", async () => {
    const unknown = await buildRoute(req("/api/editions/build", h.workspaceId, { method: "POST", body: JSON.stringify({ storeIds: ["store_nope"] }) }));
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toMatchObject({ code: "unknown_store" });
    const bad = await buildRoute(req("/api/editions/build", h.workspaceId, { method: "POST", body: JSON.stringify({ storeIds: "all" }) }));
    expect(bad.status).toBe(400);
  });

  it("regenerates an item over SSE; 404 for a missing item or another visitor's edition", async () => {
    const { events } = await runBuild([h.storeIds[0]]);
    const done = events.find((e) => e.type === "store_done");
    const edId = done?.type === "store_done" ? done.editionId : "";
    const ed = (await h.repo.getEdition(edId)) as Edition;
    const sound = ed.items.find((i) => i.kind === "sound")!;
    const chat = scriptedChat({ agent: [turn(call("artists_local", { limit: 10 })), turn(call("submit_candidates", { sound: { mood: "late soul" } }))] });
    h.deps.chat = chat;

    const ok = await regenerateRoute(req(`/x`, h.workspaceId, { method: "POST", body: JSON.stringify({ hint: "less mellow" }) }), args({ id: edId, itemId: sound.id }));
    expect(ok.status).toBe(200);
    const parsed = parseSse(await ok.text());
    const drafted = parsed.events.find((e) => e.type === "item_drafted");
    expect(drafted).toMatchObject({ item: { id: sound.id, kind: "sound", version: sound.version + 1 } });
    // The planner's mood and head office's hint both reach the copy model.
    const copyAsk = JSON.stringify(chat.requests.filter((r) => r.model.includes("Lightning")).map((r) => r.messages[1]));
    expect(copyAsk).toContain("Mood: late soul");
    expect(copyAsk).toContain("less mellow");

    const noItem = await regenerateRoute(req(`/x`, h.workspaceId, { method: "POST", body: "{}" }), args({ id: edId, itemId: "it_nope" }));
    expect(noItem.status).toBe(404);

    // A second visitor holds a different workspace and cannot reach this edition.
    const other = await h.repo.createWorkspace({ ...(await import("../sample/chain")).sampleSeed(), chain: { ...(await import("../sample/chain")).SAMPLE_CHAIN, id: "chain_other" }, stores: [] });
    const foreign = await regenerateRoute(req(`/x`, other.id, { method: "POST", body: "{}" }), args({ id: edId, itemId: sound.id }));
    expect(foreign.status).toBe(404);
    const foreignCard = await cardRoute(req(`/x`, other.id), args({ id: edId }));
    expect(foreignCard.status).toBe(404);
  });

  it("GET /api/editions/:id/card writes the card on first request and returns the same one after", async () => {
    const { events } = await runBuild([h.storeIds[0]]);
    const edId = (events.find((e) => e.type === "store_done") as { editionId: string }).editionId;
    const first = await cardRoute(req("/x", h.workspaceId), args({ id: edId }));
    expect(first.status).toBe(200);
    const card = await first.json();
    expect(card).toMatchObject({ editionId: edId });
    const second = await (await cardRoute(req("/x", h.workspaceId), args({ id: edId }))).json();
    expect(second.token).toBe(card.token);
    const missing = await cardRoute(req("/x", h.workspaceId), args({ id: "ed_missing" }));
    expect(missing.status).toBe(404);
  });

  it("POST /api/editions/review streams one Ultra verdict per store; bad body 400; strangers see no editions", async () => {
    await runBuild();
    const [a, b] = h.storeIds;
    h.deps.chat = scriptedChat({ review: () => JSON.stringify({ reviews: [{ storeId: a, verdict: "approve", reason: "Fits.", clashWith: [], hint: null }, { storeId: b, verdict: "needs_change", reason: "Same record fair.", clashWith: [a], hint: "event: another night" }] }) });
    const ok = await reviewRoute(req("/api/editions/review", h.workspaceId, { method: "POST", body: JSON.stringify({ weekOf: mondayOf(h.deps.now()) }) }));
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toContain("text/event-stream");
    const { events } = parseSse(await ok.text());
    expect(events.filter((e) => e.type === "review").map((e) => (e.type === "review" ? e.verdict : ""))).toEqual(["approve", "needs_change"]);
    expect(events.filter((e) => e.type === "step_metrics" && e.role === "review")).toHaveLength(1);

    const bad = await reviewRoute(req("/api/editions/review", h.workspaceId, { method: "POST", body: JSON.stringify({ weekOf: "next week" }) }));
    expect(bad.status).toBe(400);
    const other = await h.repo.createWorkspace({ ...(await import("../sample/chain")).sampleSeed(), chain: { ...(await import("../sample/chain")).SAMPLE_CHAIN, id: "chain_other2" }, stores: [] });
    const none = parseSse(await (await reviewRoute(req("/api/editions/review", other.id, { method: "POST", body: "{}" }))).text());
    expect(none.events[0]).toMatchObject({ type: "error", code: "no_editions" });
  });
});
