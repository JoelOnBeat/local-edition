import { serverEnv } from "@/lib/env";
import type { Repo } from "./repo";

export * from "./repo";
export { KeyedRepo, WorkspaceExistsError } from "./keyed-repo";
export type { KvLike, SeedWithId } from "./keyed-repo";
export { ACCOUNT_ID_PREFIX, DEMO_WORKSPACE_ID, canonicalId, isAccountId, remapId, workspaceSuffix } from "./ids";

const slot = globalThis as typeof globalThis & { __leRepo?: Repo };

/**
 * Process-wide repo chosen by STORE_DRIVER (memory | file | kv | d1; d1 is what production runs). Held on globalThis so every route
 * bundle in `next dev` shares one instance. Tests inject their own with `setRepo`.
 */
export async function getRepo(): Promise<Repo> {
  if (slot.__leRepo) return slot.__leRepo;
  const driver = serverEnv().STORE_DRIVER;
  if (driver === "d1") slot.__leRepo = await (await import("./d1-binding")).createBoundD1Repo();
  else if (driver === "kv") slot.__leRepo = (await import("./kv")).createKvRepo();
  else if (driver === "file") slot.__leRepo = (await import("./file")).createFileRepo();
  else slot.__leRepo = (await import("./memory")).createMemoryRepo();
  return slot.__leRepo;
}

export function setRepo(repo: Repo | undefined): void {
  slot.__leRepo = repo;
}
