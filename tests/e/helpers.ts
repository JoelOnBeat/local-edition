import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Edition, EditionItem, StaffCard } from "@/contract";
import { buildMockEdition, buildMockCard } from "@/mocks";
import { resetEnvCache } from "@/lib/env";
import { resetPorts, setPorts, type Ports } from "@/server/jobs/ports";
import { resetProbeCache } from "@/server/jobs/status";
import { setSpendMeter } from "@/server/http/spend";
import { SAMPLE_STORES } from "@/server/sample/chain";
import { setRepo, type Repo } from "@/server/store";
import { CloudflareKv, type KvNamespaceLike } from "@/server/store/kv";
import { createFileRepo } from "@/server/store/file";
import { KeyedRepo } from "@/server/store";
import { createMemoryRepo } from "@/server/store/memory";

/** In-memory stand-in for a Workers KV namespace (JSON values, TTL honoured, list by prefix). */
export function fakeKvNamespace(now: () => number = Date.now): KvNamespaceLike & { ttls: number[] } {
  const cells = new Map<string, { value: string; exp?: number }>();
  const ttls: number[] = [];
  return {
    ttls,
    async get(key) {
      const c = cells.get(key);
      if (!c || (c.exp !== undefined && c.exp <= now())) return null;
      return JSON.parse(c.value);
    },
    async put(key, value, opts) {
      if (opts?.expirationTtl !== undefined) ttls.push(opts.expirationTtl);
      cells.set(key, { value, exp: opts?.expirationTtl ? now() + opts.expirationTtl * 1000 : undefined });
    },
    async delete(key) { cells.delete(key); },
    async list({ prefix }) {
      return { keys: [...cells.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true };
    },
  };
}

export type Driver = "memory" | "file" | "kv";
export async function makeRepo(driver: Driver): Promise<Repo> {
  if (driver === "memory") return createMemoryRepo();
  if (driver === "file") return createFileRepo(join(await mkdtemp(join(tmpdir(), "le-store-")), "store.json"));
  const ns = fakeKvNamespace();
  return new KeyedRepo(new CloudflareKv(async () => ns));
}

/** A built edition for a sample store with every item a clean, passing draft at version 0. */
export function cleanEdition(storeId = "store_williamsburg", id = "ed_test_1"): Edition {
  const store = SAMPLE_STORES.find((s) => s.id === storeId)!;
  const e = buildMockEdition(store);
  const items = e.items.map((i) => ({ ...i, status: "draft", version: 0, guardrail: { status: "passed", reasons: [] } }) as EditionItem);
  return { ...e, id, items, status: "draft" };
}

export function cardFor(edition: Edition, token = "tok_test_card_0001"): StaffCard {
  return { ...buildMockCard(edition), token };
}

export const fakePorts = (over: Partial<Ports> = {}): Partial<Ports> => ({
  checkCopy: async () => ({ status: "passed", reasons: [] }),
  background: () => undefined,
  probeGuardrails: async () => "up",
  ...over,
});

/** Fresh memory repo + env + ports for a route test. Returns the repo. */
export function freshApp(env: Record<string, string | undefined> = {}, ports: Partial<Ports> = fakePorts()): Repo {
  for (const k of ["LE_JOB_SECRET", "QLOO_MODE", "TF_MODE", "TAVILY_MODE", "QLOO_API_KEY", "NEBIUS_API_KEY", "TAVILY_API_KEY", "SPEND_CAP_USD"]) delete process.env[k];
  Object.assign(process.env, env);
  resetEnvCache();
  resetPorts();
  resetProbeCache();
  setSpendMeter(undefined);
  setPorts(ports);
  const repo = createMemoryRepo();
  setRepo(repo);
  return repo;
}

export function req(path: string, init: RequestInit & { cookie?: string; ip?: string } = {}): Request {
  const { cookie, ip, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (cookie) headers.set("cookie", cookie);
  if (ip) headers.set("cf-connecting-ip", ip);
  return new Request(`http://localhost${path}`, { ...rest, headers });
}

export const json = (body: unknown, init: RequestInit = {}): RequestInit => ({
  ...init,
  method: init.method ?? "POST",
  headers: { "content-type": "application/json", ...(init.headers as Record<string, string> | undefined) },
  body: JSON.stringify(body),
});

/** `le_ws=<id>` from a response's Set-Cookie. */
export function cookieOf(res: Response): string {
  const raw = res.headers.get("set-cookie") ?? "";
  return raw.split(";")[0];
}
