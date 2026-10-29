import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { gunzipSync } from "node:zlib";
import { buildLocalEditionJob, MAX_INJECTED_TOTAL_BYTES } from "../nebius/job-spec";
import { JOB_BUNDLE, JOB_PACK_B64 } from "./job-bundle.generated";

const root = resolve(__dirname, "../../..");

describe("the Nebius job bundle", () => {
  it("is in step with jobs/ and guardrails/ (run `npm run gen:job-bundle` after editing them)", async () => {
    const gen = (await import(/* @vite-ignore */ resolve(root, "scripts/gen-job-bundle.mjs"))) as { SOURCES: Record<string, string>; render(): string };
    expect(Object.keys(JOB_BUNDLE).sort()).toEqual(Object.keys(gen.SOURCES).sort());
    for (const [path, source] of Object.entries(gen.SOURCES)) {
      expect(JOB_BUNDLE[path], `${path} is stale against ${source}`).toBe(readFileSync(resolve(root, source), "utf8"));
    }
  });

  it("holds what certify.py needs next to itself, each file under the 64 KiB injection limit", () => {
    for (const must of ["certify.py", "le_http.py", "requirements.txt", "rails/batch.py", "rails/config.yml", "rails/prompts.yml", "rails/rails.co", "rails/phrases.json"]) {
      expect(JOB_BUNDLE[must], must).toBeTruthy();
    }
    for (const [path, text] of Object.entries(JOB_BUNDLE)) expect(new TextEncoder().encode(text).length, path).toBeLessThanOrEqual(65536);
  });

  it("carries no secret-looking values", () => {
    for (const text of Object.values(JOB_BUNDLE)) expect(text).not.toMatch(/(?:sk|tf|nvapi|tvly)-[A-Za-z0-9]{16,}/);
  });

  it("ships as one gzipped pack that unpacks to exactly the bundle, and the real request fits Nebius's 64 KiB total", () => {
    const unpacked = JSON.parse(gunzipSync(Buffer.from(JOB_PACK_B64, "base64")).toString("utf8")) as Record<string, string>;
    expect(unpacked).toEqual(JOB_BUNDLE);
    const { request } = buildLocalEditionJob({
      modes: ["certify", "eval"], appUrl: "https://localedition.pages.dev", jobSecret: "j".repeat(64), bundle: JOB_BUNDLE, pack: JOB_PACK_B64, secrets: { NEBIUS_API_KEY: "k".repeat(64) },
    });
    const total = (request.spec.injectedFiles ?? []).reduce((n, f) => n + f.content.length + f.containerPath.length, 0);
    expect(total).toBeLessThan(MAX_INJECTED_TOTAL_BYTES - 10_000); // room to grow
  });
});
