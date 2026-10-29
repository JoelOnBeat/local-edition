import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CATALOGUE_VERSION, findHits, normalizeCopy, reasonsFor, RULES } from "./catalogue";

const root = process.cwd();
const guardrailsDir = join(root, "guardrails");
const catalogueFile = join(guardrailsDir, "localedition", "catalogue.py");

interface Phrase {
  text: string;
  /** Rule ids that must fire; empty means the copy must pass. */
  blocks: string[];
}
const phrases: Phrase[] = JSON.parse(readFileSync(join(guardrailsDir, "tests", "phrases.json"), "utf8"));

function python(args: string[], input?: string): string {
  const venv = join(guardrailsDir, ".venv", "bin", "python");
  const bin = existsSync(venv) ? venv : "python3";
  return execFileSync(bin, ["-I", catalogueFile, ...args], { input, encoding: "utf8" });
}

describe("claim catalogue: phrase table", () => {
  it("has 40+ phrases, both blocking and passing", () => {
    expect(phrases.length).toBeGreaterThanOrEqual(40);
    expect(phrases.filter((p) => p.blocks.length).length).toBeGreaterThanOrEqual(20);
    expect(phrases.filter((p) => !p.blocks.length).length).toBeGreaterThanOrEqual(20);
  });

  it.each(phrases.map((p) => [p.text.slice(0, 60), p] as const))("%s", (_label, p) => {
    const fired = findHits(p.text).map((h) => h.rule.id);
    if (p.blocks.length) {
      for (const id of p.blocks) expect(fired).toContain(id);
    } else {
      expect(fired).toEqual([]);
    }
  });

  it("covers the examples from the brief", () => {
    expect(findHits("oat milk")).toEqual([]);
    expect(findHits("naturally sweet")).toEqual([]);
    expect(findHits("gluten-free").length).toBeGreaterThan(0);
    expect(findHits("boosts your immunity").length).toBeGreaterThan(0);
  });

  it("word boundaries: heartier is not healthier, cured is not cure, palate cleanser is not a detox", () => {
    expect(findHits("A heartier loaf")).toEqual([]);
    expect(findHits("cured ham")).toEqual([]);
    expect(findHits("palate cleanser")).toEqual([]);
  });

  it("reason strings are clear and name the match", () => {
    const reasons = reasonsFor(findHits("A gluten-free bun"));
    expect(reasons.some((r) => r.includes('Matched "gluten-free".'))).toBe(true);
    for (const rule of RULES) expect(rule.reason).toMatch(/^[A-Z][a-z ]+: .+\.$/);
  });

  it("normalises unicode dashes, zero-width characters and fullwidth letters", () => {
    expect(normalizeCopy("a‑b​")).toBe("a-b");
    expect(normalizeCopy(undefined)).toBe("");
    expect(findHits("gluten–free").map((h) => h.rule.id)).toContain("free_from");
  });
});

describe("claim catalogue: Python and TypeScript stay identical", () => {
  const py = JSON.parse(python(["--json"])) as { version: number; rules: typeof RULES };

  it("same version, rule ids, categories, patterns and reasons in the same order", () => {
    expect(py.version).toBe(CATALOGUE_VERSION);
    expect(py.rules).toEqual(RULES.map((r) => ({ id: r.id, category: r.category, pattern: r.pattern, reason: r.reason })));
  });

  it("same matches for every phrase in the table (rule id and matched text)", () => {
    const texts = phrases.map((p) => p.text);
    const pyHits = JSON.parse(python(["--check"], JSON.stringify(texts))) as string[][][];
    const tsHits = texts.map((t) => findHits(t).map((h) => [h.rule.id, h.match]));
    expect(pyHits).toEqual(tsHits);
  });

  it("same matches for extra edge inputs", () => {
    const extra = ["", "   ", "Boost", "GLUTEN", "Vegans welcome", "50 cals", "KETO", "low-sugar", "kids menu for kids", "Ａllergy"];
    const pyHits = JSON.parse(python(["--check"], JSON.stringify(extra))) as string[][][];
    expect(pyHits).toEqual(extra.map((t) => findHits(t).map((h) => [h.rule.id, h.match])));
  });
});
