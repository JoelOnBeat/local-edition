import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Workspace } from "@/contract";
import { resetEnvCache } from "@/lib/env";
import { limitSpend } from "@/server/handlers/limit";
import { ipLimited, ipHash } from "@/server/limits";
import { getRepo } from "@/server/store";
import {
  ADMISSION_USD, DEMO_FLOOR_USD, IP_DAILY_BUDGET_USD, ROUTE_ADMISSION_USD, WORKSPACE_BUDGET_USD, budgetsActive, chargeSpendBudget,
} from "@/server/spend-budget";
import { resetTokenFactoryMeter, tokenFactoryMeter } from "@/server/tokenfactory/spend";

/** M2: a per-workspace sub-budget, a per-network daily dollar cap and a reserved floor, all charged before the model is called. */

const saved = { ...process.env };
const NOW = Date.parse("2026-10-29T04:00:00Z");
const spentNothing = async () => 0;
const charge = (usd: number, over: { workspaceId?: string; ipKey?: string } = {}) =>
  chargeSpendBudget({ workspaceId: "ws_a", ipKey: "net1", usd, ...over }, { force: true, now: NOW, capUsd: 5, spentUsd: spentNothing });

beforeEach(() => {
  resetTokenFactoryMeter();
});
afterEach(() => {
  process.env = { ...saved };
  resetEnvCache();
  resetTokenFactoryMeter();
  vi.unstubAllEnvs();
});

describe("the numbers", () => {
  it("are the ones the architect set", () => {
    expect(WORKSPACE_BUDGET_USD).toBe(0.4);
    expect(IP_DAILY_BUDGET_USD).toBe(0.8);
    expect(DEMO_FLOOR_USD).toBe(1.5);
    // A pessimistic 8-store build is $0.20 (docs/CLOUDFLARE.md), so a workspace gets two builds, not twenty.
    expect(ADMISSION_USD.build).toBe(0.2);
    expect(Math.floor(WORKSPACE_BUDGET_USD / ADMISSION_USD.build)).toBe(2);
  });
});

describe("per-workspace sub-budget: $0.40", () => {
  it("admits two builds and refuses the third with 429 workspace_budget", async () => {
    await charge(0.2);
    await charge(0.2);
    await expect(charge(0.2)).rejects.toMatchObject({ status: 429, code: "workspace_budget" });
  });

  it("is per workspace: another workspace on another network starts fresh", async () => {
    await charge(0.4);
    await expect(charge(0.01)).rejects.toMatchObject({ code: "workspace_budget" });
    await expect(charge(0.4, { workspaceId: "ws_b", ipKey: "net2" })).resolves.toBeUndefined();
  });

  it("charges nothing when it refuses", async () => {
    await charge(0.3);
    await expect(charge(0.2)).rejects.toMatchObject({ code: "workspace_budget" });
    await expect(charge(0.1)).resolves.toBeUndefined(); // the refused 0.2 was never taken
    await expect(charge(0.001)).rejects.toMatchObject({ code: "workspace_budget" });
  });
});

