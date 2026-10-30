import { describe, expect, it } from "vitest";
import type { MenuItem } from "@/contract";
import { sampleSeed } from "../sample/chain";
import { createMemoryRepo } from "../store/memory";
import { menuItemText, menuVersion, menuVectors, tagVectors, warmMenuEmbeddings } from "./embed-cache";
import type { AgentDeps } from "./ports";
import { embedText, fakeGuardrails, fakeQloo, fakeTavily, fakeTf } from "./test-utils";

/** menu_match's embedding calls: the menu once per menu version (saved in the cache), the tags in one batch, nothing repeated. */

const MENU: MenuItem[] = sampleSeed().menu;
const TAGS = ["hojicha (flavour, e.g. cuisine or specialty dish)", "croissant (cuisine, e.g. cuisine or specialty dish)", "vinyl (flavour, e.g. cuisine or specialty dish)"];

/** One isolate: its own tf object (so its own memory) over a shared repo (the KV). Every embedding request is recorded. */
function isolate(repo = createMemoryRepo(), calls: string[][] = [], over: { delayMs?: number; fail?: boolean } = {}) {
  const base = fakeTf();
  const tf: AgentDeps["tf"] = {
    ...base,
    async embed(texts) {
      calls.push(texts);
      if (over.delayMs) await new Promise((r) => setTimeout(r, over.delayMs));
      if (over.fail) throw new Error("embedding endpoint cold");
      return { vectors: texts.map(embedText), mode: "live" };
    },
  };
  const deps = { repo, chat: { complete: async () => ({ content: null, toolCalls: [] }) }, qloo: fakeQloo(), tavily: fakeTavily(), tf, guardrails: fakeGuardrails(), now: () => new Date("2026-10-30T10:00:00Z") } as unknown as AgentDeps;
  return { deps, calls, repo };
}

describe("menu embeddings are made once per menu version", () => {
  it("embeds the whole menu in ONE call, and the tags in ONE separate call", async () => {
    const { deps, calls } = isolate();
    const menu = await menuVectors(deps, MENU);
    const tags = await tagVectors(deps, TAGS);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual(MENU.map(menuItemText));
    expect(calls[1]).toEqual(TAGS); // every tag in one request, never one request per tag
    expect(menu.source).toBe("embedded");
    expect(tags.vectors).toHaveLength(TAGS.length);
  });

  it("a second isolate (a Workflow step, a cold Worker) reads the saved menu from the cache: only the tags are embedded", async () => {
    const repo = createMemoryRepo();
    const first = isolate(repo);
    await menuVectors(first.deps, MENU);
    const second = isolate(repo);
    const menu = await menuVectors(second.deps, MENU);
    await tagVectors(second.deps, TAGS);
    expect(menu.source).toBe("kv");
    expect(menu.mode).toBe("cache");
    expect(second.calls).toEqual([TAGS]);
    // The saved copy is the same vectors (float32 precision), item for item.
    const original = (await menuVectors(first.deps, MENU)).vectors;
    menu.vectors.forEach((v, i) => v.forEach((x, j) => expect(x).toBeCloseTo(original[i][j], 5)));
  });

  it("the same isolate never repeats a request: menu once, tags once, even when callers race (the agent's retry joins the first call)", async () => {
    const { deps, calls } = isolate(createMemoryRepo(), [], { delayMs: 30 });
    await Promise.all([menuVectors(deps, MENU), menuVectors(deps, MENU), tagVectors(deps, TAGS), tagVectors(deps, TAGS)]);
    await menuVectors(deps, MENU);
    await tagVectors(deps, TAGS);
    expect(calls).toHaveLength(2);
  });

  it("only tags not seen before are sent, in one request", async () => {
    const { deps, calls } = isolate();
    await tagVectors(deps, TAGS.slice(0, 2));
    await tagVectors(deps, TAGS);
    expect(calls).toEqual([TAGS.slice(0, 2), [TAGS[2]]]);
  });

  it("a changed menu is a new version and is embedded again; an unchanged one keeps its version", async () => {
    const repo = createMemoryRepo();
    const a = isolate(repo);
    await menuVectors(a.deps, MENU);
    const edited = MENU.map((m, i) => (i === 0 ? { ...m, description: "Now with cardamom." } : m));
    expect(menuVersion(edited)).not.toBe(menuVersion(MENU));
    expect(menuVersion([...MENU])).toBe(menuVersion(MENU));
    const b = isolate(repo);
    await menuVectors(b.deps, edited);
    expect(b.calls).toEqual([edited.map(menuItemText)]);
  });

  it("a failed embedding is not remembered (the next call tries again) and warming never throws", async () => {
    const { deps, calls } = isolate(createMemoryRepo(), [], { fail: true });
    await expect(menuVectors(deps, MENU)).rejects.toThrow("cold");
    expect(await warmMenuEmbeddings(deps, MENU)).toBeNull();
    expect(calls).toHaveLength(2);
    expect(await warmMenuEmbeddings(deps, [])).toBeNull();
  });

  it("a saved entry of the wrong size is ignored and replaced", async () => {
    const repo = createMemoryRepo();
    const { deps, calls } = isolate(repo);
    await repo.cachePut(`embed:menu:v1:${menuVersion(MENU)}`, { dim: 4, n: 3, f32: "AAAA" }, 60);
    const menu = await menuVectors(deps, MENU);
    expect(menu.source).toBe("embedded");
    expect(calls).toHaveLength(1);
  });
});
