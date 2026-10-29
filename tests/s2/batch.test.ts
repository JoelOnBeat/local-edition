import { beforeEach, describe, expect, it } from "vitest";
import { EvalResult, type Edition, type JobResult } from "@/contract";
import { getPendingJobs, postJobEval, postJobResults } from "@/server/handlers/job-batch";
import { readJobRuns } from "@/server/handlers/proof-ledger";
import { EVAL_KEY } from "@/server/jobs/batch-runs";
import { itemText } from "@/server/jobs/certify";
import { signBody as hmacHex } from "@/server/jobs/hmac";
import { ensureDemoWorkspace } from "@/server/session";
import type { Repo } from "@/server/store";
import { cardFor, cleanEdition, fakePorts, freshApp, req } from "../e/helpers";

const SECRET = "s2-job-secret-not-real-0123456789abcdef";
const NEMO = "nemo-guardrails@nebius-job" as const;
const nowSec = () => Math.floor(Date.now() / 1000);
/** Two requests in one second would sign identically (a replay), so each default timestamp is one second later. */
let tick = 0;
const nextTs = () => nowSec() + ++tick;
const iso = () => new Date().toISOString();

let repo: Repo;
let edition: Edition;

beforeEach(async () => {
  repo = freshApp({ LE_JOB_SECRET: SECRET }, fakePorts());
  await ensureDemoWorkspace(repo);
  edition = cleanEdition("store_williamsburg", "ed_s2_1");
  await repo.putEdition(edition);
  await repo.putStaffCard(cardFor(edition, "tok_s2_card_0001"));
});

/** Scheme 2: header timestamp, signature over "<ts>." + body. */
async function get(path: string, o: { ts?: number; secret?: string; signature?: string; headers?: Record<string, string> } = {}) {
  const ts = String(o.ts ?? nextTs());
  const signature = o.signature ?? (await hmacHex(o.secret ?? SECRET, `${ts}.`));
  return getPendingJobs(req(path, { method: "GET", headers: { "x-le-timestamp": ts, "x-le-signature": signature, ...o.headers } }));
}

type Handler = typeof postJobResults;
/** Scheme 1: `ts` in the JSON body, signature over the raw bytes. */
async function signedPost(handler: Handler, path: string, body: Record<string, unknown>, o: { secret?: string; raw?: string } = {}) {
  const raw = o.raw ?? JSON.stringify({ ts: nowSec(), ...body });
  return handler(req(path, { method: "POST", headers: { "content-type": "application/json", "x-le-signature": await hmacHex(o.secret ?? SECRET, raw) }, body: raw }));
}

const verdict = (status: "passed" | "blocked", over: Record<string, unknown> = {}) => ({
  status,
  reasons: [status === "passed" ? "Passed: our regex catalogue (run by NeMo Guardrails) and NeMo's self check output on Lightning." : "NeMo self check output (Lightning): the copy breaks the brand voice or the claims policy."],
  ...(status === "blocked" ? { rail: "self check output", original: "x" } : {}),
  checkedBy: NEMO,
  certifiedAt: iso(),
  jobId: "job-1",
  ...over,
});

async function pendingItems() {
  const res = await get("/api/jobs/pending");
  expect(res.status).toBe(200);
  return ((await res.json()) as { items: { editionId: string; itemId: string; kind: string; text: string; brandVoice: string[] }[] }).items;
}

