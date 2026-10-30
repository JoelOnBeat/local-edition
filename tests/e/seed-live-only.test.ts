import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Edition } from "@/contract";
import { createVisitorWorkspace, ensureDemoWorkspace } from "@/server/session";
import { hasSyntheticQloo, seedableEditions } from "@/server/sample/live-editions";
import { remapId, type Repo } from "@/server/store";
import { cleanEdition, freshApp } from "./helpers";

let repo: Repo;
beforeEach(() => { repo = freshApp(); });
afterEach(() => vi.unstubAllEnvs());

const withMode = (e: Edition, mode: Edition["evidence"][number]["mode"]): Edition => ({
  ...e, evidence: e.evidence.map((ev) => (ev.source === "qloo" ? { ...ev, mode } : ev)),
});

describe("the sample seed carries only editions built from live Qloo answers (production)", () => {
  it("flags recorded and sample Qloo evidence, accepts live and cached", () => {
    vi.stubEnv("NODE_ENV", "production");
    const e = cleanEdition();
    expect(e.evidence.some((ev) => ev.source === "qloo")).toBe(true);
    expect(hasSyntheticQloo(withMode(e, "fixture"))).toBe(true);
    expect(hasSyntheticQloo(withMode(e, "replay"))).toBe(true);
    expect(hasSyntheticQloo(withMode(e, "live"))).toBe(false);
    expect(hasSyntheticQloo(withMode(e, "cache"))).toBe(false);
  });

  it("skips drafting editions and editions with no items (those stores read No edition yet)", () => {
    vi.stubEnv("NODE_ENV", "production");
    const live = withMode(cleanEdition(), "live");
    expect(seedableEditions([live, { ...live, status: "drafting" }, { ...live, items: [] }])).toEqual([live]);
  });

  it("a new guest workspace copies live editions, never sample ones, and remaps the review's clash ids", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await ensureDemoWorkspace(repo);
    const good = withMode(cleanEdition("store_williamsburg", "ed_demo_wb"), "live");
    good.review = { verdict: "needs_change", reason: "Clashes with Astoria.", clashWith: ["store_astoria"], hint: null, reviewedBy: "m", at: "2026-10-30T14:00:00.000Z" } as Edition["review"];
    await repo.putEdition(good);
    await repo.putEdition(withMode(cleanEdition("store_astoria", "ed_demo_as"), "fixture"));

    const ws = await createVisitorWorkspace(repo);
    const mine = await repo.listEditions({ storeIds: (await repo.listStores(ws.chainId)).map((s) => s.id) });
    expect(mine).toHaveLength(1);
    const copy = mine[0]!;
    expect(copy.evidence.filter((ev) => ev.source === "qloo").every((ev) => ev.mode === "live")).toBe(true);
    const suffix = copy.storeId.split("~")[1]!;
    expect(copy.review?.clashWith).toEqual([remapId("store_astoria", suffix)]);
  });
});
