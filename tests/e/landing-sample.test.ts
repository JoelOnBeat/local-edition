import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Edition } from "@/contract";
import { readLandingSample } from "@/server/landing/sample";
import { ensureDemoWorkspace } from "@/server/session";
import type { Repo } from "@/server/store";
import { cleanEdition, freshApp } from "./helpers";

let repo: Repo;
beforeEach(() => { repo = freshApp(); });
afterEach(() => vi.unstubAllEnvs());

const live = (e: Edition): Edition => ({ ...e, evidence: e.evidence.map((ev) => (ev.source === "qloo" ? { ...ev, mode: "live" as const } : ev)) });

describe("the landing's view of the demo workspace", () => {
  it("is null (so the page says Loading, with numbers hidden) when nothing is built", async () => {
    expect(await readLandingSample(repo)).toBeNull();
    await ensureDemoWorkspace(repo);
    expect(await readLandingSample(repo)).toBeNull();
  });

  it("lists all 8 stores; a store without a live edition reads none, and sample-evidence editions never show (production)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await ensureDemoWorkspace(repo);
    await repo.putEdition(live(cleanEdition("store_williamsburg", "ed_wb")));
    const sampleOnly = cleanEdition("store_astoria", "ed_as");
    await repo.putEdition({ ...sampleOnly, evidence: sampleOnly.evidence.map((ev) => (ev.source === "qloo" ? { ...ev, mode: "fixture" as const } : ev)) });
    const s = (await readLandingSample(repo))!;
    expect(s.rows).toHaveLength(8);
    expect(s.rows.find((r) => r.id === "store_williamsburg")?.status).not.toBe("none");
    expect(s.rows.find((r) => r.id === "store_astoria")?.status).toBe("none");
    expect(s.featured?.name).toBe("Williamsburg");
    expect(s.featured?.special?.name).toBeTruthy();
  });
});
