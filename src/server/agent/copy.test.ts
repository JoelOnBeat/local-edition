import { describe, expect, it } from "vitest";
import { buildEditions } from "./build";
import { COPY_JSON, WEEK_OF, collect, harness, text } from "./test-utils";
import { guardField, mergeResults } from "./guard";
import { writeCopy } from "./copy";
import type { Candidate } from "./plan";
import type { StoreContext } from "./ports";

const REWRITE = "A warm cardamom bun, rolled fresh each morning.";
const other = (first: string) => JSON.stringify(first.includes("Write the sound copy") ? COPY_JSON.sound : first.includes("Write the partner copy") ? COPY_JSON.partner : COPY_JSON.event);
const isRewrite = (req: { messages: { content: string | null }[] }) => String(req.messages[0].content).includes("rewritten text");

async function built(opts: Parameters<typeof harness>[0]) {
  const h = await harness({ storeCount: 1, ...opts });
  const events = await collect(buildEditions({ workspaceId: h.workspaceId, weekOf: WEEK_OF }, h.deps));
  const done = events.at(-1);
  const ed = (await h.repo.getEdition(done?.type === "run_done" ? done.editionIds[0] : "none"))!;
  return { h, events, ed };
}

describe("copy and guardrails", () => {
  it("rewrites blocked copy once, re-checks it, and records the original", async () => {
    const claim = "Rolled with cardamom sugar. Boost your immunity all winter.";
    const { h, ed } = await built({
      copy: (_user, req) => {
        if (isRewrite(req)) return REWRITE;
        const first = String(req.messages[1].content);
        return first.includes("Write the special copy") ? JSON.stringify({ ...COPY_JSON.special, description: claim }) : other(first);
      },
    });
    const special = ed.items.find((i) => i.kind === "special")!;
    expect(special.kind === "special" && special.description).toBe(REWRITE);
    expect(special.guardrail).toMatchObject({ status: "rewritten", rail: "no_health_claims", original: claim });
    expect(special.status).toBe("draft");
    // The blocked text was checked, then the rewrite was checked.
    expect(h.guardrails.calls).toContain(claim);
    expect(h.guardrails.calls).toContain(REWRITE);
    expect(ed.status).toBe("draft");
  });

  it("asks the rewrite for exactly one fix: still blocked means flagged with the original text kept", async () => {
    const claim = "Boost your immunity with every cup.";
    const { h, ed } = await built({
      copy: (_user, req) => {
        if (isRewrite(req)) return "Boost your immunity, still.";
        const first = String(req.messages[1].content);
        return first.includes("Write the special copy") ? JSON.stringify({ ...COPY_JSON.special, staffLine: claim }) : other(first);
      },
    });
    const special = ed.items.find((i) => i.kind === "special")!;
    expect(special.status).toBe("flagged");
    expect(special.guardrail.status).toBe("blocked");
    expect(special.kind === "special" && special.staffLine).toBe(claim);
    expect(ed.status).toBe("flagged");
    expect(h.chat.copyCalls).toBe(5); // four items plus a single rewrite
  });

  it("marks everything unchecked when guardrails are down, and never blocks the build", async () => {
    const { ed } = await built({ guardrails: "down" });
    expect(ed.items).toHaveLength(4);
    for (const item of ed.items) {
      expect(item.guardrail.status).toBe("unchecked");
      expect(item.guardrail.reasons[0]).toMatch(/unavailable/);
      expect(item.status).toBe("draft");
    }
    expect(ed.status).toBe("draft");
  });

  it("repairs malformed copy JSON once, then falls back to the plain template", async () => {
    let n = 0;
    const { h, ed } = await built({
      copy: (_user, req) => {
        const first = String(req.messages[1].content);
        if (first.includes("Write the special copy")) { n++; return n === 1 ? "sorry, here you go: name=Bun" : JSON.stringify(COPY_JSON.special); }
        return first.includes("Write the sound copy") ? JSON.stringify({ oops: true }) : other(first);
      },
    });
    expect(n).toBe(2); // one repair turn for the special
    const special = ed.items.find((i) => i.kind === "special")!;
    expect(special.kind === "special" && special.name).toBe("Cardamom Morning Bun");
    const sound = ed.items.find((i) => i.kind === "sound")!;
    expect(sound.kind === "sound" && sound.brief).toMatch(/^Keep the room warm soul/); // template
    expect(h.chat.copyCalls).toBeGreaterThanOrEqual(6);
  });

  it("uses the guardrails' own rewrite text when it returns one", async () => {
    const h = await harness({ storeCount: 1 });
    h.deps.guardrails = { checkCopy: async ({ text: t }) => ({ status: "rewritten", rail: "voice", reasons: ["Too loud."], text: t.toLowerCase() }) };
    const sc = { chain: (await h.repo.getChain("chain_kettle_kiln"))!, store: (await h.repo.getStore(h.storeIds[0]))!, menu: [], weekOf: WEEK_OF } as StoreContext;
    const r = await guardField(h.deps, sc, "special", "name", "LOUD BUN");
    expect(r).toEqual({ text: "loud bun", result: { status: "rewritten", rail: "voice", reasons: ["Too loud."], original: "LOUD BUN" } });
  });
});

describe("mergeResults", () => {
  it("lets the worst status win and joins reasons and originals", () => {
    const merged = mergeResults([
      { field: "a", result: { status: "passed", reasons: [] } },
      { field: "b", result: { status: "rewritten", rail: "voice", reasons: ["x"], original: "old b" } },
      { field: "c", result: { status: "unchecked", reasons: ["down"] } },
    ]);
    expect(merged).toEqual({ status: "unchecked", reasons: ["x", "down"], original: "old b" });
    expect(mergeResults([{ field: "a", result: { status: "blocked", rail: "r", reasons: ["bad"], original: "t" } }, { field: "b", result: { status: "unchecked", reasons: [] } }]).status).toBe("blocked");
    expect(mergeResults([]).status).toBe("unchecked");
  });
});

describe("writeCopy", () => {
  it("passes the chain's brand voice and the evidence facts to the copy model", async () => {
    const h = await harness({ storeCount: 1 });
    const chain = (await h.repo.getChain("chain_kettle_kiln"))!;
    const sc: StoreContext = { chain, store: (await h.repo.getStore(h.storeIds[0]))!, menu: [], weekOf: WEEK_OF };
    const c: Candidate = { kind: "event", day: "Fri", time: "18:00", tieIn: null, evidenceIds: ["x"] };
    const out = await writeCopy(h.deps, sc, c, ["Record fairs over-index here."], "keep it short");
    expect(out.templated).toBe(false);
    const req = h.chat.requests[0];
    expect(String(req.messages[0].content)).toContain(chain.brandVoice[0]);
    expect(String(req.messages[1].content)).toContain("Record fairs over-index here.");
    expect(String(req.messages[1].content)).toContain("keep it short");
    expect(text("").toolCalls).toEqual([]);
  });
});
