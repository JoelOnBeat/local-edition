import { beforeEach, describe, expect, it } from "vitest";
import { importStoresRoute } from "@/server/handlers/job-batch";
import { readJobRuns } from "@/server/handlers/proof-ledger";
import { signRequest } from "@/server/jobs/hmac";
import { ensureDemoWorkspace } from "@/server/session";
import type { Repo } from "@/server/store";
import { fakePorts, freshApp, req } from "../e/helpers";

const SECRET = "s2-job-secret-not-real-0123456789abcdef";
const nowSec = () => Math.floor(Date.now() / 1000);
/** Two requests in one second would sign identically (a replay), so each default timestamp is one second later. */
let tick = 0;
const nextTs = () => nowSec() + ++tick;

let repo: Repo;
beforeEach(async () => {
  repo = freshApp({ LE_JOB_SECRET: SECRET }, fakePorts());
  await ensureDemoWorkspace(repo);
});

describe("POST /api/stores/import (signed job path)", () => {
  const csv = "name,address,lat,lon\nSunset Park,5th Ave & 44th St,40.6456,-74.0107\nRed Hook,Van Brunt St & Visitation Pl,40.6773,-74.0107\n";
  async function importCsv(body: string, o: { ts?: number; secret?: string; headers?: Record<string, string> } = {}) {
    const ts = String(o.ts ?? nextTs());
    const signature = await signRequest(o.secret ?? SECRET, { method: "POST", path: "/api/stores/import", ts, jobId: "job-import-1" }, body);
    return importStoresRoute(req("/api/stores/import", { method: "POST", headers: { "content-type": "text/csv", "x-le-timestamp": ts, "x-le-signature": signature, "x-le-job-id": "job-import-1", ...o.headers }, body }));
  }

  it("adds the stores to the demo workspace, is idempotent, and records an import JobRun", async () => {
    const before = (await repo.listStores((await repo.getWorkspace("demo"))!.chainId)).length;
    const res = await importCsv(csv);
    expect(res.status).toBe(200);
    expect(((await res.json()) as unknown[]).length).toBe(2);
    expect((await repo.listStores((await repo.getWorkspace("demo"))!.chainId)).length).toBe(before + 2);
    const again = await importCsv(csv, { ts: nowSec() + 50 });
    expect(((await again.json()) as unknown[]).length).toBe(0);
    const [run] = await readJobRuns(repo);
    expect(run).toMatchObject({ mode: "import", nebiusJobId: "job-import-1" });
  });

  it("wrong secret 401; a body changed after signing 401; bad csv 400", async () => {
    expect((await importCsv(csv, { secret: "wrong-secret-wrong-secret-wrong-secret-1234" })).status).toBe(401);
    const ts = String(nowSec());
    const signature = await signRequest(SECRET, { method: "POST", path: "/api/stores/import", ts }, csv);
    const tampered = await importStoresRoute(req("/api/stores/import", { method: "POST", headers: { "x-le-timestamp": ts, "x-le-signature": signature }, body: csv.replace("Sunset Park", "Elsewhere") }));
    expect(tampered.status).toBe(401);
    expect((await importCsv("name,address,lat,lon\nX,Y,999,0\n")).status).toBe(400);
  });

  it("without x-le-signature the request is a visitor's: it gets its own workspace cookie, the demo is untouched", async () => {
    const demoChain = (await repo.getWorkspace("demo"))!.chainId;
    const before = (await repo.listStores(demoChain)).length;
    const res = await importStoresRoute(req("/api/stores/import", { method: "POST", headers: { "content-type": "text/csv" }, body: csv }));
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toMatch(/le_ws=/);
    expect((await repo.listStores(demoChain)).length).toBe(before);
  });
});
