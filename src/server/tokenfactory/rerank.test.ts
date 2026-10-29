import { describe, expect, it } from "vitest";
import { createTokenFactory } from "./client";
import { MemoryRecorder } from "../http/recorder";
import { jsonRes, scriptedTf } from "./test-utils";

const docs = ["Cardamom bakery and espresso bar", "Tire repair and car wash", "Neighbourhood coffee roaster with pastries"];

describe("T2 rerank", () => {
  it("uses /v1/rerank when it answers, sorted by score", async () => {
    const { tf, calls } = scriptedTf(() =>
      jsonRes({ model: "Qwen/Qwen3-Reranker-8B", results: [{ index: 1, relevance_score: 0.2 }, { index: 2, relevance_score: 0.9 }, { index: 0, relevance_score: 0.5 }], usage: { prompt_tokens: 40 } }),
    );
    const r = await tf.rerank("coffee and pastries", docs);
    expect(r.method).toBe("rerank");
    expect(r.results.map((x) => x.index)).toEqual([2, 0, 1]);
    expect(calls[0].url).toBe("https://api.tokenfactory.nebius.com/v1/rerank");
    expect(calls[0].body).toEqual({ model: "Qwen/Qwen3-Reranker-8B", query: "coffee and pastries", documents: docs });
  });

  it.each([404, 400])("falls back to embedding cosine when /v1/rerank answers %i (model missing)", async (status) => {
    const { tf, calls } = scriptedTf((url, body) => {
      if (url.endsWith("/rerank")) return jsonRes({ error: { message: "model not found" } }, status);
      const input = body.input as string[];
      // query is axis x; doc 2 is closest, doc 0 next, doc 1 orthogonal
      const vec: Record<number, number[]> = { 0: [1, 0], 1: [0.8, 0.6], 2: [0.1, 0.99], 3: [0.95, 0.3] };
      return jsonRes({ data: input.map((_, index) => ({ index, embedding: vec[index] })), usage: { prompt_tokens: 20 } });
    });
    const r = await tf.rerank("coffee and pastries", docs);
    expect(r.method).toBe("embedding-cosine");
    expect(r.results.map((x) => x.index)).toEqual([2, 0, 1]);
    expect(calls.map((c) => c.url.split("/v1/")[1])).toEqual(["rerank", "embeddings"]);
    expect((calls[1].body.input as string[])[0]).toBe("coffee and pastries");
  });

  it("does not hide a spend cap or bad credentials behind the fallback", async () => {
    const auth = scriptedTf(() => jsonRes({}, 401));
    await expect(auth.tf.rerank("q", docs)).rejects.toMatchObject({ code: "unauthorized" });
    const capped = scriptedTf(() => jsonRes({}), { capUsd: 0 });
    await expect(capped.tf.rerank("q", docs)).rejects.toMatchObject({ code: "spend_cap" });
  });

  it("returns nothing for no documents and ranks sensibly in fixture mode", async () => {
    const tf = createTokenFactory({ mode: "fixture", recorder: new MemoryRecorder() });
    expect((await tf.rerank("q", [])).results).toEqual([]);
    const r = await tf.rerank("coffee pastries espresso", docs);
    expect(r.results[0].index).not.toBe(1);
    expect(r.results).toHaveLength(3);
  });
});

describe("T2 rerank availability memo", () => {
  it("after a 404 it skips /v1/rerank and goes straight to embeddings", async () => {
    const { tf, calls } = scriptedTf((url, body) => {
      if (url.endsWith("/rerank")) return jsonRes({ error: { code: "model_not_found" } }, 404);
      const input = body.input as string[];
      return jsonRes({ data: input.map((_, index) => ({ index, embedding: [1, index] })), usage: { prompt_tokens: 5 } });
    });
    await tf.rerank("coffee", docs);
    await tf.rerank("coffee", docs);
    expect(calls.map((c) => c.url.split("/v1/")[1])).toEqual(["rerank", "embeddings", "embeddings"]);
  });
});
