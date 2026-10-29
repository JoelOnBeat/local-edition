import { describe, expect, it } from "vitest";
import { MODELS } from "./models";
import { priceUsd, TokenFactorySpendMeter } from "./spend";
import { chatBody, jsonRes, scriptedTf } from "./test-utils";

describe("T2 spend", () => {
  it("prices per million tokens", () => {
    expect(priceUsd(MODELS.vision, 1_000_000, 1_000_000)).toBeCloseTo(1.2);
    expect(priceUsd(MODELS.agent, 1_000_000, 0)).toBeCloseTo(0.3);
    expect(priceUsd(MODELS.copy, 1_000_000, 1_000_000)).toBeCloseTo(0.3);
    expect(priceUsd(MODELS.embedding, 1_000_000, 0)).toBeCloseTo(0.01);
    expect(priceUsd("unknown/model", 1_000_000, 0)).toBeCloseTo(0.3);
  });

  it("trips at the cap with code spend_cap and stops calling out", async () => {
    // 1M in + 1M out on Lightning = $0.30 per call; cap $0.50 -> third call refused.
    const { tf, fetchImpl, meter } = scriptedTf(() => jsonRes(chatBody("ok", {}, { prompt_tokens: 1_000_000, completion_tokens: 1_000_000 })), { capUsd: 0.5 });
    const ask = () => tf.chat([{ role: "user", content: "x" }], { model: MODELS.copy, maxTokens: 5 });
    await ask();
    await ask();
    expect(meter.totals().usd).toBeCloseTo(0.6);
    await expect(ask()).rejects.toMatchObject({ code: "spend_cap" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("estimates usage when the provider omits it, and meters nothing in replay/fixture", async () => {
    const noUsage = scriptedTf(() => jsonRes({ ...chatBody("x".repeat(4000)), usage: undefined }));
    await noUsage.tf.chat([{ role: "user", content: "y".repeat(4000) }], { model: MODELS.agent, maxTokens: 5 });
    expect(noUsage.meter.totals().usd).toBeGreaterThan(0);

    const fx = scriptedTf(() => jsonRes({}), { mode: "fixture" });
    await fx.tf.chat([{ role: "user", content: "hi" }], { model: MODELS.agent, maxTokens: 5 });
    expect(fx.meter.totals().usd).toBe(0);
  });

  it("a zero-cap meter refuses immediately", () => {
    expect(() => new TokenFactorySpendMeter(0).assertUnderCap()).toThrowError(/Spend cap/);
  });
});
