import { beforeEach, describe, expect, it } from "vitest";
import type { JobResult } from "@/contract";
import { sampleSeed } from "@/server/sample/chain";
import { ensureDemoWorkspace } from "../session";
import type { Repo } from "../store";
import type { SeedWithId } from "../store/keyed-repo";
import { applyResults, itemText, listPending } from "./certify";
import { cardFor, cleanEdition, fakePorts, freshApp } from "../../../tests/e/helpers";

const NEMO = "nemo-guardrails@nebius-job" as const;
const verdict = (status: "passed" | "blocked" = "passed") => ({ status, reasons: ["NeMo"], checkedBy: NEMO, certifiedAt: new Date().toISOString(), jobId: "x", ...(status === "blocked" ? { rail: "self check output" } : {}) });
const resultFor = (editionId: string, itemId: string, status: "passed" | "blocked" = "passed"): JobResult => ({ editionId, itemId, guardrail: verdict(status) }) as JobResult;

let repo: Repo;
beforeEach(async () => {
  repo = freshApp({ LE_JOB_SECRET: "c".repeat(40) }, fakePorts());
  await ensureDemoWorkspace(repo);
  await repo.putEdition(cleanEdition("store_williamsburg", "ed_demo_1"));
  await repo.putStaffCard(cardFor(cleanEdition("store_williamsburg", "ed_demo_1"), "tok_demo_card_0001"));
});

describe("L4: certify results are scoped to the demo chain", () => {
  async function visitorEdition() {
    const seed = sampleSeed();
    await repo.createWorkspace({ ...seed, chain: { ...seed.chain, id: "chain_visitor" }, stores: seed.stores.map((s) => ({ ...s, id: `${s.id}~v`, chainId: "chain_visitor" })), workspaceId: "ws_visitor1" } as SeedWithId);
    const base = cleanEdition("store_williamsburg", "ed_visitor_1");
    const edition = { ...base, storeId: "store_williamsburg~v" };
    await repo.putEdition(edition);
    return edition;
  }

  it("skips an edition from another workspace even when a snapshot for its items exists", async () => {
    const foreign = await visitorEdition();
    const target = foreign.items[0];
    // As if an earlier bug or a hand-written snapshot named the foreign item: its digest matches its current copy.
    const { sha256Hex } = await import("./batch-runs");
    await repo.cachePut("certify:snapshot:job-x", { [`${foreign.id}:${target.id}`]: (await sha256Hex(itemText(target))).slice(0, 16) }, 600);
    const out = await applyResults(repo, [resultFor(foreign.id, target.id, "blocked")], { jobId: "job-x" });
    expect(out).toMatchObject({ updated: 0, flipped: 0, skipped: 1 });
    const stored = (await repo.getEdition(foreign.id))!.items.find((i) => i.id === target.id)!;
    expect(stored).toMatchObject({ status: "draft", version: target.version });
    expect(stored.guardrail.checkedBy).toBeUndefined();
  });

  it("still certifies the demo chain's own editions and staff cards", async () => {
    const pending = await listPending(repo, 200, "job-a");
    expect(pending.map((p) => p.editionId)).toEqual(expect.arrayContaining(["ed_demo_1"]));
    const demo = (await repo.getEdition("ed_demo_1"))!;
    const out = await applyResults(repo, [resultFor("ed_demo_1", demo.items[0].id), resultFor("ed_demo_1", "tok_demo_card_0001")], { jobId: "job-a" });
    expect(out.updated).toBe(2);
    expect((await repo.getStaffCardByToken("tok_demo_card_0001"))!.guardrail.checkedBy).toBe(NEMO);
  });
});

describe("L4: the snapshot belongs to one job", () => {
  it("keeps what each job was sent, so a second /pending call does not clobber the first job's snapshot", async () => {
    const first = await listPending(repo, 200, "job-a");
    const demo = (await repo.getEdition("ed_demo_1"))!;
    // job B reads meanwhile, after head office edited the first item's copy
    await repo.putEdition({ ...demo, items: demo.items.map((i, n) => (n === 0 && i.kind === "special" ? { ...i, description: "Edited between the two jobs." } : i)) });
    await listPending(repo, 200, "job-b");
    const out = await applyResults(repo, first.filter((p) => p.editionId === "ed_demo_1" && p.kind !== "card").map((p) => resultFor(p.editionId, p.itemId)), { jobId: "job-a" });
    // job A was sent the old copy of item 0: stale for A even though job B has the new digest; the others are fine
    expect(out.stale).toBe(1);
    expect(out.updated).toBe(first.filter((p) => p.editionId === "ed_demo_1" && p.kind !== "card").length - 1);
    const outB = await applyResults(repo, [resultFor("ed_demo_1", demo.items[0].id)], { jobId: "job-b" });
    expect(outB.updated).toBe(1);
  });

  it("a verdict from a job that was never sent anything is stale for every item, not read from another job's snapshot", async () => {
    await listPending(repo, 200, "job-a");
    const demo = (await repo.getEdition("ed_demo_1"))!;
    const out = await applyResults(repo, [resultFor("ed_demo_1", demo.items[0].id)], { jobId: "job-never" });
    expect(out.updated).toBe(0);
    expect(out.stale).toBe(1);
  });

  it("a request that names no job uses the shared slot, and a job-named result can fall back to it", async () => {
    await listPending(repo);
    const demo = (await repo.getEdition("ed_demo_1"))!;
    expect((await applyResults(repo, [resultFor("ed_demo_1", demo.items[0].id)], { jobId: "job-z" })).updated).toBe(1);
  });

  it("a version bump with the same copy (approved while the job ran) still takes the verdict; changed copy does not", async () => {
    await listPending(repo, 200, "job-a");
    const demo = (await repo.getEdition("ed_demo_1"))!;
    const b = demo.items.find((i) => i.kind === "special")!;
    const a = demo.items.find((i) => i.id !== b.id)!;
    await repo.updateEditionItem("ed_demo_1", { ...a, status: "approved" }, a.version);
    await repo.updateEditionItem("ed_demo_1", { ...b, description: "Rewritten meanwhile." } as never, b.version);
    const out = await applyResults(repo, [resultFor("ed_demo_1", a.id), resultFor("ed_demo_1", b.id)], { jobId: "job-a" });
    expect(out).toMatchObject({ updated: 1, stale: 1 });
  });
});