describe("GET /api/jobs/pending", () => {
  it("needs a valid signature, a fresh timestamp, and refuses a replay", async () => {
    expect((await getPendingJobs(req("/api/jobs/pending"))).status).toBe(400);
    const bad = await get("/api/jobs/pending", { secret: "wrong-secret-wrong-secret-wrong-secret-1234" });
    expect(bad.status).toBe(401);
    expect(await bad.json()).toMatchObject({ code: "bad_signature" });
    const stale = await get("/api/jobs/pending", { ts: nowSec() - 400 });
    expect(await stale.json()).toMatchObject({ code: "stale_signature" });
    const ts = nextTs();
    expect((await get("/api/jobs/pending", { ts })).status).toBe(200);
    const again = await get("/api/jobs/pending", { ts });
    expect(again.status).toBe(401);
    expect(await again.json()).toMatchObject({ code: "replayed_signature" });
  });

  it("the signature covers the timestamp: a captured signature with a newer ts is refused", async () => {
    const ts = nowSec() - 10;
    const signature = await hmacHex(SECRET, `${ts}.`);
    const res = await getPendingJobs(req("/api/jobs/pending", { headers: { "x-le-timestamp": String(ts + 5), "x-le-signature": signature } }));
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "bad_signature" });
  });

  it("lists every item and the staff card with the chain's brand voice; card itemId is its token", async () => {
    const items = await pendingItems();
    expect(items.filter((i) => i.kind !== "card")).toHaveLength(edition.items.length);
    const card = items.find((i) => i.kind === "card");
    expect(card).toMatchObject({ editionId: "ed_s2_1", itemId: "tok_s2_card_0001" });
    expect(items.every((i) => i.brandVoice.length >= 1 && i.text.length > 0 && i.text.length <= 4000)).toBe(true);
    expect(items.find((i) => i.kind === "special")!.text).toBe(itemText(edition.items.find((i) => i.kind === "special")!));
  });

  it("leaves out rejected items and items NeMo already certified", async () => {
    const [first, second] = edition.items;
    await repo.putEdition({ ...edition, items: edition.items.map((i) => (i.id === first.id ? { ...i, status: "rejected" as const } : i.id === second.id ? { ...i, guardrail: { ...i.guardrail, checkedBy: NEMO } } : i)) });
    const ids = (await pendingItems()).map((i) => i.itemId);
    expect(ids).not.toContain(first.id);
    expect(ids).not.toContain(second.id);
  });

  it("is capped at 200 items", async () => {
    const big = { ...edition, id: "ed_s2_big", storeId: "store_astoria", items: Array.from({ length: 210 }, (_, n) => ({ ...edition.items[0], id: `item_big_${n}` })) } as Edition;
    await repo.putEdition(big);
    expect((await pendingItems()).length).toBe(200);
  });
});