describe("per-network daily dollar cap: $0.80", () => {
  it("many workspaces on one network stop at $0.80 in a day", async () => {
    for (const id of ["ws_a", "ws_b"]) await charge(0.4, { workspaceId: id });
    await expect(charge(0.2, { workspaceId: "ws_c" })).rejects.toMatchObject({ status: 429, code: "ip_budget" });
    await expect(charge(0.2, { workspaceId: "ws_d", ipKey: "net2" })).resolves.toBeUndefined();
  });

  it("starts again the next UTC day", async () => {
    for (const id of ["ws_a", "ws_b"]) await charge(0.4, { workspaceId: id });
    await expect(
      chargeSpendBudget({ workspaceId: "ws_c", ipKey: "net1", usd: 0.2 }, { force: true, now: NOW + 24 * 3600_000, capUsd: 5, spentUsd: spentNothing }),
    ).resolves.toBeUndefined();
  });

  it("the refusal says when the day starts over, as a time, and sends Retry-After", async () => {
    // 21:30 UTC: the counter (keyed by UTC date) resets in 2 h 30 min, at 00:00 UTC = 08:00 Kuala Lumpur = 20:00 New York.
    const at = Date.UTC(2026, 9, 30, 21, 30);
    for (const id of ["ws_a", "ws_b"]) await chargeSpendBudget({ workspaceId: id, ipKey: "net1", usd: 0.4 }, { force: true, now: at, capUsd: 5, spentUsd: spentNothing });
    const refused = await chargeSpendBudget({ workspaceId: "ws_c", ipKey: "net1", usd: 0.2 }, { force: true, now: at, capUsd: 5, spentUsd: spentNothing }).catch((e: unknown) => e);
    expect(refused).toMatchObject({ status: 429, code: "ip_budget", retryAfterSeconds: 9000 });
    expect((refused as Error).message).toBe("This network has used its model budget for today. It resets at 08:00 Kuala Lumpur time (00:00 UTC, 20:00 New York), in 2 h 30 min.");
  });

  it("a charge before the cookie is resolved (menu photo, brand voice) counts against the network only", async () => {
    for (let i = 0; i < 40; i++) await charge(0.02, { workspaceId: undefined });
    await expect(charge(0.02, { workspaceId: undefined })).rejects.toMatchObject({ code: "ip_budget" });
  });
});

describe("the reserved floor: $1.50 of the $5 is never a visitor's", () => {
  const withSpent = (spent: number, usd: number) =>
    chargeSpendBudget({ workspaceId: "ws_a", ipKey: "net1", usd }, { force: true, now: NOW, capUsd: 5, spentUsd: async () => spent });

  it("admits a visitor while the total is under $3.50, refuses with 402 spend_cap beyond it", async () => {
    await expect(withSpent(3.2, 0.2)).resolves.toBeUndefined();
    await expect(withSpent(3.4, 0.2)).rejects.toMatchObject({ code: "spend_cap" });
  });

  it("leaves the demo workspace and the weekly cron alone: they are never charged here, and the meter still allows them up to $5", async () => {
    process.env.SPEND_CAP_USD = "5";
    resetEnvCache();
    const meter = tokenFactoryMeter();
    await meter.reserveUsd(3.6); // visitors would be refused (3.6 > 3.5) ...
    await expect(meter.reserveUsd(1.0)).resolves.toBeTruthy(); // ... the cron's own call is not
    await expect(chargeSpendBudget({ workspaceId: "ws_a", ipKey: "n", usd: 0.01 }, { force: true, now: NOW })).rejects.toMatchObject({ code: "spend_cap" });
  });

  it("reads the real meter: a spent cap refuses the visitor, and an unavailable meter refuses with 503 spend_unavailable", async () => {
    process.env.SPEND_CAP_USD = "5";
    resetEnvCache();
    const meter = tokenFactoryMeter();
    await meter.reserveUsd(3.5);
    await expect(chargeSpendBudget({ ipKey: "n", usd: 0.01 }, { force: true, now: NOW })).rejects.toMatchObject({ code: "spend_cap" });
    vi.spyOn(meter, "totals").mockRejectedValue(new Error("DO down"));
    await expect(chargeSpendBudget({ ipKey: "n", usd: 0.01 }, { force: true, now: NOW })).rejects.toMatchObject({ status: 503, code: "spend_unavailable" });
  });
});

describe("only when the model costs money", () => {
  it("is off in replay and fixture mode, on with TF_MODE=live and a key", async () => {
    expect(budgetsActive()).toBe(false);
    Object.assign(process.env, { TF_MODE: "live", NEBIUS_API_KEY: "test-key-not-real" });
    resetEnvCache();
    expect(budgetsActive()).toBe(true);
    Object.assign(process.env, { TF_MODE: "replay" });
    resetEnvCache();
    expect(budgetsActive()).toBe(false);
    for (let i = 0; i < 10; i++) await chargeSpendBudget({ workspaceId: "ws_a", ipKey: "n", usd: 0.2 }); // never refused
  });
});

