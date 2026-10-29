/**
 * Dev-only filesystem locations (Node only, lazy imports). Recordings and the file store hold real
 * provider data, so they must land inside this project and ignore themselves, whatever directory the
 * process was started from. A parent repo can otherwise pick them up with a plain `git add`.
 */

let cachedRoot: string | undefined;

async function hasMarker(dir: string): Promise<boolean> {
  const { readFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  try {
    const pkg = JSON.parse(await readFile(join(dir, "package.json"), "utf8")) as { name?: string };
    return pkg.name === "local-edition";
  } catch {
    return false;
  }
}

async function walkUp(start: string): Promise<string | undefined> {
  const { dirname, resolve } = await import("node:path");
  let dir = resolve(start);
  for (let i = 0; i < 12; i++) {
    if (await hasMarker(dir)) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

/** The project root: the folder whose package.json is `local-edition`, found from this file, then from the cwd. */
export async function projectRoot(): Promise<string> {
  if (cachedRoot) return cachedRoot;
  const { fileURLToPath } = await import("node:url");
  const { dirname, join } = await import("node:path");
  const starts: string[] = [];
  try {
    starts.push(dirname(fileURLToPath(import.meta.url)));
  } catch {
    // Bundlers may rewrite import.meta.url; the cwd search below still applies.
  }
  starts.push(process.cwd());
  for (const start of starts) {
    const found = await walkUp(start);
    if (found) return (cachedRoot = found);
  }
  const child = join(process.cwd(), "local-edition");
  if (await hasMarker(child)) return (cachedRoot = child);
  return (cachedRoot = process.cwd());
}

/** `envValue` when set (relative paths resolve from the project root), else `<project root>/<name>`. */
export async function resolveDir(envValue: string | undefined, name: string): Promise<string> {
  const { isAbsolute, resolve } = await import("node:path");
  const root = await projectRoot();
  const wanted = envValue?.trim();
  if (wanted) return isAbsolute(wanted) ? wanted : resolve(root, wanted);
  return resolve(root, name);
}

export const recordingsDir = () => resolveDir(process.env.LE_RECORDINGS_DIR, ".recordings");
export const dataDir = () => resolveDir(process.env.LE_DATA_DIR, ".data");

/** mkdir -p, then make sure the directory ignores itself (`.gitignore` containing `*`). */
export async function ensureIgnoredDir(dir: string): Promise<void> {
  const { mkdir, writeFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  await mkdir(dir, { recursive: true });
  try {
    await writeFile(join(dir, ".gitignore"), "*\n", { encoding: "utf8", flag: "wx" });
  } catch (e) {
    if ((e as NodeJS.ErrnoException)?.code !== "EEXIST") throw e;
  }
}
