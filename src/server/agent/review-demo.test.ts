import { describe, expect, it } from "vitest";
import { sampleSeed } from "../sample/chain";
import { buildEditions } from "./build";
import { reviewDemoWorkspace } from "./review-demo";
import { WEEK_OF, collect, harness } from "./test-utils";

/** The demo workspace's build ends with the Ultra review, saved on the editions that the sample workspaces copy. */

const verdicts = (ids: string[]) => JSON.stringify({ reviews: ids.map((storeId) => ({ storeId, verdict: "approve", reason: "Fits the voice and stands alone.", clashWith: [], hint: null })) });

describe("reviewDemoWorkspace", () => {
  it("saves the model's verdict on every built edition, with the reviewer and the time, and writes none itself", async () => {
    const stores = sampleSeed().stores.slice(0, 2).map((x) => x.id);
    const h = await harness({ storeCount: 2, review: () => verdicts(stores) });
    await collect(buildEditions({ workspaceId: h.workspaceId, weekOf: WEEK_OF }, h.deps));
    const out = await reviewDemoWorkspace(h.deps, h.workspaceId);
    expect(out).toEqual({ reviewed: 2, stopped: null });
    for (const e of await h.repo.listEditions({ storeIds: h.storeIds })) {
      expect(e.review).toMatchObject({ verdict: "approve", reason: "Fits the voice and stands alone." });
      expect(e.review?.at).toMatch(/^2026-/);
    }
    expect(h.chat.reviewCalls).toBe(1);
  });

  it("never throws: a workspace with nothing built reports why it stopped", async () => {
    const h = await harness({ storeCount: 2 });
    expect(await reviewDemoWorkspace(h.deps, h.workspaceId)).toEqual({ reviewed: 0, stopped: "no_editions" });
    expect(h.chat.reviewCalls).toBe(0);
  });
});
