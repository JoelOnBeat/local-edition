/**
 * One real Nemotron 3 Ultra review of the production demo workspace's current editions, saved onto those editions
 * so every new sample workspace copies real notes (createVisitorWorkspace clones each edition, review included).
 *
 *   npx tsx scripts/demo-review.ts            # reads D1, runs ONE live review, saves each verdict on its edition in remote D1
 *   npx tsx scripts/demo-review.ts --dry      # same review (it still costs a call), prints it, writes nothing
 *
 * Reads the demo workspace from remote D1 with the logged-in wrangler, calls Token Factory with
 * NEBIUS_API_KEY from .env.local (never printed), and caps its own spend at SPEND_CAP_USD (default 0.25). The review text is whatever
 * the model returned: nothing here writes a verdict by hand. A save only lands when the edition has not changed since it was read.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

function loadEnv(file: string): void {
  try {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const i = line.indexOf("=");
      if (i <= 0 || line.trimStart().startsWith("#")) continue;
      const k = line.slice(0, i).trim();
      if (process.env[k] === undefined) process.env[k] = line.slice(i + 1).trim().replace(/^["']|["']$/g, "");
    }
  } catch {
    // No .env.local: the run reports the missing key.
  }
}
loadEnv(resolve(process.cwd(), ".env.local"));
Object.assign(process.env, { TF_MODE: "live", TAVILY_MODE: "replay", QLOO_MODE: "replay", STORE_DRIVER: "memory", BUILD_MODE: "inline" });
process.env.SPEND_CAP_USD ??= "0.25";

const WRITE = !process.argv.includes("--dry");
const DEMO = "demo";

function d1(args: string[]): Record<string, unknown>[] {
  const r = spawnSync("npx", ["wrangler", "d1", "execute", "LE_DB", "--remote", "--json", ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`wrangler d1 failed: ${(r.stderr || r.stdout).slice(0, 300)}`);
  const parsed = JSON.parse(r.stdout) as { results?: Record<string, unknown>[]; success?: boolean }[];
  return parsed.flatMap((p) => p.results ?? []);
}
const sqlQuote = (s: string) => `'${s.replace(/'/g, "''")}'`;

async function main() {
  if (!process.env.NEBIUS_API_KEY) throw new Error("NEBIUS_API_KEY missing from .env.local.");
  const { resetEnvCache } = await import("@/lib/env");
  resetEnvCache();
  const { getRepo } = await import("@/server/store");
  const { liveAgentDeps } = await import("@/server/agent/live");
  const { reviewEditions } = await import("@/server/agent/review");
  type Edition = import("@/contract").Edition;

  const ws = d1(["--command", `SELECT chain_id FROM workspaces WHERE id = ${sqlQuote(DEMO)}`]);
  const chainId = String(ws[0]?.chain_id ?? "");
  if (!chainId) throw new Error("The demo workspace does not exist in D1.");
  const json = <T>(rows: Record<string, unknown>[]): T[] => rows.map((r) => JSON.parse(String(r.json)) as T);
  const [chain] = json<import("@/contract").Chain>(d1(["--command", `SELECT json FROM chains WHERE id = ${sqlQuote(chainId)}`]));
  const stores = json<import("@/contract").Store>(d1(["--command", `SELECT json FROM stores WHERE workspace_id = ${sqlQuote(DEMO)}`]));
  const [menu] = json<import("@/contract").MenuItem[]>(d1(["--command", `SELECT json FROM menus WHERE chain_id = ${sqlQuote(chainId)}`]));
  const rows = d1(["--command", `SELECT json, rev FROM editions WHERE workspace_id = ${sqlQuote(DEMO)} AND status <> 'drafting'`]);
  const editions = rows.map((r) => ({ edition: JSON.parse(String(r.json)) as Edition, rev: Number(r.rev) }));
  process.stdout.write(`demo: ${stores.length} stores, ${editions.length} editions (${editions.map((e) => e.edition.storeId).join(", ")})\n`);

  const repo = await getRepo();
  await repo.createWorkspace({ chain, stores, menu: menu ?? [], workspaceId: DEMO } as never);
  for (const { edition } of editions) await repo.putEdition(structuredClone({ ...edition, review: undefined }));

  let usd = 0;
  const reviewed = new Map<string, unknown>();
  for await (const e of reviewEditions({ workspaceId: DEMO }, await liveAgentDeps())) {
    if (e.type === "step_metrics") { usd += e.usd; process.stdout.write(`call: ${e.model} ${e.ms} ms, ${e.promptTokens} in / ${e.completionTokens} out, $${e.usd.toFixed(6)}\n`); }
    if (e.type === "review") { reviewed.set(e.storeId, e); process.stdout.write(`review ${e.storeId}: ${e.verdict} (${e.reviewedBy}) ${e.reason}\n`); }
    if (e.type === "error") process.stdout.write(`error ${e.code}: ${e.message}\n`);
  }
  process.stdout.write(`spend: $${usd.toFixed(6)}\n`);
  if (!reviewed.size) throw new Error("No review came back; nothing to save.");

  const lines: string[] = [];
  for (const { edition, rev } of editions) {
    const saved = (await repo.getEdition(edition.id))?.review;
    if (!saved) { process.stdout.write(`no verdict for ${edition.storeId}; its edition is left as it is\n`); continue; }
    const next = JSON.stringify({ ...edition, review: saved });
    lines.push(`UPDATE editions SET json = ${sqlQuote(next)}, rev = rev + 1 WHERE id = ${sqlQuote(edition.id)} AND rev = ${rev};`);
    process.stdout.write(`will save on ${edition.id}: reviewed ${saved.at} by ${saved.reviewedBy}\n`);
  }
  if (!WRITE) { process.stdout.write("dry run: nothing written (--dry)\n"); return; }
  const file = join(mkdtempSync(join(tmpdir(), "le-demo-review-")), "save.sql");
  writeFileSync(file, lines.join("\n"));
  process.stdout.write(`save file (re-runnable with wrangler d1 execute LE_DB --remote --file): ${file}\n`);
  const r = spawnSync("npx", ["wrangler", "d1", "execute", "LE_DB", "--remote", "--file", file], { encoding: "utf8" });
  process.stdout.write(r.status === 0 ? `saved ${lines.length} reviews to remote D1\n` : `save failed: ${(r.stderr || r.stdout).slice(0, 300)}\n`);
}

main().catch((e: unknown) => {
  process.stderr.write(`${(e as Error).message}\n`);
  process.exit(1);
});
