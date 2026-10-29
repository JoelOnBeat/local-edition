import { describe, expect, it } from "vitest";
import { artistsLocal } from "../qloo/artists";
import { fixtureDeps, store, chain } from "../../../tests/qloo/helpers";
import { ToolMemory } from "./memory";
import { genreTag, TOOL_BY_NAME } from "./tools";
import { harness, WEEK_OF } from "./test-utils";

describe("artists_local genres", () => {
  it("turns plain genre words into Qloo music genre urns", () => {
    expect(genreTag("soul")).toBe("urn:tag:genre:music:soul");
    expect(genreTag(" Indie Pop ")).toBe("urn:tag:genre:music:indie_pop");
    expect(genreTag("R&B / Soul")).toBe("urn:tag:genre:music:r_b_soul");
    expect(genreTag("urn:tag:genre:music:jazz")).toBe("urn:tag:genre:music:jazz");
  });

  async function ctx() {
    const h = await harness({ storeCount: 1 });
    const sc = { chain: (await h.repo.getChain((await h.repo.getWorkspace(h.workspaceId))!.chainId))!, store: (await h.repo.getStore(h.storeIds[0]))!, menu: [], weekOf: WEEK_OF };
    return { h, sc, mem: new ToolMemory() };
  }

  it("passes the urn to Qloo, and tops up from the unfiltered list when the genre leaves too few, so the sound item still has candidates", async () => {
    const { h, sc, mem } = await ctx();
    const asked: (string[] | undefined)[] = [];
    const inner = h.deps.qloo.artistsLocal;
    h.deps.qloo = { ...h.deps.qloo, artistsLocal: async (s, c, o) => { asked.push(o.genres); return o.genres?.length ? { items: [], evidence: [] } : inner(s, c, o); } };
    const out = await TOOL_BY_NAME.get("artists_local")!.run({ sc, deps: h.deps, mem }, { genres: ["soul"] });
    expect(asked).toEqual([["urn:tag:genre:music:soul"], undefined]);
    expect(out.summary).toContain("genre filter was dropped");
    expect(mem.artists.size).toBeGreaterThanOrEqual(8);
    expect(out.payload).toMatchObject({ note: expect.stringContaining("unfiltered") });
  });

  it("keeps genre matches first when the genre found some but not enough", async () => {
    const { h, sc, mem } = await ctx();
    const inner = h.deps.qloo.artistsLocal;
    h.deps.qloo = { ...h.deps.qloo, artistsLocal: async (s, c, o) => { const r = await inner(s, c, {}); return o.genres?.length ? { ...r, items: r.items.slice(0, 2) } : { ...r, items: [...r.items].reverse() }; } };
    await TOOL_BY_NAME.get("artists_local")!.run({ sc, deps: h.deps, mem }, { genres: ["soul"] });
    const names = [...mem.artists.values()].map((e) => e.artist.entity.name);
    const first = (await inner(sc.store, sc.chain, {})).items.slice(0, 2).map((a) => a.entity.name);
    expect(names.slice(0, 2)).toEqual(first);
    expect(new Set(names).size).toBe(names.length);
  });

  it("does not ask twice when the genres matched enough", async () => {
    const { h, sc, mem } = await ctx();
    let calls = 0;
    const inner = h.deps.qloo.artistsLocal;
    h.deps.qloo = { ...h.deps.qloo, artistsLocal: async (s, c, o) => { calls++; return inner(s, c, o); } };
    const out = await TOOL_BY_NAME.get("artists_local")!.run({ sc, deps: h.deps, mem }, { genres: ["indie_pop"] });
    expect(calls).toBe(1);
    expect(out.summary).not.toContain("dropped");
  });
});

describe("Qloo fixture: model-chosen genres", () => {
  const ask = (slug: string, tags: string[]) => artistsLocal(store(slug), [], { tags, take: 20 }, fixtureDeps());

  it("matches a plain genre word against the block's artists instead of returning nothing", async () => {
    const plain = await ask("williamsburg", ["indie pop"]);
    const urn = await ask("williamsburg", ["urn:tag:genre:music:indie_pop"]);
    expect(plain.hits.length).toBeGreaterThan(0);
    expect(plain.hits.map((h) => h.artist.name)).toEqual(urn.hits.map((h) => h.artist.name));
  });

  it("never returns an empty list for a genre, however few of the block's artists carry it", async () => {
    for (const slug of ["williamsburg", "park-slope", "astoria", "harlem", "west-village", "lower-east-side", "upper-east-side", "long-island-city"]) {
      for (const genre of ["reggae", "salsa", "urn:tag:genre:music:bossa_nova", "no such genre"]) {
        expect((await ask(slug, [genre])).hits.length, `${slug} ${genre}`).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it("still narrows by genre when the block has matching artists", async () => {
    const jazz = await ask("harlem", ["jazz"]);
    expect(jazz.hits.length).toBeGreaterThan(0);
    expect(jazz.hits.length).toBeLessThan((await artistsLocal(store("harlem"), [], { take: 50 }, fixtureDeps())).hits.length);
    void chain;
  });
});
