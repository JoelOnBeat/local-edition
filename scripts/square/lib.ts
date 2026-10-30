import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";

/** Shared helpers for the Square scripts. Secrets are read and piped; they are never printed, logged or written into the repo. */

const SECRET_STORE = join(homedir(), ".secret-store");

/** KEY=VALUE lines of one env file into a map (no process.env changes). */
function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const i = line.indexOf("=");
    if (i <= 0 || line.trimStart().startsWith("#")) continue;
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

/**
 * Reads secret store values by name through inject.sh into a throwaway directory (deleted at once), so nothing lands in the repo. Returns only the
 * names the secret store has. Callers pass the values straight to a pipe.
 */
export function secretGet(names: string[]): Record<string, string> {
  const dir = mkdtempSync(join(tmpdir(), "le-secrets-"));
  try {
    spawnSync(join(SECRET_STORE, "inject.sh"), ["get", ...names, "--dir", dir], { stdio: "ignore" });
    const env = parseEnv(readFileSync(join(dir, ".env.local"), "utf8"));
    return Object.fromEntries(names.filter((n) => env[n]).map((n) => [n, env[n]]));
  } catch {
    return {};
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Stores a value in the secret store: `printf '%s\n' "$VALUE" | set-keys.py NAME`. */
export function secretSet(name: string, value: string): boolean {
  return spawnSync(join(SECRET_STORE, "scripts", "set-keys.py"), [name], { input: `${value}\n`, stdio: ["pipe", "ignore", "ignore"] }).status === 0;
}

/** `wrangler secret put NAME`, value on stdin. The project's local wrangler, run from the repo root. */
export function wranglerSecretPut(name: string, value: string): boolean {
  const r = spawnSync("npx", ["wrangler", "secret", "put", name], { input: `${value}\n`, cwd: resolve(__dirname, "../.."), stdio: ["pipe", "ignore", "pipe"] });
  if (r.status !== 0) process.stderr.write(`wrangler secret put ${name} failed: ${String(r.stderr).split("\n").filter((l) => !/[A-Za-z0-9_-]{24,}/.test(l)).slice(0, 3).join(" | ")}\n`);
  return r.status === 0;
}

/** A Square client on the sandbox with the token from the secret store (LOCALEDITION_SQUARE_ACCESS_TOKEN) or SQUARE_ACCESS_TOKEN. */
export async function sandboxClient() {
  const token = process.env.SQUARE_ACCESS_TOKEN ?? secretGet(["LOCALEDITION_SQUARE_ACCESS_TOKEN"]).LOCALEDITION_SQUARE_ACCESS_TOKEN;
  if (!token) {
    process.stderr.write("No Square sandbox token: LOCALEDITION_SQUARE_ACCESS_TOKEN is not in the secret store yet.\n");
    process.exit(2);
  }
  const { SquareClient } = await import("@/server/connectors/square/client");
  return new SquareClient({ accessToken: token, env: "sandbox", mode: "live" });
}
