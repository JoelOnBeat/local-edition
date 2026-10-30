import { describe, expect, it } from "vitest";
import { UpstreamError } from "../http/errors";
import { scriptedTf, jsonRes } from "../tokenfactory/test-utils";
import { failedTriage } from "../tavily/triage";
import { selfCheckOutput } from "./self-check";

describe("Lightning unavailable: the live guardrail check and the event triage skip with a plain note", () => {
  it("the self check is skipped (never a pass, never a block) and names the model", async () => {
    const { tf } = scriptedTf(() => jsonRes({ error: { code: "model_not_found" } }, 404));
    expect(await selfCheckOutput(tf, "A warm cardamom bun.", "special", ["warm"])).toEqual({
      outcome: "skipped",
      why: "Nemotron 3.5 Lightning is unavailable on Token Factory right now",
    });
  });

  it("a failed event triage says the model is unavailable, and still reads 'Not checked'", () => {
    const e = new UpstreamError("upstream_4xx", "tokenfactory", "x", { status: 404 });
    const t = failedTriage({ title: "Brooklyn Record Fair", url: "https://example.com/e", snippet: "Vinyl", score: 0.9, pageText: null } as never, e);
    expect(t).toMatchObject({ kept: false, reason: "Not checked: Nemotron 3.5 Lightning is unavailable on Token Factory right now." });
    // Other failures keep their old wording.
    expect(failedTriage({ title: "x" } as never, new UpstreamError("timeout", "tokenfactory", "x")).reason).toBe("Not checked: the model was unavailable.");
  });
});
