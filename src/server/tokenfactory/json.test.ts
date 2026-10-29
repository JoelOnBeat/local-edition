import { describe, expect, it } from "vitest";
import { z } from "zod";
import { extractJson, jsonOutput, ModelJsonError } from "./json";
import { MODELS } from "./models";
import { chatBody, jsonRes, scriptedTf } from "./test-utils";

const Pick = z.object({ title: z.string().min(1), score: z.number().int().min(0).max(10) });
const messages = [{ role: "system" as const, content: "You are terse." }, { role: "user" as const, content: "Rate it." }];
const call = (tf: ReturnType<typeof scriptedTf>["tf"]) => ({ tf, model: MODELS.agent, messages, maxTokens: 200 });

describe("T2 extractJson", () => {
  it("handles fences, reasoning blocks and prose around the value", () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('<think>maybe {"x":0}</think>\n{"a":2}')).toEqual({ a: 2 });
    expect(extractJson('Sure! Here it is: {"a":"}{","b":[1,2]} Hope that helps.')).toEqual({ a: "}{", b: [1, 2] });
    expect(extractJson("[1,2]")).toEqual([1, 2]);
    expect(() => extractJson("no json here")).toThrow();
    expect(() => extractJson('{"a":')).toThrow();
  });
});

describe("T4 jsonOutput", () => {
  it("first try: sends a json_schema response_format and returns validated data", async () => {
    const { tf, calls } = scriptedTf(() => jsonRes(chatBody('{"title":"Oat flat white","score":8}')));
    const r = await jsonOutput(Pick, call(tf));
    expect(r).toMatchObject({ data: { title: "Oat flat white", score: 8 }, calls: 1, repaired: false });
    expect(calls[0].body.response_format).toMatchObject({ type: "json_schema", json_schema: { name: "result", schema: { type: "object", properties: { title: { type: "string" } } } } });
    expect(r.usage).toEqual({ inTokens: 100, outTokens: 50 });
  });

  it("falls back to schema-in-prompt when the provider rejects response_format, and remembers it", async () => {
    const { tf, calls } = scriptedTf((_u, body) =>
      body.response_format ? jsonRes({ error: { message: "response_format unsupported" } }, 400) : jsonRes(chatBody('{"title":"x","score":1}')),
    );
    const r = await jsonOutput(Pick, call(tf));
    expect(r.data).toEqual({ title: "x", score: 1 });
    expect(calls).toHaveLength(2);
    expect(calls[1].body.response_format).toBeUndefined();
    const sys = (calls[1].body.messages as { role: string; content: string }[])[0];
    expect(sys.role).toBe("system");
    expect(sys.content).toContain("You are terse.");
    expect(sys.content).toContain("JSON Schema");
    expect(sys.content).toContain('"score"');
    await jsonOutput(Pick, call(tf)); // second run skips the doomed json_schema attempt
    expect(calls).toHaveLength(3);
    expect(calls[2].body.response_format).toBeUndefined();
  });

  it("repairs malformed JSON exactly once, using the repair model", async () => {
    const { tf, calls } = scriptedTf((_u, _b, n) => jsonRes(chatBody(n === 1 ? '{"title":"x","score":"high"}' : '{"title":"x","score":7}')));
    const r = await jsonOutput(Pick, { ...call(tf), repairModel: MODELS.copy });
    expect(r).toMatchObject({ data: { title: "x", score: 7 }, repaired: true, calls: 2 });
    expect(calls[1].body.model).toBe(MODELS.copy);
    const user = (calls[1].body.messages as { role: string; content: string }[]).find((m) => m.role === "user")!;
    expect(user.content).toContain("score");
    expect(user.content).toContain('"score":"high"');
    expect(r.usage.inTokens).toBe(200);
  });

  it("fails cleanly with a typed error after the single repair, never a third call", async () => {
    const { tf, fetchImpl } = scriptedTf(() => jsonRes(chatBody("I cannot do that.")));
    const err = await jsonOutput(Pick, call(tf)).catch((e) => e);
    expect(err).toBeInstanceOf(ModelJsonError);
    expect(err).toMatchObject({ code: "invalid_response", provider: "tokenfactory", issues: expect.any(Array) });
    expect(err.message).not.toContain("cannot do that");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("treats an empty completion as invalid and repairs", async () => {
    const { tf } = scriptedTf((_u, _b, n) => jsonRes(chatBody(n === 1 ? null : '{"title":"ok","score":3}')));
    expect((await jsonOutput(Pick, call(tf))).repaired).toBe(true);
  });

  it("does not swallow a spend cap or rate limit as a JSON problem", async () => {
    const limited = scriptedTf(() => new Response("", { status: 429 }));
    await expect(jsonOutput(Pick, call(limited.tf))).rejects.toMatchObject({ code: "rate_limited" });
    const capped = scriptedTf(() => jsonRes(chatBody("{}")), { capUsd: 0 });
    await expect(jsonOutput(Pick, call(capped.tf))).rejects.toMatchObject({ code: "spend_cap" });
  });

  it("in fixture mode the generated sample satisfies the schema", async () => {
    const { tf } = scriptedTf(() => jsonRes({}), { mode: "fixture" });
    const r = await jsonOutput(z.object({ items: z.array(z.object({ n: z.number().int().min(3), tag: z.enum(["a", "b"]) })).min(2) }), call(tf));
    expect(r.data.items.length).toBeGreaterThanOrEqual(2);
    expect(r.mode).toBe("fixture");
  });
});
