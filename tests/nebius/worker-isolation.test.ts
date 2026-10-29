import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Team rule, 30 Oct 2026 02:30 MYT: no Worker, cron or Workflow calls the Nebius AI Cloud control plane (it answers Cloudflare
 * egress with a 522) and NEBIUS_SA_CREDENTIALS is never a Worker secret. Everything the Worker bundles lives under src/, worker/ and
 * edge/; the session-only Nebius code and the job bundle live under scripts/. This pins that the two never meet.
 */
const root = resolve(__dirname, "../..");

function sources(dir: string): string[] {
  return readdirSync(resolve(root, dir)).flatMap((name) => {
    const rel = `${dir}/${name}`;
    if (statSync(resolve(root, rel)).isDirectory()) return name === "node_modules" ? [] : sources(rel);
    return /\.(ts|tsx|mjs|js|jsonc?)$/.test(name) && !/\.test\.ts$/.test(name) ? [rel] : [];
  });
}

const workerSources = ["src", "worker", "edge"].flatMap(sources);
const FORBIDDEN = [
  /api\.nebius\.cloud/, /api\.eu-north1\.nebius\.cloud/, /auth\.eu\.nebius\.com/, /auth\.nebius\.com/, /token\/exchange/,
  /NEBIUS_SA_CREDENTIALS/, /NEBIUS_PROJECT_ID/, /\/ai\/v1\/jobs/, /job-bundle\.generated/, /JOB_PACK_B64/,
  /from ["'][./]*\/?scripts\//, /nebius\/(jobs|job-spec|runner|cli)["']/,
];

describe("the Worker's source tree and the Nebius control plane", () => {
  it("scans the real tree", () => {
    expect(workerSources.length).toBeGreaterThan(200);
    expect(workerSources).toContain("worker/workflows.ts");
  });

  it("names no control-plane host, credential, jobs path or job bundle, and imports nothing from scripts/", () => {
    const hits = workerSources.flatMap((file) => FORBIDDEN.filter((re) => re.test(readFileSync(resolve(root, file), "utf8"))).map((re) => `${file}: ${re}`));
    expect(hits).toEqual([]);
  });

  it("keeps the session-only code and the job bundle under scripts/", () => {
    for (const f of ["scripts/nebius-job.ts", "scripts/nebius/jobs.ts", "scripts/nebius/job-spec.ts", "scripts/nebius/job-bundle.generated.ts"]) expect(statSync(resolve(root, f)).isFile()).toBe(true);
  });
});
