import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MenuItem } from "@/contract";
import { POST } from "@/app/api/menu/read/route";
import { resetEnvCache } from "@/lib/env";
import { MemoryBlobStore, setBlobStore } from "../blob";
import { UpstreamError } from "../http/errors";
import { MemoryRecorder, setRecorder } from "../http/recorder";
import { setTokenFactory } from "./client";
import { readMenuBoardDetailed } from "./menu";
import { setPhotoBlob } from "./menu-photo";
import { applyVerify } from "./menu-parse";
import { resetTokenFactoryMeter } from "./spend";
import { chatBody, jsonRes, scriptedTf } from "./test-utils";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 70, 73, 70, 0]);

const READ = {
  items: [
    { name: "Drip Coffee", category: "Coffee", price: 3.25, currency: "USD", confidence: 0.98 },
    { name: "Pour Over", category: "Coffee", price: 6, currency: "USD", confidence: 0.9 },
    { name: "Phantom Latte", category: "Coffee", price: 5, currency: "USD", confidence: 0.8 },
    { name: "Cardamom Bun", category: "Bakery", price: 4.5, currency: "USD", confidence: 0.95 },
  ],
};

const isVerify = (body: Record<string, unknown>) => JSON.stringify(body.messages).includes("Transcription:");

function board(verify: unknown | "bad" | "fail") {
  return scriptedTf((_u, body) => {
    if (!isVerify(body)) return jsonRes(chatBody(JSON.stringify(READ)));
    if (verify === "fail") return new Response("nope", { status: 500 });
    return jsonRes(chatBody(verify === "bad" ? "not json at all" : JSON.stringify(verify)));
  });
}

const VERIFIED = {
  rows: [
    { i: 0, seen: true, price_legible: true },
    { i: 1, seen: true, price_legible: false },
    { i: 2, seen: false, price_legible: false },
    { i: 3, seen: true, price_legible: true },
  ],
};

describe("T3 menu read with a verify pass", () => {
  it("sends the same image plus the extracted rows, drops unseen rows and flags illegible prices", async () => {
    const { tf, calls } = board(VERIFIED);
    const r = await readMenuBoardDetailed(JPEG, "image/jpeg", tf);
    expect(r.verify).toBe("verified");
    expect(r.dropped).toBe(1);
    expect(r.items.map((i) => i.name)).toEqual(["Drip Coffee", "Pour Over", "Cardamom Bun"]);
    expect(r.items.map((i) => [i.seen, i.priceLegible])).toEqual([[true, true], [true, false], [true, true]]);
    expect(r.items.find((i) => i.name === "Pour Over")).toMatchObject({ price: 6 });
    expect(r.items.every((i) => MenuItem.safeParse(i).success)).toBe(true);

    expect(calls).toHaveLength(2);
    for (const c of calls) {
      const parts = (c.body.messages as { content: unknown }[])[1].content as { type: string }[];
      expect(parts.filter((p) => p.type === "image_url")).toHaveLength(1); // one image per request
    }
    const first = calls[0].body.messages as { content: { image_url?: { url: string } }[] }[];
    const second = calls[1].body.messages as { content: { image_url?: { url: string }; text?: string }[] }[];
    expect(second[1].content[0].image_url!.url).toBe(first[1].content[0].image_url!.url);
    expect(second[1].content[1].text).toContain('"name":"Phantom Latte"');
    expect(second[1].content[1].text).toContain('"i":2');
  });

  it("runs both calls with reasoning off", async () => {
    const { tf, calls } = board(VERIFIED);
    await readMenuBoardDetailed(JPEG, "image/jpeg", tf);
    for (const c of calls) {
      expect(c.body).toMatchObject({ reasoning_effort: "none", chat_template_kwargs: { enable_thinking: false } });
    }
  });

  it("reports both calls as steps with tokens and dollars", async () => {
    const { tf } = board(VERIFIED);
    const r = await readMenuBoardDetailed(JPEG, "image/jpeg", tf);
    expect(r.steps.map((s) => s.tool)).toEqual(["menu_extract", "menu_verify"]);
    expect(r.steps.every((s) => s.promptTokens === 100 && s.usd > 0)).toBe(true);
  });

  it("keeps the first read, unflagged, when the verify answer is unusable", async () => {
    for (const verify of ["bad", "fail"] as const) {
      const { tf } = board(verify);
      const r = await readMenuBoardDetailed(JPEG, "image/jpeg", tf);
      expect(r.verify).toBe("skipped");
      expect(r.items).toHaveLength(4);
      expect(r.items.every((i) => i.seen === undefined && i.priceLegible === undefined)).toBe(true);
    }
  });

  it("does not trust a verifier that rejects every row", async () => {
    const { tf } = board({ rows: [0, 1, 2, 3].map((i) => ({ i, seen: false, price_legible: false })) });
    const r = await readMenuBoardDetailed(JPEG, "image/jpeg", tf);
    expect(r).toMatchObject({ verify: "skipped", dropped: 0 });
    expect(r.items).toHaveLength(4);
  });

  it("lets a spend-cap failure on the verify call surface instead of hiding it", async () => {
    const real = board(VERIFIED).tf;
    let n = 0;
    const tf = {
      ...real,
      chat: async (...args: Parameters<typeof real.chat>) => {
        if (++n === 2) throw new UpstreamError("spend_cap", "tokenfactory", "Spend cap reached.");
        return real.chat(...args);
      },
    };
    await expect(readMenuBoardDetailed(JPEG, "image/jpeg", tf)).rejects.toMatchObject({ code: "spend_cap" });
  });

  it("skips the verify call when it is switched off", async () => {
    const { tf, calls } = board(VERIFIED);
    const r = await readMenuBoardDetailed(JPEG, "image/jpeg", tf, { verify: false });
    expect(calls).toHaveLength(1);
    expect(r.verify).toBe("skipped");
  });
});

