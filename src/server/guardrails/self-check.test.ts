import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { INJECTION_RULES, findInjection } from "./injection";
import { SELF_CHECK_OUTPUT_PROMPT, briefText, parseSelfCheckAnswer, renderSelfCheckPrompt } from "./self-check";

const guardrailsDir = join(process.cwd(), "guardrails");

/** The self_check_output prompt body of prompts.yml (a `|-` block scalar indented six spaces). */
function promptFromYaml(): string {
  const yml = readFileSync(join(guardrailsDir, "localedition", "prompts.yml"), "utf8").split("\n");
  const task = yml.findIndex((l) => l.trim() === "- task: self_check_output");
  const start = yml.findIndex((l, i) => i > task && l.trim() === "content: |-") + 1;
  const body: string[] = [];
  for (let i = start; i < yml.length; i++) {
    if (yml[i].trim() !== "" && !yml[i].startsWith("      ")) break;
    body.push(yml[i].startsWith("      ") ? yml[i].slice(6) : "");
  }
  return body.join("\n").trimEnd();
}

describe("self check: same prompt as NeMo's prompts.yml", () => {
  it("the Worker prompt equals guardrails/localedition/prompts.yml, word for word", () => {
    expect(SELF_CHECK_OUTPUT_PROMPT).toBe(promptFromYaml());
  });

  it("briefText matches batch.py brief()", () => {
    expect(briefText(["warm", " short sentences "], "card")).toBe("Brand voice: warm; short sentences. Copy type: card.");
    expect(briefText([], "event")).toBe("Brand voice: none given. Copy type: event.");
  });

  it("fills both variables, even when the copy holds $ patterns", () => {
    const p = renderSelfCheckPrompt("brief $&", "copy $1 {{ user_input }}");
    expect(p).toContain('Brand brief: "brief $&"');
    expect(p).toContain('Copy: "copy $1 {{ user_input }}"');
    expect(p).not.toMatch(/\{\{ bot_response \}\}/);
  });
});

describe("self check: NeMo's is_content_safe reading", () => {
  it.each([
    ["Yes", "block"],
    ["yes.", "block"],
    ["No", "allow"],
    ["no, it fits", "allow"],
    ["Unsafe", "block"],
    ["safe", "allow"],
    ["<think>maybe no</think>\nYes", "block"],
    ["Perhaps", "unknown"],
    ["", "unknown"],
    [null, "unknown"],
  ] as const)("%j -> %s", (raw, verdict) => {
    expect(parseSelfCheckAnswer(raw)).toBe(verdict);
  });
});

describe("injection rules: Python and TypeScript stay identical", () => {
  const file = join(guardrailsDir, "localedition", "injection.py");
  const venv = join(guardrailsDir, ".venv", "bin", "python");
  const python = (args: string[], input?: string) => execFileSync(existsSync(venv) ? venv : "python3", ["-I", file, ...args], { input, encoding: "utf8" });
  const cases: { text: string; blocks: string[] }[] = JSON.parse(readFileSync(join(guardrailsDir, "tests", "injection.json"), "utf8"));

  it("same rule ids, patterns and reasons in the same order", () => {
    const py = JSON.parse(python(["--json"])) as { rules: typeof INJECTION_RULES };
    expect(py.rules).toEqual(INJECTION_RULES);
  });

  it.each(cases.map((c) => [c.text.slice(0, 60), c] as const))("%s", (_label, c) => {
    const fired = findInjection(c.text).map((h) => h.rule.id);
    if (c.blocks.length) for (const id of c.blocks) expect(fired).toContain(id);
    else expect(fired).toEqual([]);
  });

  it("same matches as Python for every case", () => {
    const texts = cases.map((c) => c.text);
    const py = JSON.parse(python(["--check"], JSON.stringify(texts))) as string[][][];
    expect(py).toEqual(texts.map((t) => findInjection(t).map((h) => [h.rule.id, h.match])));
  });
});
