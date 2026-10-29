import { describe, expect, it } from "vitest";
import { MODELS } from "./client";
import { AGENT_REASONING, defaultReasoning, reasoningBody } from "./reasoning";
import { chatBody, jsonRes, scriptedTf } from "./test-utils";

describe("T2 reasoning control", () => {
  it("off sends both switches, low sends the effort, default sends nothing", () => {
    expect(reasoningBody(MODELS.copy, "off")).toEqual({ reasoning_effort: "none", chat_template_kwargs: { enable_thinking: false } });
    expect(reasoningBody(MODELS.agent, "low")).toEqual({ reasoning_effort: "low" });
    expect(reasoningBody(MODELS.agent, "default")).toEqual({});
    expect(reasoningBody(MODELS.agent, undefined)).toEqual({});
  });

  it("sends nothing to a model that is not known to accept the fields", () => {
    expect(reasoningBody("Qwen/Qwen3-Embedding-8B", "off")).toEqual({});
    expect(reasoningBody("someone/else-model", "low")).toEqual({});
  });

  it("copy defaults to off; the agent is off without tools and uses AGENT_REASONING with them", () => {
    expect(defaultReasoning(MODELS.copy, false)).toBe("off");
    expect(defaultReasoning(MODELS.copy, true)).toBe("off");
    expect(defaultReasoning(MODELS.agent, false)).toBe("off");
    expect(defaultReasoning(MODELS.agent, true)).toBe(AGENT_REASONING);
    expect(defaultReasoning(MODELS.reviewer, false)).toBe("default");
  });

  it("chat applies the model default, an explicit setting wins, and extraBody wins over both", async () => {
    const { tf, calls } = scriptedTf(() => jsonRes({ ...chatBody("ok"), usage: { prompt_tokens: 20, completion_tokens: 96, completion_tokens_details: { reasoning_tokens: 93 } } }));
    const base = { maxTokens: 50 };
    const r = await tf.chat([{ role: "user", content: "hi" }], { ...base, model: MODELS.copy });
    expect(calls[0].body).toMatchObject({ reasoning_effort: "none", chat_template_kwargs: { enable_thinking: false } });
    expect(r.usage).toEqual({ inTokens: 20, outTokens: 96, reasoningTokens: 93 });
    await tf.chat([{ role: "user", content: "hi" }], { ...base, model: MODELS.copy, reasoning: "default" });
    expect(calls[1].body.reasoning_effort).toBeUndefined();
    await tf.chat([{ role: "user", content: "hi" }], { ...base, model: MODELS.copy, reasoning: "low", extraBody: { reasoning_effort: "high" } });
    expect(calls[2].body.reasoning_effort).toBe("high");
  });
});