describe("POST /api/jobs/results", () => {
  async function post(results: JobResult[], extra: Record<string, unknown> = {}) {
    return signedPost(postJobResults, "/api/jobs/results", { results, jobId: "job-1", scriptSha: "a".repeat(64), startedAt: iso(), ...extra });
  }
  const resultFor = (itemId: string, g: ReturnType<typeof verdict>): JobResult => ({ editionId: "ed_s2_1", itemId, guardrail: g });

  it("certifies passed items: checkedBy, certifiedAt and jobId are stored, the version moves", async () => {
    await pendingItems();
    const target = edition.items[0];
    const res = await post([resultFor(target.id, verdict("passed"))]);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ updated: 1 });
    const stored = (await repo.getEdition("ed_s2_1"))!.items.find((i) => i.id === target.id)!;
    expect(stored.guardrail).toMatchObject({ status: "passed", checkedBy: NEMO, jobId: "job-1" });
    expect(stored.guardrail.certifiedAt).toBeTruthy();
    expect(stored.version).toBe(target.version + 1);
    expect(stored.status).toBe(target.status);
    expect((await pendingItems()).map((i) => i.itemId)).not.toContain(target.id);
  });

  it("forces checkedBy to NeMo even if the body says live, and fills certifiedAt and jobId", async () => {
    await pendingItems();
    const target = edition.items[1];
    await post([resultFor(target.id, { ...verdict("passed"), checkedBy: "live" as never, certifiedAt: undefined as never, jobId: undefined as never })]);
    const stored = (await repo.getEdition("ed_s2_1"))!.items.find((i) => i.id === target.id)!;
    expect(stored.guardrail).toMatchObject({ checkedBy: NEMO, jobId: "job-1" });
    expect(stored.guardrail.certifiedAt).toBeTruthy();
  });

  it("flips an approved item NeMo blocks to flagged, with the reason, and flags the edition", async () => {
    const target = edition.items[0];
    await repo.putEdition({ ...edition, status: "approved", items: edition.items.map((i) => ({ ...i, status: "approved" as const })) });
    await pendingItems();
    await post([resultFor(target.id, verdict("blocked"))]);
    const after = (await repo.getEdition("ed_s2_1"))!;
    const stored = after.items.find((i) => i.id === target.id)!;
    expect(stored.status).toBe("flagged");
    expect(stored.guardrail.status).toBe("blocked");
    expect(stored.guardrail.reasons[0]).toMatch(/NeMo self check output/);
    expect(stored.version).toBe(target.version + 1);
    expect(after.status).toBe("flagged");
    expect(after.items.filter((i) => i.status === "approved")).toHaveLength(edition.items.length - 1);
  });

  it("drops a verdict for copy that changed after the job read it", async () => {
    await pendingItems();
    const target = edition.items[0];
    const current = (await repo.getEdition("ed_s2_1"))!;
    await repo.putEdition({ ...current, items: current.items.map((i) => (i.id === target.id && i.kind === "special" ? { ...i, description: "A different line, edited meanwhile." } : i)) });
    const res = await post([resultFor(target.id, verdict("passed"))]);
    expect(await res.json()).toEqual({ updated: 0 });
    expect((await repo.getEdition("ed_s2_1"))!.items.find((i) => i.id === target.id)!.guardrail.checkedBy).toBeUndefined();
  });

  it("still applies when only the item's status moved (same copy, newer version)", async () => {
    await pendingItems();
    const target = edition.items[0];
    const current = (await repo.getEdition("ed_s2_1"))!;
    await repo.updateEditionItem("ed_s2_1", { ...current.items.find((i) => i.id === target.id)!, status: "approved" }, target.version);
    const res = await post([resultFor(target.id, verdict("passed"))]);
    expect(await res.json()).toEqual({ updated: 1 });
    const stored = (await repo.getEdition("ed_s2_1"))!.items.find((i) => i.id === target.id)!;
    expect(stored).toMatchObject({ status: "approved", version: target.version + 2 });
  });

  it("applies nothing without a snapshot (never read), for rejected items, for `unchecked`, and for unknown ids", async () => {
    const target = edition.items[0];
    expect(await (await post([resultFor(target.id, verdict("passed"))])).json()).toEqual({ updated: 0 });
    await pendingItems();
    const current = (await repo.getEdition("ed_s2_1"))!;
    await repo.putEdition({ ...current, items: current.items.map((i) => (i.id === target.id ? { ...i, status: "rejected" as const } : i)) });
    const res = await post([
      resultFor(target.id, verdict("passed")),
      resultFor(edition.items[1].id, { ...verdict("passed"), status: "unchecked" as never }),
      resultFor("item_nope", verdict("passed")),
      { editionId: "ed_nope", itemId: "x", guardrail: verdict("passed") },
    ]);
    expect(await res.json()).toEqual({ updated: 0 });
  });

  it("certifies the staff card by token; a blocked card is stored as blocked", async () => {
    await pendingItems();
    const res = await post([resultFor("tok_s2_card_0001", verdict("blocked"))]);
    expect(await res.json()).toEqual({ updated: 1 });
    const card = (await repo.getStaffCardByToken("tok_s2_card_0001"))!;
    expect(card.guardrail).toMatchObject({ status: "blocked", checkedBy: NEMO });
    expect((await pendingItems()).map((i) => i.itemId)).not.toContain("tok_s2_card_0001");
  });

  it("records a JobRun with mode certify, the script sha and the job name", async () => {
    await pendingItems();
    await post([resultFor(edition.items[0].id, verdict("passed")), resultFor(edition.items[1].id, verdict("blocked"))], { failed: 2 });
    const [run] = await readJobRuns(repo);
    expect(run).toMatchObject({ mode: "certify", scriptSha: "a".repeat(64), nebiusJobId: "job-1", status: "done", trigger: "manual" });
    expect(run.note).toMatch(/Certified 2 items.*1 passed, 1 blocked.*1 flipped to flagged.*2 without a verdict/);
    expect(run.storeIds).toEqual([edition.storeId]);
    expect((await repo.getJobRun(run.id))!.mode).toBe("certify");
    await post([resultFor(edition.items[2].id, verdict("passed"))]);
    expect(await readJobRuns(repo)).toHaveLength(1); // same job id: one row, overwritten
  });

  it("auth: no signature 400, wrong secret 401, replay 401, no ts 400; a body over 256 KB is 413", async () => {
    const raw = JSON.stringify({ ts: nowSec(), results: [] });
    expect((await postJobResults(req("/api/jobs/results", { method: "POST", body: raw }))).status).toBe(400);
    expect((await signedPost(postJobResults, "/api/jobs/results", { results: [] }, { secret: "wrong-secret-wrong-secret-wrong-secret-1234" })).status).toBe(401);
    const sent = await signedPost(postJobResults, "/api/jobs/results", { results: [] }, { raw });
    expect(sent.status).toBe(200);
    const replay = await signedPost(postJobResults, "/api/jobs/results", { results: [] }, { raw });
    expect(await replay.json()).toMatchObject({ code: "replayed_signature" });
    expect((await signedPost(postJobResults, "/api/jobs/results", { results: [] }, { raw: JSON.stringify({ results: [] }) })).status).toBe(400);
    const big = await signedPost(postJobResults, "/api/jobs/results", {}, { raw: "x".repeat(256 * 1024 + 1) });
    expect(big.status).toBe(413);
  });

  it("a results body of 200 verdicts (well over 16 KB) is accepted", async () => {
    await pendingItems();
    const filler = Array.from({ length: 200 }, (_, n) => resultFor(`item_none_${n}`, verdict("passed", { reasons: ["Passed: our regex catalogue (run by NeMo Guardrails) and NeMo's self check output on Lightning."] })));
    const res = await post(filler);
    expect(JSON.stringify(filler).length).toBeGreaterThan(16 * 1024);
    expect(res.status).toBe(200);
  });
});

