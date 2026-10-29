import { beforeEach, describe, expect, it, vi } from "vitest";
import { GuardrailResult } from "@/contract";
import { checkCopy, checkCopyDetailed, LOCAL_RAIL, parseRailsHeader, probeGuardrails, resetGuardrailsBreaker } from "./client";

const voice = ["warm", "short sentences"];
const base = { url: "http://guard.test", token: "s3cret" };

function reply(body: unknown, init: { status?: number; rails?: unknown } = {}): typeof fetch {
  return vi.fn(async () => {
    const headers = new Headers({ "content-type": "application/json" });
    if (init.rails) headers.set("x-le-rails", JSON.stringify(init.rails));
    return new Response(JSON.stringify(body), { status: init.status ?? 200, headers });
  }) as unknown as typeof fetch;
}
const down = (): typeof fetch => vi.fn(async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch;

beforeEach(() => resetGuardrailsBreaker());

describe("checkCopy: server answers", () => {
  it("passed, and the request carries the contract shape, brand voice context and shared secret", async () => {
    const fetchImpl = reply({ status: "passed", content: "Oat flat white." });
    const r = await checkCopy({ text: "Oat flat white.", kind: "special", brandVoice: voice }, { ...base, fetchImpl });
    expect(r).toEqual({ status: "passed", reasons: [] });
    expect(GuardrailResult.safeParse(r).success).toBe(true);
    const [url, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://guard.test/v1/checks");
    expect((init.headers as Record<string, string>)["x-le-guard-token"]).toBe("s3cret");
    const sent = JSON.parse(init.body as string);
    expect(sent.guardrails).toEqual({ config_id: "localedition", rail_types: ["output"], context: { brand_voice: voice, kind: "special" } });
    expect(sent.messages.at(-1)).toEqual({ role: "assistant", content: "Oat flat white." });
    expect(sent.messages[0].role).toBe("user");
  });

  it("passed with a skipped self-check is reported in the reasons, not hidden", async () => {
    const fetchImpl = reply(
      { status: "passed", content: "x" },
      { rails: { reasons: [], skipped: [{ rail: "check brand voice", why: "no model key configured" }] } },
    );
    const r = await checkCopy({ text: "Cold brew, 18 hours.", kind: "card", brandVoice: voice }, { ...base, fetchImpl });
    expect(r.status).toBe("passed");
    expect(r.reasons).toEqual(["Skipped check brand voice: no model key configured."]);
  });

  it("blocked by the brand-voice rail uses the server reason and rail name", async () => {
    const fetchImpl = reply(
      { status: "blocked", content: "BLOCKED", rail: "check brand voice" },
      { rails: { reasons: ["Brand voice: the copy does not fit the brand voice for this chain."], skipped: [] } },
    );
    const r = await checkCopy({ text: "Our best ever bun", kind: "special", brandVoice: voice }, { ...base, fetchImpl });
    expect(r).toEqual({
      status: "blocked",
      rail: "check brand voice",
      reasons: ["Brand voice: the copy does not fit the brand voice for this chain."],
      original: "Our best ever bun",
    });
  });

  it("blocked without a reason header falls back to a rail-named reason", async () => {
    const fetchImpl = reply({ status: "blocked", content: "BLOCKED", rail: "check brand voice" });
    const r = await checkCopy({ text: "Plain bun", kind: "special", brandVoice: voice }, { ...base, fetchImpl });
    expect(r.reasons).toEqual(['Blocked by the "check brand voice" rail.']);
  });

  it("local catalogue hit wins and names the server rail when the server agrees", async () => {
    const fetchImpl = reply({ status: "blocked", content: "BLOCKED", rail: "check health claims" });
    const r = await checkCopy({ text: "A gluten-free bun", kind: "special", brandVoice: voice }, { ...base, fetchImpl });
    expect(r.status).toBe("blocked");
    expect(r.rail).toBe("check health claims");
    expect(r.reasons.some((x) => x.includes('Matched "gluten-free".'))).toBe(true);
  });

  it("local hit still blocks when the server passes the copy (drift), and says so", async () => {
    const fetchImpl = reply({ status: "passed", content: "x" });
    const r = await checkCopy({ text: "Boosts your immunity", kind: "special", brandVoice: voice }, { ...base, fetchImpl });
    expect(r.status).toBe("blocked");
    expect(r.rail).toBe(LOCAL_RAIL);
    expect(r.reasons.at(-1)).toMatch(/local catalogue did/);
  });

  it("'modified' maps to rewritten with the new text and the original kept", async () => {
    const fetchImpl = reply({ status: "modified", content: "Softer wording." });
    const out = await checkCopyDetailed({ text: "Original wording.", kind: "event", brandVoice: voice }, { ...base, fetchImpl });
    expect(out.result.status).toBe("rewritten");
    expect(out.result.original).toBe("Original wording.");
    expect(out.text).toBe("Softer wording.");
  });
});

describe("checkCopy: server down, never throws", () => {
  it("network error with clean copy -> unchecked", async () => {
    const r = await checkCopy({ text: "Oat flat white.", kind: "special", brandVoice: voice }, { ...base, fetchImpl: down() });
    expect(r.status).toBe("unchecked");
    expect(r.reasons[0]).toMatch(/unreachable/);
    expect(GuardrailResult.safeParse(r).success).toBe(true);
  });

  it("network error with a local hit -> blocked locally with the claim reason", async () => {
    const r = await checkCopy({ text: "A vegan, gluten-free bun", kind: "special", brandVoice: voice }, { ...base, fetchImpl: down() });
    expect(r.status).toBe("blocked");
    expect(r.rail).toBe(LOCAL_RAIL);
    expect(r.reasons.join(" ")).toMatch(/Checked locally only/);
    expect(r.reasons.join(" ")).toMatch(/vegan/i);
  });

  it("timeout -> unchecked, quickly", async () => {
    const hang = vi.fn((_u: string, init?: RequestInit) =>
      new Promise((_res, rej) => init?.signal?.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError")))),
    ) as unknown as typeof fetch;
    const started = Date.now();
    const r = await checkCopy({ text: "Oat flat white.", kind: "special", brandVoice: voice }, { ...base, fetchImpl: hang, timeoutMs: 30 });
    expect(Date.now() - started).toBeLessThan(1000);
    expect(r.status).toBe("unchecked");
    expect(r.reasons[0]).toMatch(/within 30 ms/);
  });

  it.each([
    ["HTTP 500", () => reply({ error: "boom" }, { status: 500 })],
    ["HTTP 422", () => reply({ error: { message: "bad config" } }, { status: 422 })],
    ["malformed body", () => reply({ nope: true })],
    ["unknown status", () => reply({ status: "maybe", content: "x" })],
  ])("%s -> unchecked", async (_n, make) => {
    const r = await checkCopy({ text: "Oat flat white.", kind: "special", brandVoice: voice }, { ...base, fetchImpl: make() });
    expect(r.status).toBe("unchecked");
  });

  it("non-JSON body -> unchecked", async () => {
    const fetchImpl = vi.fn(async () => new Response("<html>bad gateway</html>", { status: 200 })) as unknown as typeof fetch;
    const r = await checkCopy({ text: "Oat flat white.", kind: "special", brandVoice: voice }, { ...base, fetchImpl });
    expect(r.status).toBe("unchecked");
  });

  it("401 from the sidecar -> unchecked with a secret-mismatch reason (no secret echoed)", async () => {
    const r = await checkCopy({ text: "Oat flat white.", kind: "special", brandVoice: voice }, { ...base, fetchImpl: reply({}, { status: 401 }) });
    expect(r.status).toBe("unchecked");
    expect(r.reasons[0]).toMatch(/shared secret/);
    expect(JSON.stringify(r)).not.toContain("s3cret");
  });

  it("circuit breaker: after a failure, the next checks skip the server for 10 s, then retry", async () => {
    let t = 1_000_000;
    const fetchImpl = down();
    const opts = { ...base, fetchImpl, now: () => t };
    await checkCopy({ text: "Oat flat white.", kind: "special", brandVoice: voice }, opts);
    await checkCopy({ text: "Flat white.", kind: "special", brandVoice: voice }, opts);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    t += 10_001;
    await checkCopy({ text: "Cortado.", kind: "special", brandVoice: voice }, opts);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("a rejected secret does not trip the breaker", async () => {
    const fetchImpl = reply({}, { status: 401 });
    await checkCopy({ text: "Flat white.", kind: "special", brandVoice: voice }, { ...base, fetchImpl });
    await checkCopy({ text: "Cortado.", kind: "special", brandVoice: voice }, { ...base, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe("checkCopy: input boundaries", () => {
  it("empty text, bad kind, too many voice lines and over-long text are unchecked, not thrown", async () => {
    const fetchImpl = reply({ status: "passed", content: "x" });
    expect((await checkCopy({ text: "  ", kind: "special", brandVoice: voice }, { ...base, fetchImpl })).status).toBe("unchecked");
    expect((await checkCopy({ text: "ok", kind: "nope" as never, brandVoice: voice }, { ...base, fetchImpl })).status).toBe("unchecked");
    expect((await checkCopy({ text: "ok", kind: "card", brandVoice: ["a", "b", "c", "d"] }, { ...base, fetchImpl })).status).toBe("unchecked");
    expect((await checkCopy({ text: "a".repeat(9000), kind: "card", brandVoice: voice }, { ...base, fetchImpl })).status).toBe("unchecked");
    expect((await checkCopy(null as never, { ...base, fetchImpl })).status).toBe("unchecked");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("response-shape parsing", () => {
  it("parseRailsHeader accepts the sidecar shape and ignores junk", () => {
    expect(parseRailsHeader('{"reasons":["a"],"skipped":[{"rail":"r","why":"w"}]}')).toEqual({
      reasons: ["a"],
      skipped: [{ rail: "r", why: "w" }],
    });
    expect(parseRailsHeader('{"reasons":["a"]}')).toEqual({ reasons: ["a"], skipped: [] });
    expect(parseRailsHeader("not json")).toEqual({ reasons: [], skipped: [] });
    expect(parseRailsHeader('{"reasons":[1]}')).toEqual({ reasons: [], skipped: [] });
    expect(parseRailsHeader(null)).toEqual({ reasons: [], skipped: [] });
  });

  it("accepts a null rail and extra fields in the /v1/checks body", async () => {
    const fetchImpl = reply({ status: "passed", content: "x", rail: null, extra: 1 });
    expect((await checkCopy({ text: "Oat flat white.", kind: "special", brandVoice: voice }, { ...base, fetchImpl })).status).toBe("passed");
  });
});

describe("probeGuardrails", () => {
  it("up when /v1/health answers 200, down otherwise", async () => {
    expect(await probeGuardrails({ ...base, fetchImpl: reply({ status: "pass" }) })).toBe("up");
    expect(await probeGuardrails({ ...base, fetchImpl: reply({}, { status: 503 }) })).toBe("down");
    expect(await probeGuardrails({ ...base, fetchImpl: down() })).toBe("down");
  });
});
