import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST } from "@/app/api/menu/read/route";
import { MemoryRecorder, setRecorder } from "../http/recorder";
import { resetEnvCache } from "@/lib/env";
import { resetTokenFactoryMeter } from "./spend";
import { setTokenFactory } from "./client";
import { scriptedTf } from "./test-utils";

const JPEG = [0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 70, 73, 70, 0];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0];
const WEBP = [..."RIFF"].map((c) => c.charCodeAt(0)).concat([0, 0, 0, 0], [..."WEBP"].map((c) => c.charCodeAt(0)));

function request(file?: File | string) {
  const form = new FormData();
  if (file !== undefined) form.set("image", file);
  return new Request("http://localhost/api/menu/read", { method: "POST", body: form });
}
const img = (bytes: number[] | Uint8Array, type: string, name = "menu.jpg") => new File([new Uint8Array(bytes)], name, { type });

const saved = { ...process.env };
beforeEach(() => {
  process.env.TF_MODE = "fixture";
  delete process.env.NEBIUS_API_KEY;
  resetEnvCache();
  resetTokenFactoryMeter();
  setTokenFactory(undefined);
  setRecorder(new MemoryRecorder());
});
afterEach(() => {
  process.env = { ...saved };
  resetEnvCache();
  setTokenFactory(undefined);
  setRecorder(undefined);
});

describe("T4 POST /api/menu/read", () => {
  it("accepts jpg, png and webp and returns MenuItem[] with the data mode header", async () => {
    for (const [bytes, type] of [[JPEG, "image/jpeg"], [PNG, "image/png"], [WEBP, "image/webp"]] as const) {
      const res = await POST(request(img(bytes, type)));
      expect(res.status).toBe(200);
      expect(res.headers.get("x-le-mode")).toBe("fixture");
      const items = await res.json();
      expect(items.length).toBeGreaterThan(5);
      expect(items[0]).toMatchObject({ source: "vl", currency: "USD" });
    }
  });

  it("rejects a missing image with {error, code}", async () => {
    const res = await POST(request());
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "invalid_input", error: expect.any(String) });
  });

  it("rejects a text field posted as the image", async () => {
    const res = await POST(request("not a file"));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("invalid_input");
  });

  it("rejects the wrong content type", async () => {
    const res = await POST(request(img(JPEG, "image/gif", "menu.gif")));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("invalid_input");
    expect(body.error).toMatch(/jpg, png or webp/);
  });

  it("rejects more than 5 MB", async () => {
    const big = new Uint8Array(5 * 1024 * 1024 + 1);
    big.set(JPEG);
    const res = await POST(request(img(big, "image/jpeg")));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/5 MB/);
  });

  it("rejects bytes that are not an image even when the type claims jpeg", async () => {
    const res = await POST(request(img(new TextEncoder().encode("<html>nope</html>"), "image/jpeg")));
    expect(res.status).toBe(415);
    expect(await res.json()).toEqual({ error: "The file is not a jpg, png or webp image.", code: "unsupported_image" });
  });

  it("rejects an empty file", async () => {
    const res = await POST(request(img([], "image/png", "empty.png")));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("empty_image");
  });

  it("maps upstream failures to {error, code} without leaking the provider body", async () => {
    setTokenFactory(scriptedTf(() => new Response("secret upstream detail", { status: 429 })).tf);
    const limited = await POST(request(img(JPEG, "image/jpeg")));
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ error: "tokenfactory is unavailable (HTTP 429).", code: "rate_limited" });

    setTokenFactory(scriptedTf(() => new Response("{}"), { capUsd: 0 }).tf);
    const capped = await POST(request(img(JPEG, "image/jpeg")));
    expect(capped.status).toBe(402);
    expect((await capped.json()).code).toBe("spend_cap");
  });
});
