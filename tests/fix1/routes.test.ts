import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET as searchGET } from "@/app/api/anchors/search/route";
import { POST as readPOST } from "@/app/api/menu/read/route";
import { resetEnvCache } from "@/lib/env";
import { BODY_LIMITS } from "@/server/http/api";
import { resetQlooClient } from "@/server/qloo/client";
import { setTokenFactory } from "@/server/tokenfactory/client";
import { resetTokenFactoryMeter } from "@/server/tokenfactory/spend";

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0];
const saved = { ...process.env };

beforeEach(() => {
  process.env.QLOO_MODE = "fixture";
  process.env.TF_MODE = "fixture";
  delete process.env.NEBIUS_API_KEY;
  resetEnvCache();
  resetQlooClient();
  resetTokenFactoryMeter();
  setTokenFactory(undefined);
});
afterEach(() => {
  process.env = { ...saved };
  resetEnvCache();
  resetQlooClient();
  setTokenFactory(undefined);
});

const search = (q: string, o: { cookie?: string; ip?: string } = {}) =>
  searchGET(new Request(`http://localhost/api/anchors/search?q=${encodeURIComponent(q)}`, {
    headers: { ...(o.cookie ? { cookie: o.cookie } : {}), "cf-connecting-ip": o.ip ?? "198.51.100.20" },
  }));

function readReq(o: { cookie?: string; ip?: string; bytes?: number[] } = {}) {
  const form = new FormData();
  form.set("image", new File([new Uint8Array(o.bytes ?? PNG)], "menu.png", { type: "image/png" }));
  return new Request("http://localhost/api/menu/read", {
    method: "POST",
    body: form,
    headers: { ...(o.cookie ? { cookie: o.cookie } : {}), "cf-connecting-ip": o.ip ?? "198.51.100.21" },
  });
}
const cookieOf = (res: Response) => (res.headers.get("set-cookie") ?? "").split(";")[0];

describe("M10 anchors search is a workspace route with limits", () => {
  it("resolves a workspace (sets the le_ws cookie for a new visitor) and answers", async () => {
    const res = await search("blue bottle");
    expect(res.status).toBe(200);
    expect(cookieOf(res)).toMatch(/^le_ws=/);
  });

  it("limits per workspace: 30 lookups, then 429 {error, code}", async () => {
    const first = await search("q0", { ip: "198.51.100.30" });
    const cookie = cookieOf(first);
    for (let i = 1; i < 30; i++) expect((await search(`q${i}`, { cookie, ip: `198.51.100.${40 + (i % 50)}` })).status).toBe(200);
    const blocked = await search("q31", { cookie, ip: "198.51.100.99" });
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toMatchObject({ code: "rate_limited", error: expect.any(String) });
  });

  it("limits per IP before the cookie is even looked at: 60 lookups from one address, then 429", async () => {
    let blocked = 0;
    for (let i = 0; i < 70; i++) {
      const res = await search(`q${i}`, { ip: "198.51.100.77", cookie: undefined });
      if (res.status === 429) blocked++;
    }
    expect(blocked).toBeGreaterThan(0);
  });
});

describe("H1 menu read is a workspace route with limits", () => {
  it("answers for a new visitor and sets the workspace cookie", async () => {
    const res = await readPOST(readReq());
    expect(res.status).toBe(200);
    expect(cookieOf(res)).toMatch(/^le_ws=/);
    expect(res.headers.get("x-le-mode")).toBe("fixture");
  });

  it("limits per workspace: 6 reads, then 429", async () => {
    const cookie = cookieOf(await readPOST(readReq({ ip: "198.51.100.50" })));
    for (let i = 1; i < 6; i++) expect((await readPOST(readReq({ cookie, ip: `198.51.100.${60 + i}` }))).status).toBe(200);
    const blocked = await readPOST(readReq({ cookie, ip: "198.51.100.90" }));
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toMatchObject({ code: "rate_limited" });
  });

  it("limits per IP: 12 uploads from one address (each with its own workspace), then 429 without reading the upload", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 14; i++) statuses.push((await readPOST(readReq({ ip: "198.51.100.120" }))).status);
    expect(statuses.slice(0, 10).every((s) => s === 200)).toBe(true);
    expect(statuses).toContain(429);
  });

  it("an upload far over the body limit is 413 payload_too_large", async () => {
    const huge = new Uint8Array(BODY_LIMITS.multipart + 1024);
    huge.set(PNG);
    const form = new FormData();
    form.set("image", new File([huge], "menu.png", { type: "image/png" }));
    const big = await readPOST(new Request("http://localhost/api/menu/read", { method: "POST", body: form, headers: { "cf-connecting-ip": "198.51.100.131" } }));
    expect(big.status).toBe(413);
    expect(await big.json()).toMatchObject({ code: "payload_too_large" });
  });
});
