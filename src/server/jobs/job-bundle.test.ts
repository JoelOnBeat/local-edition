import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { JOB_BUNDLE } from "./job-bundle.generated";

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
});
