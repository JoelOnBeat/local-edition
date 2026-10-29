import { beforeEach, describe, expect, it } from "vitest";
import { resetEnvCache } from "@/lib/env";
import { ABANDONED_TICKET_MS, MemorySpendStore, PricedSpendMeter } from "../http/spend";
import { MODELS } from "./models";
import { priceUsd, reserveSpend, resetTokenFactoryMeter, settleSpend, TokenFactorySpendMeter, tokenFactoryMeter } from "./spend";
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
    expect((await meter.totals()).usd).toBeCloseTo(0.6);
    await expect(ask()).rejects.toMatchObject({ code: "spend_cap" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("estimates usage when the provider omits it, and meters nothing in replay/fixture", async () => {
    const noUsage = scriptedTf(() => jsonRes({ ...chatBody("x".repeat(4000)), usage: undefined }));
    await noUsage.tf.chat([{ role: "user", content: "y".repeat(4000) }], { model: MODELS.agent, maxTokens: 5 });
    expect((await noUsage.meter.totals()).usd).toBeGreaterThan(0);

    const fx = scriptedTf(() => jsonRes({}), { mode: "fixture" });
    await fx.tf.chat([{ role: "user", content: "hi" }], { model: MODELS.agent, maxTokens: 5 });
    expect((await fx.meter.totals()).usd).toBe(0);
  });

  it("a zero-cap meter refuses the first call", async () => {
    await expect(new TokenFactorySpendMeter(0).reserveUsd(0.000001)).rejects.toMatchObject({ code: "spend_cap" });
  });
});

describe("H1 reserve then settle", () => {
  it("concurrent calls cannot all pass a check-then-act race: reservations count before any call returns", async () => {
    const meter = new TokenFactorySpendMeter(1);
    const results = await Promise.allSettled(Array.from({ length: 10 }, () => meter.reserveUsd(0.3)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(3);
    for (const r of results.filter((x) => x.status === "rejected")) {
      expect((r as PromiseRejectedResult).reason).toMatchObject({ code: "spend_cap" });
    }
    expect((await meter.totals()).usd).toBeCloseTo(0.9);
  });

  it("an input larger than the remaining budget is refused up front, not after the money is gone", async () => {
    const { tf, fetchImpl } = scriptedTf(() => jsonRes(chatBody("ok")), { capUsd: 0.001 });
    const huge = "word ".repeat(400_000); // ~500k tokens of input
    await expect(tf.chat([{ role: "user", content: huge }], { model: MODELS.agent, maxTokens: 100 })).rejects.toMatchObject({ code: "spend_cap" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("a 5xx and a malformed body settle at the reserved estimate, not at zero", async () => {
    for (const make of [
      () => jsonRes({ error: "boom" }, 500),
      () => new Response("<html>", { status: 200 }),
    ]) {
      const { tf, meter } = scriptedTf(make, { capUsd: 5 });
      await expect(tf.chat([{ role: "user", content: "hi" }], { model: MODELS.agent, maxTokens: 1000 })).rejects.toBeTruthy();
      const { usd } = await meter.totals();
      expect(usd).toBeGreaterThan(0);
      expect(usd).toBeCloseTo(priceUsd(MODELS.agent, 1, 1000), 3); // ~ max_tokens of output at the agent price
    }
  });

  it("a successful call settles at the measured usage and releases the rest of the reservation", async () => {
    const { tf, meter } = scriptedTf(() => jsonRes(chatBody("ok", {}, { prompt_tokens: 10, completion_tokens: 10 })), { capUsd: 5 });
    await tf.chat([{ role: "user", content: "hi" }], { model: MODELS.agent, maxTokens: 8000 });
    expect((await meter.totals()).usd).toBeCloseTo(priceUsd(MODELS.agent, 10, 10), 8);
  });

  it("a reservation nobody settled counts as spent once it is abandoned", async () => {
    let now = 1_000_000;
    const meter = new PricedSpendMeter(1, {}, new MemorySpendStore(), () => now);
    const ticket = await meter.reserveUsd(0.4);
    now += ABANDONED_TICKET_MS + 1;
    expect((await meter.totals()).usd).toBeCloseTo(0.4);
    await meter.settleUsd(ticket, 0.1); // a late settle must not count it twice
    expect((await meter.totals()).usd).toBeCloseTo(0.4);
  });
});

describe("H1 the shared meter lives in the repo cache", () => {
  beforeEach(() => {
    process.env.SPEND_CAP_USD = "1";
    resetEnvCache();
    resetTokenFactoryMeter();
  });

  it("reserveSpend and settleSpend enforce SPEND_CAP_USD with code spend_cap", async () => {
    const a = await reserveSpend(0.6);
    await settleSpend(a, 0.6);
    await expect(reserveSpend(0.5)).rejects.toMatchObject({ code: "spend_cap", provider: "tokenfactory" });
    const b = await reserveSpend(0.4);
    await settleSpend(b, 0.4);
    expect((await tokenFactoryMeter().totals())).toEqual({ usd: 1, capUsd: 1 });
  });

  it("a second isolate (a fresh meter over the same repo) sees the first one's spend", async () => {
    await settleSpend(await reserveSpend(0.9), 0.9);
    resetTokenFactoryMeter(); // new isolate: empty process state, same KV
    await expect(reserveSpend(0.2)).rejects.toMatchObject({ code: "spend_cap" });
  });

  it("settling at the estimate (failed call) keeps the money counted", async () => {
    const t = await reserveSpend(0.7);
    await settleSpend(t, t.estimateUsd);
    await expect(reserveSpend(0.4)).rejects.toMatchObject({ code: "spend_cap" });
  });
});