describe("T2 applyVerify", () => {
  const items = READ.items.map((r, i) => ({ id: `m${i}`, name: r.name, category: "coffee" as const, price: r.price, currency: "USD" as const, description: null, source: "vl" as const }));
  it("flags rows the verifier skipped as unconfirmed (amber) rather than fine", () => {
    const out = applyVerify(items, { rows: [{ i: 0, seen: true, price_legible: true }] });
    expect(out.items.map((i) => i.priceLegible)).toEqual([true, false, false, false]);
    expect(out.items[1].seen).toBeUndefined();
    expect(out.dropped).toBe(0);
  });
});

describe("T4 POST /api/menu/read verify header and photo storage", () => {
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
    setPhotoBlob(undefined);
  });
  const request = () => {
    const form = new FormData();
    form.set("image", new File([JPEG], "menu.jpg", { type: "image/jpeg" }));
    return new Request("http://localhost/api/menu/read", { method: "POST", body: form });
  };

  it("stores the photo under the workspace and reports `verified` with flagged rows", async () => {
    const puts: { ws: string; size: number; mime: string }[] = [];
    setPhotoBlob({
      putPhoto: async (ws, bytes, mime) => (puts.push({ ws, size: bytes.length, mime }), `ws/${ws}/photo.jpg`),
    });
    process.env.TF_MODE = "live";
    process.env.NEBIUS_API_KEY = "test-key-not-real";
    resetEnvCache();
    setTokenFactory(board(VERIFIED).tf);
    const res = await POST(request());
    expect(res.status).toBe(200);
    expect(res.headers.get("x-le-verify")).toBe("verified");
    const items = (await res.json()) as { name: string; priceLegible?: boolean }[];
    expect(items.map((i) => i.name)).toEqual(["Drip Coffee", "Pour Over", "Cardamom Bun"]);
    expect(items[1].priceLegible).toBe(false);
    expect(puts).toHaveLength(1);
    expect(puts[0]).toMatchObject({ size: JPEG.length, mime: "image/jpeg" });
    expect(puts[0].ws).toMatch(/\S/);
  });

  it("still reads the menu when photo storage fails or is not wired", async () => {
    setPhotoBlob({ putPhoto: async () => { throw new Error("r2 down"); } });
    const res = await POST(request());
    expect(res.status).toBe(200);
    expect(res.headers.get("x-le-verify")).toBe("skipped"); // fixture board: no verify call offline
  });

  it("stores through the real blob module by default (a Map under test), keyed ws/<id>/menu-photo.jpg", async () => {
    const store = new MemoryBlobStore();
    setBlobStore(store);
    try {
      const res = await POST(request());
      expect(res.status).toBe(200);
      const keys = [...store.objects.keys()];
      expect(keys).toHaveLength(1);
      expect(keys[0]).toMatch(/^ws\/[^/]+\/menu-photo\.jpg$/);
    } finally {
      setBlobStore(undefined);
    }
  });
});
