import { afterEach, describe, expect, it, vi } from "vitest";
import { setPlatformEnv, type PlatformEnv } from "../platform/env";
import { createBoundD1Repo } from "./d1-binding";

/** A D1 stand-in that records every statement it is asked to prepare. */
function recordingDb() {
  const sql: string[] = [];
  const stmt = { bind: () => stmt, run: async () => ({ meta: { changes: 0 } }), first: async () => null, all: async () => ({ results: [] }) };
  return { sql, db: { prepare: (s: string) => (sql.push(s), stmt), batch: async () => [], exec: async () => ({}) } };
}

describe("createBoundD1Repo", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    setPlatformEnv(undefined);
  });

  it("never reads migrations/ inside workerd, even when NODE_ENV is not production (a Workflow can run before OpenNext sets it)", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubGlobal("navigator", { userAgent: "Cloudflare-Workers" });
    const { db, sql } = recordingDb();
    setPlatformEnv({ LE_DB: db } as unknown as PlatformEnv);
    await createBoundD1Repo();
    expect(sql).toEqual([]); // ensureDevSchema would have prepared sqlite_master / dev_migrations statements
  });

  it("still applies the local migrations under next dev (not workerd, not production)", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const { db, sql } = recordingDb();
    setPlatformEnv({ LE_DB: db } as unknown as PlatformEnv);
    await createBoundD1Repo();
    expect(sql.some((s) => s.includes("dev_migrations"))).toBe(true);
  });
});
