import { spawn } from "node:child_process";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { getLatestJob, runMondayJob } from "@/server/handlers/jobs";
import type { BuildEditions } from "@/server/jobs/ports";
import { fakePorts, freshApp } from "./helpers";

/** Serve the real route handlers over HTTP so the real Python script can talk to them. */
function serve(): Promise<Server> {
  const toRequest = async (msg: IncomingMessage) => {
    const chunks: Buffer[] = [];
    for await (const c of msg) chunks.push(c as Buffer);
    const body = Buffer.concat(chunks);
    return new Request(`http://localhost${msg.url}`, {
      method: msg.method,
      headers: Object.fromEntries(Object.entries(msg.headers).filter(([, v]) => typeof v === "string") as [string, string][]),
      body: body.length ? body : undefined,
    });
  };
  const server = createServer(async (msg, out) => {
    const req = await toRequest(msg);
    const res = msg.url?.startsWith("/api/jobs/monday") ? await runMondayJob(req) : await getLatestJob(req);
    out.writeHead(res.status, { "content-type": "application/json" }).end(await res.text());
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

let server: Server | undefined;
afterEach(() => new Promise<void>((done) => (server ? server.close(() => done()) : done())));

const runScript = (port: number, env: Record<string, string>) =>
  new Promise<{ code: number | null; out: string }>((resolve) => {
    const child = spawn("python3", ["-I", "jobs/rebuild.py"], { env: { ...process.env, APP_URL: `http://127.0.0.1:${port}`, POLL_SECONDS: "1", TIMEOUT_SECONDS: "30", ...env } });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (code) => resolve({ code, out }));
  });

describe("T3 rebuild.py against the real /api/jobs/monday handler", () => {
  it("signs in a way the TypeScript verifier accepts, and follows the run to done", async () => {
    const build: BuildEditions = async function* ({ stores, runId }) {
      await new Promise((r) => setTimeout(r, 300));
      yield { type: "run_done", runId, editionIds: stores.map((s) => `ed_${s.id}`) };
    };
    const pending: Promise<unknown>[] = [];
    const repo = freshApp({ LE_JOB_SECRET: "interop-secret-not-real-0123456789abcdef" }, fakePorts({ buildEditions: build, background: (p) => { pending.push(p); } }));
    server = await serve();
    const { code, out } = await runScript((server.address() as AddressInfo).port, { LE_JOB_SECRET: "interop-secret-not-real-0123456789abcdef", TRIGGER: "manual", JOB_NAME: "edition-2026w44-7" });
    expect(code, out).toBe(0);
    expect(out).toContain("status=done");
    const run = await repo.latestJobRun();
    expect(run).toMatchObject({ status: "done", trigger: "manual", nebiusJobId: "edition-2026w44-7" });
    expect(out).not.toContain("interop-secret-not-real-0123456789abcdef");
  }, 30_000);

  it("exits 3 when the secret does not match the server's", async () => {
    freshApp({ LE_JOB_SECRET: "server-secret-not-real-0123456789abcdef" }, fakePorts());
    server = await serve();
    const { code, out } = await runScript((server.address() as AddressInfo).port, { LE_JOB_SECRET: "other-secret-not-real-0123456789abcdef" });
    expect(code).toBe(3);
    expect(out).toContain("bad_signature");
  }, 30_000);
});