describe("POST /api/jobs/eval", () => {
  const rows = [
    ...Array.from({ length: 40 }, (_, n) => ({ phrase: `Red team ${n}`, expected: "block" as const, got: n < 38 ? ("block" as const) : ("pass" as const) })),
    ...Array.from({ length: 10 }, (_, n) => ({ phrase: `Benign ${n}`, expected: "pass" as const, got: n === 0 ? ("block" as const) : ("pass" as const) })),
  ];
  const result = (over: Record<string, unknown> = {}) => ({
    at: iso(), cases: 40, caught: 38, falsePositives: 1, benign: 10, catchRate: 0.95, falsePositiveRate: 0.1,
    model: "nvidia/Nemotron-3_5-Lightning", jobId: "job-eval-1", rows, ...over,
  });

  it("stores the EvalResult under eval:latest and records an eval JobRun", async () => {
    const res = await signedPost(postJobEval, "/api/jobs/eval", { ...result(), scriptSha: "b".repeat(64), startedAt: iso() });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const saved = await repo.cacheGet<unknown>(EVAL_KEY);
    expect(EvalResult.safeParse(saved).success).toBe(true);
    expect(saved).toMatchObject({ caught: 38, falsePositives: 1, jobId: "job-eval-1" });
    const [run] = await readJobRuns(repo);
    expect(run).toMatchObject({ mode: "eval", scriptSha: "b".repeat(64), nebiusJobId: "job-eval-1" });
    expect(run.note).toBe("Caught 38 of 40 red-team phrases; 1 of 10 benign phrases wrongly blocked.");
  });

  it("refuses rates that the rows do not support", async () => {
    for (const bad of [{ caught: 40 }, { catchRate: 1 }, { falsePositives: 0 }, { cases: 41 }]) {
      const res = await signedPost(postJobEval, "/api/jobs/eval", result(bad));
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ code: "eval_inconsistent" });
    }
    expect(await repo.cacheGet(EVAL_KEY)).toBeNull();
  });

  it("is signed: wrong secret 401, replay 401", async () => {
    expect((await signedPost(postJobEval, "/api/jobs/eval", result(), { secret: "wrong-secret-wrong-secret-wrong-secret-1234" })).status).toBe(401);
    const raw = JSON.stringify({ ts: nowSec(), ...result() });
    expect((await signedPost(postJobEval, "/api/jobs/eval", {}, { raw })).status).toBe(200);
    expect((await signedPost(postJobEval, "/api/jobs/eval", {}, { raw })).status).toBe(401);
  });
});
