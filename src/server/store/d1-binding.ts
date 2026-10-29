import { platformEnv } from "../platform/env";
import type { D1Like } from "../platform/types";
import { KvCache } from "./d1-cache";
import { createD1Repo } from "./d1";
import { CloudflareKv } from "./kv";
import type { Repo } from "./repo";

/**
 * The production D1 repo: binding `LE_DB` from the Worker's env (a Workflow step, the cron or an OpenNext
 * request), and the provider cache in KV (`LE_KV`) when that is bound. Under `next dev` with
 * STORE_DRIVER=d1 the bindings come from wrangler's platform proxy (local SQLite under .wrangler/state), and
 * the schema is applied on first use, since there is no `wrangler d1 migrations apply` step in a dev loop.
 */
export async function createBoundD1Repo(): Promise<Repo> {
  const env = await platformEnv({ allowDevProxy: true });
  const bound = env?.LE_DB;
  if (!bound) throw new Error("STORE_DRIVER=d1 needs the LE_DB binding (see wrangler.jsonc).");
  const kv = env.LE_KV;
  const db = async (): Promise<D1Like> => bound;
  if (process.env.NODE_ENV !== "production") await ensureDevSchema(bound);
  return createD1Repo(db, kv ? { cache: new KvCache(new CloudflareKv(async () => kv)) } : {});
}

/** Dev only: creates the tables when missing, reading `migrations/` with a lazy `fs` import the Worker bundle never sees. */
async function ensureDevSchema(db: D1Like): Promise<void> {
  const exists = await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'workspaces'").first();
  if (exists) return;
  const { readFile, readdir } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const dir = join(process.cwd(), "migrations");
  for (const file of (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort()) {
    const statements = (await readFile(join(dir, file), "utf8"))
      .split("\n").filter((l) => !l.trim().startsWith("--")).join("\n")
      .split(";").map((s) => s.trim()).filter(Boolean);
    await db.batch(statements.map((s) => db.prepare(s)));
  }
}
