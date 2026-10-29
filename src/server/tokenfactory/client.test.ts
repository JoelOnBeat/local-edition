import { describe, expect, it } from "vitest";
import { MemoryRecorder } from "../http/recorder";
import { createTokenFactory, MODELS, resolveTfMode } from "./client";
import { chatBody, jsonRes, scriptedTf } from "./test-utils";

const tools = [{ type: "function" as const, function: { name: "get_block_profile", description: "x", parameters: { type: "object", properties: { storeId: { type: "string" } }, required: ["storeId"] } } }];

describe("T2 chat", () => {
  it("round-trips a tool call: shape out, assistant turn ready to append, tool result back in", async () => {
    const toolCall = { id: "call_9", type: "function", function: { name: "get_block_profile", arguments: '{"storeId":"st_1"}' } };
    const { tf, calls } = scriptedTf((_u, _b, n) =>
      n === 1 ? jsonRes({ ...chatBody(null, { tool_calls: [toolCall] }), choices: [{ index: 0, finish_reason: "tool_calls", message: { role: "assistant", content: null, tool_calls: [toolCall] } }] }) : jsonRes(chatBody("All set.")),
    );
    const messages = [{ role: "user" as const, content: "Build the edition" }];
    const first = await tf.chat(messages, { model: MODELS.agent, tools, toolChoice: "auto", maxTokens: 500, temperature: 0.2 });
    expect(first.finishReason).toBe("tool_calls");
    expect(first.toolCalls).toEqual([{ id: "call_9", name: "get_block_profile", arguments: '{"storeId":"st_1"}', args: { storeId: "st_1" } }]);
    expect(first.message).toMatchObject({ role: "assistant", content: null, tool_calls: [{ id: "call_9", type: "function", function: { name: "get_block_profile" } }] });

    const second = await tf.chat(
      [...messages, first.message, { role: "tool", tool_call_id: "call_9", content: '{"tags":[]}' }],
      { model: MODELS.agent, tools, maxTokens: 500 },
    );
    expect(second.content).toBe("All set.");
    expect(second.toolCalls).toEqual([]);

    expect(calls[0].url).toBe("https://api.tokenfactory.nebius.com/v1/chat/completions");
    expect(calls[0].body).toMatchObject({ model: MODELS.agent, max_tokens: 500, temperature: 0.2, tool_choice: "auto", tools: [{ function: { name: "get_block_profile" } }] });
    expect(calls[0].headers.authorization).toBe("Bearer test-key-not-real");
    expect(calls[1].body.messages).toHaveLength(3);
  });

  it("keeps invalid tool-call JSON as an argsError instead of throwing", async () => {
    const bad = { id: "c1", type: "function", function: { name: "t", arguments: "{oops" } };
    const { tf } = scriptedTf(() => jsonRes(chatBody(null, { tool_calls: [bad] })));
    const r = await tf.chat([{ role: "user", content: "x" }], { model: MODELS.agent, tools, maxTokens: 10 });
    expect(r.toolCalls[0]).toMatchObject({ name: "t", args: undefined, argsError: expect.any(String) });
  });

  it("retries a 429 (honouring the http layer backoff) and then succeeds", async () => {
    const { tf, fetchImpl } = scriptedTf((_u, _b, n) => (n === 1 ? new Response("", { status: 429, headers: { "retry-after": "1" } }) : jsonRes(chatBody("ok"))));
    const r = await tf.chat([{ role: "user", content: "hi" }], { model: MODELS.copy, maxTokens: 20 });
    expect(r.content).toBe("ok");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("surfaces a persistent 429 as UpstreamError rate_limited (not an SDK error)", async () => {
    const { tf } = scriptedTf(() => new Response("", { status: 429 }));
    await expect(tf.chat([{ role: "user", content: "hi" }], { model: MODELS.copy, maxTokens: 20 })).rejects.toMatchObject({ name: "UpstreamError", code: "rate_limited" });
  });

  it("surfaces an invalid response shape as invalid_response", async () => {
    const { tf } = scriptedTf(() => jsonRes({ nonsense: true }));
    await expect(tf.chat([{ role: "user", content: "hi" }], { model: MODELS.copy, maxTokens: 20 })).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("returns the key-free error message: no key, no upstream body", async () => {
    const { tf } = scriptedTf(() => jsonRes({ error: { message: "bad key test-key-not-real" } }, 401));
    const err = await tf.chat([{ role: "user", content: "hi" }], { model: MODELS.copy, maxTokens: 20 }).catch((e) => e);
    expect(err.code).toBe("unauthorized");
    expect(String(err.message)).not.toContain("test-key");
  });
});

describe("T3 modes", () => {
  it("replay with no recording uses the synthetic fixture and never touches the network", async () => {
    const recorder = new MemoryRecorder();
    const tf = createTokenFactory({ mode: "replay", recorder, fetchImpl: (() => { throw new Error("network used"); }) as never });
    const r = await tf.chat([{ role: "user", content: "hi" }], { model: MODELS.copy, maxTokens: 20 });
    expect(r.mode).toBe("fixture");
    expect(r.content).toMatch(/Synthetic/);
  });

  it("fixture mode returns a tool call built from the tool's schema", async () => {
    const tf = createTokenFactory({ mode: "fixture", recorder: new MemoryRecorder() });
    const r = await tf.chat([{ role: "user", content: "go" }], { model: MODELS.agent, tools, toolChoice: "auto", maxTokens: 100 });
    expect(r.toolCalls[0]).toMatchObject({ name: "get_block_profile", args: { storeId: expect.any(String) } });
    const after = await tf.chat([{ role: "user", content: "go" }, r.message, { role: "tool", tool_call_id: r.toolCalls[0].id, content: "{}" }], { model: MODELS.agent, tools, maxTokens: 100 });
    expect(after.toolCalls).toEqual([]);
  });

  it("live mode without a key fails with missing_key before any call", async () => {
    const tf = createTokenFactory({ mode: "live", recorder: new MemoryRecorder(), fetchImpl: (() => { throw new Error("network used"); }) as never });
    await expect(tf.chat([{ role: "user", content: "x" }], { model: MODELS.copy, maxTokens: 5 })).rejects.toMatchObject({ code: "missing_key" });
  });

  it("TF_MODE=live without a key degrades to replay and says the key is missing", () => {
    expect(resolveTfMode({ TF_MODE: "live", NEBIUS_API_KEY: undefined } as never)).toEqual({ mode: "replay", keyMissing: true });
    expect(resolveTfMode({ TF_MODE: "live", NEBIUS_API_KEY: "k" } as never)).toEqual({ mode: "live", keyMissing: false });
    expect(resolveTfMode({ TF_MODE: "fixture", NEBIUS_API_KEY: undefined } as never)).toEqual({ mode: "fixture", keyMissing: true });
  });
});

describe("T2 embeddings", () => {
  it("batches at 64, keeps order by index, and rejects a short answer", async () => {
    const { tf, calls } = scriptedTf((_u, body) => {
      const input = body.input as string[];
      return jsonRes({ model: MODELS.embedding, data: input.map((t, i) => ({ index: i, embedding: [t.length, 1] })).reverse(), usage: { prompt_tokens: input.length } });
    });
    const texts = Array.from({ length: 130 }, (_, i) => "x".repeat(i + 1));
    const r = await tf.embeddings(texts);
    expect(calls).toHaveLength(3);
    expect((calls[0].body.input as string[]).length).toBe(64);
    expect(r.vectors).toHaveLength(130);
    expect(r.vectors[0][0]).toBe(1);
    expect(r.vectors[129][0]).toBe(130);

    const short = scriptedTf(() => jsonRes({ data: [{ index: 0, embedding: [1] }] }));
    await expect(short.tf.embeddings(["a", "b"])).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("makes no call for an empty list", async () => {
    const { tf, fetchImpl } = scriptedTf(() => jsonRes({}));
    expect((await tf.embeddings([])).vectors).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
