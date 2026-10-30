import { describe, expect, it } from "vitest";
import { UpstreamError } from "../http/errors";
import { agentSkipNote, asModelUnavailable, isModelUnavailable, MODEL_LABELS, ModelUnavailableError, reviewSkipNote } from "../http/model-unavailable";
import { CATALOG_TTL_MS, createModelCatalog } from "./catalog";
import { MODELS } from "./models";
import { chatBody, jsonRes, scriptedTf } from "./test-utils";

const ALL = Object.values(MODELS);
const userMsg = [{ role: "user" as const, content: "hi" }];

describe("modelUnavailable detector", () => {
  it("is true for a 404, a model_not_found hint and our own error", () => {
    expect(isModelUnavailable(new UpstreamError("upstream_4xx", "tokenfactory", "x", { status: 404 }))).toBe(true);
    expect(isModelUnavailable(new UpstreamError("upstream_4xx", "tokenfactory", "x", { status: 400, hint: "model_not_found" }))).toBe(true);
    expect(isModelUnavailable(new ModelUnavailableError(MODELS.agent, "not_listed"))).toBe(true);
  });

  it("is false for auth, rate limits, outages, the spend cap and plain errors", () => {
    for (const code of ["unauthorized", "rate_limited", "upstream_5xx", "timeout", "network", "spend_cap", "invalid_response"] as const) {
      expect(isModelUnavailable(new UpstreamError(code, "tokenfactory", "x", { status: code === "unauthorized" ? 401 : undefined }))).toBe(false);
    }
    expect(isModelUnavailable(new Error("boom"))).toBe(false);
    expect(isModelUnavailable(undefined)).toBe(false);
  });

  it("tags a bare 404 with the model that was in use, and knows a name for every model we use", () => {
    const e = asModelUnavailable(new UpstreamError("upstream_4xx", "tokenfactory", "x", { status: 404 }), MODELS.reviewer);
    expect(e).toMatchObject({ code: "model_unavailable", model: MODELS.reviewer, why: "http_404" });
    expect(asModelUnavailable(new UpstreamError("rate_limited", "tokenfactory", "x"), MODELS.reviewer)).toBeNull();
    for (const id of ALL) expect(MODEL_LABELS[id], id).toBeTruthy();
  });

  it("words the notes the way the product says them", () => {
    expect(agentSkipNote(MODELS.agent)).toBe("Nemotron 3.5 Super VL is unavailable on Token Factory right now; this store will build on the next run.");
    expect(reviewSkipNote(MODELS.reviewer)).toBe("Review skipped: Nemotron 3 Ultra unavailable.");
  });
});

/** The three ways a model can be gone, for every role the client calls. */
const call: Record<string, (tf: ReturnType<typeof scriptedTf>["tf"], model: string) => Promise<unknown>> = {
  chat: (tf, model) => tf.chat(userMsg, { model, maxTokens: 10 }),
  embeddings: (tf) => tf.embeddings(["a coffee"]),
  rawRerank: (tf) => tf.rawRerank("coffee", ["a", "b"]),
};
const ROLES: [string, string, keyof typeof call][] = [
  ["agent (Super VL)", MODELS.agent, "chat"],
  ["vision (Super VL)", MODELS.vision, "chat"],
  ["reviewer (Ultra)", MODELS.reviewer, "chat"],
  ["copy (Lightning)", MODELS.copy, "chat"],
  ["embeddings (Qwen3 Embedding)", MODELS.embedding, "embeddings"],
  ["rerank (Qwen3 Reranker)", MODELS.rerank, "rawRerank"],
];

