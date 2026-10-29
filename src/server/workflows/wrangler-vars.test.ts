import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/** Reads wrangler.jsonc's vars (comments stripped, strings left alone). */
function wranglerVars(): Record<string, string> {
  const text = readFileSync(resolve(__dirname, "../../../wrangler.jsonc"), "utf8");
  const stripped = text.replace(/"(?:[^"\\]|\\.)*"|\/\/[^\n]*/g, (m) => (m.startsWith('"') ? m : ""));
  return (JSON.parse(stripped.replace(/,(\s*[}\]])/g, "$1")) as { vars: Record<string, string> }).vars;
}

describe("L9: the deployed Worker's provider modes", () => {
  it("sets TF_MODE and TAVILY_MODE live and QLOO_MODE replay (live once QLOO_API_KEY is set)", () => {
    const vars = wranglerVars();
    expect(vars).toMatchObject({ TF_MODE: "live", TAVILY_MODE: "live", QLOO_MODE: "replay" });
  });

  it("keeps the other production vars", () => {
    expect(wranglerVars()).toMatchObject({ STORE_DRIVER: "d1", BUILD_MODE: "workflow", APP_URL: "https://localedition.pages.dev" });
  });
});