describe("limitSpend and ipLimited apply it", () => {
  const live = () => {
    Object.assign(process.env, { TF_MODE: "live", NEBIUS_API_KEY: "test-key-not-real", SPEND_CAP_USD: "5" });
    resetEnvCache();
  };
  const ctx = (id: string, ip: string) => ({
    workspace: { id, chainId: "c", createdAt: "2026-10-29T00:00:00Z" } as Workspace,
    request: new Request("http://t.test/api/editions/build", { method: "POST", headers: { "x-forwarded-for": ip } }),
  });

  it("limitSpend refuses a third build in one workspace with 429 workspace_budget", async () => {
    live();
    await limitSpend(ctx("ws_x", "198.51.100.1"), "build");
    await limitSpend(ctx("ws_x", "198.51.100.1"), "build");
    await expect(limitSpend(ctx("ws_x", "198.51.100.1"), "build")).rejects.toMatchObject({ status: 429, code: "workspace_budget" });
  });

  it("limitSpend refuses one network's fifth build across fresh workspaces with 429 ip_budget", async () => {
    live();
    for (const id of ["ws_1", "ws_2"]) {
      await limitSpend(ctx(id, "198.51.100.2"), "build");
      await limitSpend(ctx(id, "198.51.100.2"), "build");
    }
    await expect(limitSpend(ctx("ws_3", "198.51.100.2"), "build")).rejects.toMatchObject({ code: "ip_budget" });
  });

  it("limitSpend never charges the demo workspace", async () => {
    live();
    for (let i = 0; i < 6; i++) await limitSpend(ctx("demo", "198.51.100.3"), "regenerate");
  });

  it("an IPv6 client rotating its low 64 bits shares one network budget", async () => {
    live();
    await limitSpend(ctx("ws_v1", "2001:db8:1:2:aaaa:bbbb:cccc:1"), "build");
    await limitSpend(ctx("ws_v1", "2001:db8:1:2:aaaa:bbbb:cccc:1"), "build");
    await limitSpend(ctx("ws_v2", "2001:db8:1:2:1111:2222:3333:4"), "build");
    await limitSpend(ctx("ws_v2", "2001:db8:1:2:5555:6666:7777:8"), "build");
    await expect(limitSpend(ctx("ws_v3", "2001:db8:1:2:9999:8888:7777:6"), "build")).rejects.toMatchObject({ code: "ip_budget" });
  });

  it("ipLimited charges menu-read to the network's dollar cap, and leaves a plain route (proof) uncharged", async () => {
    live();
    const ok = ipLimited({ name: "menu-read", capacity: 1000, refillPerMinute: 1000 }, async () => new Response("ok"));
    const req = () => new Request("http://t.test/x", { method: "POST", headers: { "x-forwarded-for": "198.51.100.4" } });
    const cost = ROUTE_ADMISSION_USD["menu-read"];
    const fits = Math.floor(IP_DAILY_BUDGET_USD / cost + 1e-9);
    for (let i = 0; i < fits; i++) expect((await ok(req())).status).toBe(200);
    const refused = await ok(req());
    expect(refused.status).toBe(429);
    expect(await refused.json()).toMatchObject({ code: "ip_budget" });
    const plain = ipLimited({ name: "proof", capacity: 1000, refillPerMinute: 1000 }, async () => new Response("ok"));
    expect((await plain(req())).status).toBe(200);
  });

  it("keeps hashed network keys in the cache, never a raw address", async () => {
    live();
    await limitSpend(ctx("ws_k", "198.51.100.5"), "edit");
    const repo = await getRepo();
    const day = new Date().toISOString().slice(0, 10);
    expect(await repo.cacheGet(`sb:ip:${await ipHash("198.51.100.5")}:${day}`)).toMatchObject({ usd: ADMISSION_USD.edit });
    expect(await repo.cacheGet(`sb:ip:198.51.100.5:${day}`)).toBeNull();
  });
});
