import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MIN_JOB_SECRET_LENGTH, parseServerEnv } from "@/lib/env";
import { ensureIgnoredDir, projectRoot, resolveDir } from "@/server/http/dirs";
import { FileRecorder } from "@/server/http/recorder";

afterEach(() => vi.unstubAllEnvs());

describe("LOW env: STORE_DRIVER fails closed in production", () => {
  it("production accepts kv and d1 only", () => {
    for (const driver of ["kv", "d1"]) expect(parseServerEnv({ NODE_ENV: "production", STORE_DRIVER: driver }).STORE_DRIVER).toBe(driver);
    for (const driver of ["file", "memory", undefined]) {
      expect(() => parseServerEnv({ NODE_ENV: "production", STORE_DRIVER: driver })).toThrowError(/STORE_DRIVER must be kv or d1/);
    }
  });

  it("the failure is a 503 config_error HttpError, not a 400 invalid_input ZodError", () => {
    try {
      parseServerEnv({ NODE_ENV: "production" });
      expect.unreachable();
    } catch (e) {
      expect(e).toMatchObject({ status: 503, code: "config_error" });
    }
  });

  it("development and test keep the file default", () => {
    expect(parseServerEnv({}).STORE_DRIVER).toBe("file");
    expect(parseServerEnv({ NODE_ENV: "development", STORE_DRIVER: "memory" }).STORE_DRIVER).toBe("memory");
  });

  it("GUARDRAILS_TOKEN is read, blank means unset; the job secret minimum is 32", () => {
    expect(parseServerEnv({ GUARDRAILS_TOKEN: "abc" }).GUARDRAILS_TOKEN).toBe("abc");
    expect(parseServerEnv({ GUARDRAILS_TOKEN: "" }).GUARDRAILS_TOKEN).toBeUndefined();
    expect(MIN_JOB_SECRET_LENGTH).toBe(32);
  });
});

describe("M8 recordings and .data resolve from the project, not the cwd", () => {
  it("finds the project root by its package.json name, wherever the process started", async () => {
    const root = await projectRoot();
    expect(JSON.parse(await readFile(join(root, "package.json"), "utf8")).name).toBe("local-edition");
    expect(await resolveDir(undefined, ".recordings")).toBe(join(root, ".recordings"));
    expect(await resolveDir(undefined, ".data")).toBe(join(root, ".data"));
  });

  it("LE_RECORDINGS_DIR / LE_DATA_DIR win: absolute as given, relative from the project root", async () => {
    const root = await projectRoot();
    expect(await resolveDir("/var/tmp/le-rec", ".recordings")).toBe("/var/tmp/le-rec");
    expect(await resolveDir("scratch/rec", ".recordings")).toBe(join(root, "scratch/rec"));
    expect(await resolveDir("   ", ".data")).toBe(join(root, ".data"));
  });

  it("the first mkdir writes a self-ignoring .gitignore ('*'), and an existing one is never overwritten", async () => {
    const dir = await mkdtemp(join(tmpdir(), "le-dirs-"));
    try {
      const target = join(dir, "fresh", "data");
      await ensureIgnoredDir(target);
      expect(await readFile(join(target, ".gitignore"), "utf8")).toBe("*\n");
      await writeFile(join(target, ".gitignore"), "custom\n", "utf8");
      await ensureIgnoredDir(target);
      expect(await readFile(join(target, ".gitignore"), "utf8")).toBe("custom\n");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("FileRecorder with no explicit root writes under LE_RECORDINGS_DIR and ignores itself", async () => {
    const dir = await mkdtemp(join(tmpdir(), "le-rec-env-"));
    vi.stubEnv("LE_RECORDINGS_DIR", join(dir, "recordings"));
    try {
      const rec = new FileRecorder();
      await rec.put({ key: "abc123", provider: "qloo", method: "GET", url: "https://x.test/p", status: 200, body: { a: 1 }, recordedAt: "2026-10-29T00:00:00.000Z" });
      expect((await readdir(join(dir, "recordings"))).sort()).toEqual([".gitignore", "qloo"]);
      expect(await readFile(join(dir, "recordings", ".gitignore"), "utf8")).toBe("*\n");
      expect(await rec.get("qloo", "abc123")).toMatchObject({ body: { a: 1 } });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
