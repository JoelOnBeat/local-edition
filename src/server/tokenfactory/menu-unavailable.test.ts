import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST } from "@/app/api/menu/read/route";
import { resetEnvCache } from "@/lib/env";
import { setRepo } from "../store";
import { createMemoryRepo } from "../store/memory";
import { MemoryRecorder, setRecorder } from "../http/recorder";
import { RetryAfterError } from "../http/errors";
import { setTokenFactory } from "./client";
import { readMenuBoardDetailed } from "./menu";
import { MODELS } from "./models";
import { resetTokenFactoryMeter } from "./spend";
import { chatBody, jsonRes, scriptedTf } from "./test-utils";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 70, 73, 70, 0]);
const NOTE = "Nemotron 3.5 Super VL is unavailable on Token Factory right now, so the menu photo cannot be read. Try again in a few minutes, or import the menu from Square.";

const ways: [string, (url: string) => Response, boolean][] = [
  ["HTTP 404", () => jsonRes({ error: { message: "not found" } }, 404), false],
  ["model_not_found", () => jsonRes({ error: { code: "model_not_found" } }, 400), false],
  ["missing from /v1/models", (url) => (url.endsWith("/models") ? jsonRes({ data: [{ id: MODELS.copy }] }) : jsonRes(chatBody("{}"))), true],
];

describe.each(ways)("menu vision read (Super VL) unavailable: %s", (_name, handler, catalog) => {
  it("throws a retryable model_unavailable error with the plain note, never a generic failure", async () => {
    const { tf } = scriptedTf(handler, { modelCatalog: catalog });
    const err = await readMenuBoardDetailed(JPEG, "image/jpeg", tf).catch((e) => e);
    expect(err).toBeInstanceOf(RetryAfterError);
    expect(err).toMatchObject({ status: 503, code: "model_unavailable", message: NOTE, retryAfterSeconds: 300 });
  });
});

describe("POST /api/menu/read when Super VL is unavailable", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    process.env.TF_MODE = "fixture";
    delete process.env.NEBIUS_API_KEY;
    resetEnvCache();
    resetTokenFactoryMeter();
    setRecorder(new MemoryRecorder());
    setRepo(createMemoryRepo());
  });
  afterEach(() => {
    process.env = { ...saved };
    resetEnvCache();
    setTokenFactory(undefined);
    setRecorder(undefined);
    setRepo(undefined);
  });

  it("answers 503 { error, code: model_unavailable } with Retry-After and no upstream body", async () => {
    setTokenFactory(scriptedTf(() => jsonRes({ error: { message: "secret upstream detail" } }, 404)).tf);
    const form = new FormData();
    form.set("image", new File([JPEG], "menu.jpg", { type: "image/jpeg" }));
    const res = await POST(new Request("http://localhost/api/menu/read", { method: "POST", body: form }));
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe("300");
    expect(await res.json()).toEqual({ error: NOTE, code: "model_unavailable" });
  });
});
