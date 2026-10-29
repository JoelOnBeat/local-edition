import { deleteWorkspacePhotos, R2BlobStore } from "../blob";
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
  // Never inside workerd (`wrangler dev`, production): a Workflow or the cron can run before any OpenNext request has set
  // NODE_ENV, and workerd has no `migrations/` directory to read. There `wrangler d1 migrations apply` owns the schema.
  if (process.env.NODE_ENV !== "production" && !inWorkerd()) await ensureDevSchema(bound);
  const photos = env.LE_BLOB ? new R2BlobStore(env.LE_BLOB) : undefined;
  return createD1Repo(db, {
    ...(kv ? { cache: new KvCache(new CloudflareKv(async () => kv)) } : {}),
    ...(photos ? { onExpired: (ids: string[]) => deleteWorkspacePhotos(ids, photos) } : {}),
  });
}

const inWorkerd = (): boolean => typeof navigator !== "undefined" && navigator.userAgent === "Cloudflare-Workers";

/**
 * Dev only: applies the files in `migrations/` that this local database has not seen, reading them with a lazy `fs` import
 * the Worker bundle never sees. Applied names are recorded in `dev_migrations`; a database from before that table existed
 * already has `0001_init.sql` (it has `workspaces`), so only the later files run on it.
 */
async function ensureDevSchema(db: D1Like): Promise<void> {
  const { readFile, readdir } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const dir = join(process.cwd(), "migrations");
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  const hadSchema = await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'workspaces'").first();
  await db.prepare("CREATE TABLE IF NOT EXISTS dev_migrations (name TEXT PRIMARY KEY)").run();
  const applied = new Set((await db.prepare("SELECT name FROM dev_migrations").all<{ name: string }>()).results?.map((r) => r.name) ?? []);
  if (hadSchema && applied.size === 0) {
    await db.prepare("INSERT INTO dev_migrations (name) VALUES (?)").bind(files[0]).run();
    applied.add(files[0]);
  }
  for (const file of files.filter((f) => !applied.has(f))) {
    const statements = (await readFile(join(dir, file), "utf8"))
      .split("\n").filter((l) => !l.trim().startsWith("--")).join("\n")
      .split(";").map((s) => s.trim()).filter(Boolean);
    await db.batch([...statements.map((s) => db.prepare(s)), db.prepare("INSERT INTO dev_migrations (name) VALUES (?)").bind(file)]);
  }
}
