import { afterEach, beforeEach } from "vitest";
import { setAuthStore } from "@/server/auth";
import { setCodeSender, type CodeMessage, type CodeSender } from "@/server/auth/code-sender";
import { setPasswordIterations } from "@/server/auth/password";
import { KvAuthStore } from "@/server/auth/store-kv";
import { setDocDb, createMemoryDocDb } from "@/server/connectors/comms/docs";
import { MemoryLedger } from "@/server/connectors/ledger-memory";
import { setLedger } from "@/server/connectors/ledger";
import { MemoryBlobStore, setBlobStore } from "@/server/blob";
import { MemoryKv } from "@/server/store/memory";
import { freshApp } from "../e/helpers";
import type { Repo } from "@/server/store";

/** Every auth test: a fresh memory repo, account store, connector ledger, comms docs and photo store; cheap password hashing. */
export interface Rig {
  repo: Repo;
  kv: MemoryKv;
  ledger: MemoryLedger;
  docs: ReturnType<typeof createMemoryDocDb>;
  blobs: MemoryBlobStore;
  /** The code sender: every message "sent" lands in `sent`. Replace `rig.sender` behaviour with `setCodeSender(...)` to test failures. */
  sender: CodeSender;
  sent: CodeMessage[];
}

export function authRig(): Rig {
  const rig = {} as Rig;
  beforeEach(() => {
    delete process.env.LE_ALLOW_ANONYMOUS; // sessions are required here, as in production
    rig.repo = freshApp();
    rig.sent = [];
    rig.sender = { name: "test", send: async (m: CodeMessage) => { rig.sent.push(m); } };
    setCodeSender(rig.sender);
    rig.kv = new MemoryKv();
    setAuthStore(new KvAuthStore(rig.kv));
    rig.ledger = new MemoryLedger();
    setLedger(rig.ledger);
    rig.docs = createMemoryDocDb();
    setDocDb(rig.docs);
    rig.blobs = new MemoryBlobStore();
    setBlobStore(rig.blobs);
    setPasswordIterations(1000);
  });
  afterEach(() => {
    process.env.LE_ALLOW_ANONYMOUS = "1";
    setCodeSender(undefined);
    setAuthStore(undefined);
    setLedger(undefined);
    setDocDb(undefined);
    setBlobStore(undefined);
    setPasswordIterations(undefined);
  });
  return rig;
}

export const PASSWORD = "correct horse battery staple";

export function signupBody(over: Record<string, unknown> = {}) {
  return { name: "Maya Okafor", email: "maya@kettleandkiln.example", password: PASSWORD, chainName: "Kettle & Kiln", ...over };
}

/** A tiny cookie jar: it keeps the latest value of each cookie a response set, like a browser. */
export class Jar {
  private cookies = new Map<string, string>();

  absorb(res: Response): void {
    for (const line of res.headers.getSetCookie()) {
      const [pair, ...attrs] = line.split(";").map((p) => p.trim());
      const at = pair.indexOf("=");
      const name = pair.slice(0, at);
      const value = decodeURIComponent(pair.slice(at + 1));
      if (value === "" || attrs.some((a) => a === "Max-Age=0")) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }
  set(name: string, value: string): void {
    this.cookies.set(name, value);
  }
  get(name: string): string | undefined {
    return this.cookies.get(name);
  }
  header(): string {
    return [...this.cookies].map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("; ");
  }
}

export interface CallOpts {
  method?: string;
  body?: unknown;
  jar?: Jar;
  ip?: string;
  headers?: Record<string, string>;
  /** Route params (`/api/stores/:id`), as Next hands them to a handler. */
  params?: Record<string, string>;
}

type Handler = (r: Request, a?: { params: Promise<Record<string, string>> }) => Promise<Response>;

export async function call(handler: Handler, path: string, opts: CallOpts = {}): Promise<Response> {
  const headers = new Headers(opts.headers);
  if (opts.jar?.header()) headers.set("cookie", opts.jar.header());
  if (opts.ip) headers.set("cf-connecting-ip", opts.ip);
  if (opts.body !== undefined) headers.set("content-type", "application/json");
  const res = await handler(
    new Request(`http://localhost${path}`, { method: opts.method ?? (opts.body === undefined ? "GET" : "POST"), headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) }),
    opts.params ? { params: Promise.resolve(opts.params) } : undefined,
  );
  opts.jar?.absorb(res);
  return res;
}