describe.each(ROLES)("%s", (_role, model, kind) => {
  it("a 404 throws ModelUnavailableError naming the model", async () => {
    const { tf } = scriptedTf(() => jsonRes({ error: { message: "not found" } }, 404));
    await expect(call[kind](tf, model)).rejects.toMatchObject({ name: "ModelUnavailableError", code: "model_unavailable", model, why: "http_404" });
  });

  it("a model_not_found body (even on a 400) is the same", async () => {
    const { tf } = scriptedTf(() => jsonRes({ error: { code: "model_not_found", message: "The model does not exist" } }, 400));
    await expect(call[kind](tf, model)).rejects.toMatchObject({ code: "model_unavailable", model, why: "model_not_found" });
  });

  it("a model missing from /v1/models is refused without a model call", async () => {
    const { tf, calls } = scriptedTf((url) => (url.endsWith("/models") ? jsonRes({ data: [{ id: "some/other-model" }] }) : jsonRes(chatBody("never"))), { modelCatalog: true });
    await expect(call[kind](tf, model)).rejects.toMatchObject({ code: "model_unavailable", model, why: "not_listed" });
    expect(calls.map((c) => c.url.split("/v1/")[1])).toEqual(["models"]);
  });

  it("a model that /v1/models lists is called normally", async () => {
    const { tf, calls } = scriptedTf((url, body) => {
      if (url.endsWith("/models")) return jsonRes({ data: ALL.map((id) => ({ id })) });
      if (url.endsWith("/embeddings")) return jsonRes({ data: (body.input as string[]).map((_, index) => ({ index, embedding: [1, 0] })), usage: { prompt_tokens: 3 } });
      if (url.endsWith("/rerank")) return jsonRes({ model, results: [{ index: 0, relevance_score: 0.9 }] });
      return jsonRes(chatBody("ok"));
    }, { modelCatalog: true });
    await expect(call[kind](tf, model)).resolves.toBeTruthy();
    expect(calls.map((c) => c.url.split("/v1/")[1])[0]).toBe("models");
  });
});

describe("model catalog", () => {
  const clock = () => { let t = 1_000_000; return { now: () => t, advance: (ms: number) => { t += ms; } }; };

  it("reads the list once per ten minutes, however many calls ask", async () => {
    const c = clock();
    let reads = 0;
    const catalog = createModelCatalog({ list: async () => { reads++; return [MODELS.agent]; }, now: c.now });
    expect(await Promise.all([catalog.available(MODELS.agent), catalog.available(MODELS.copy), catalog.available(MODELS.agent)])).toEqual([true, false, true]);
    c.advance(CATALOG_TTL_MS - 1);
    await catalog.available(MODELS.agent);
    expect(reads).toBe(1);
    c.advance(2);
    await catalog.available(MODELS.agent);
    expect(reads).toBe(2);
  });

  it("notices a model coming back at the next refresh", async () => {
    const c = clock();
    let listed: string[] = [MODELS.copy];
    const catalog = createModelCatalog({ list: async () => listed, now: c.now });
    expect(await catalog.available(MODELS.agent)).toBe(false);
    listed = [MODELS.copy, MODELS.agent];
    c.advance(CATALOG_TTL_MS + 1);
    expect(await catalog.available(MODELS.agent)).toBe(true);
  });

  it("says nothing it does not know: an unreadable or empty list lets calls go ahead", async () => {
    for (const list of [async () => null, async () => [], async () => { throw new Error("down"); }]) {
      const catalog = createModelCatalog({ list, now: clock().now });
      expect(await catalog.available(MODELS.agent)).toBe(true);
    }
  });

  it("remembers a 404 for ten minutes, then asks again", async () => {
    const c = clock();
    const catalog = createModelCatalog({ list: async () => ALL, now: c.now });
    expect(await catalog.available(MODELS.agent)).toBe(true);
    catalog.markGone(MODELS.agent);
    expect(await catalog.available(MODELS.agent)).toBe(false);
    expect(await catalog.available(MODELS.copy)).toBe(true);
    c.advance(CATALOG_TTL_MS + 1);
    expect(await catalog.available(MODELS.agent)).toBe(true);
  });

  it("a 404 from the client stops further calls to that model without another request", async () => {
    let chats = 0;
    const { tf } = scriptedTf((url) => {
      if (url.endsWith("/models")) return jsonRes({ data: ALL.map((id) => ({ id })) });
      chats++;
      return jsonRes({}, 404);
    }, { modelCatalog: true });
    await expect(tf.chat(userMsg, { model: MODELS.agent, maxTokens: 5 })).rejects.toMatchObject({ code: "model_unavailable", why: "http_404" });
    await expect(tf.chat(userMsg, { model: MODELS.agent, maxTokens: 5 })).rejects.toMatchObject({ code: "model_unavailable", why: "not_listed" });
    expect(chats).toBe(1);
    // Another model is untouched.
    await expect(tf.chat(userMsg, { model: MODELS.copy, maxTokens: 5 })).rejects.toMatchObject({ model: MODELS.copy, why: "http_404" });
  });

  it("the catalog is off in fixture and replay modes (no /models call)", async () => {
    const { tf, calls } = scriptedTf(() => jsonRes(chatBody("x")), { mode: "fixture", modelCatalog: true });
    await tf.chat(userMsg, { model: MODELS.agent, maxTokens: 5 }).catch(() => undefined);
    expect(calls).toHaveLength(0);
  });
});
