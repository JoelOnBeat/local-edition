import { KeyedRepo } from "./keyed-repo";
import { MemoryKv } from "./memory";
import type { Repo } from "./repo";

/**
 * Dev driver: the whole store is one JSON snapshot under `.data/` (gitignored), rewritten atomically
 * (temp file + rename) after each write and reloaded when another process changed it. Node only; this is
 * one of the two modules allowed to use `fs`.
 */

interface Snapshot {
  cells: Record<string, { json: string; exp?: number }>;
}

export class FileKv extends MemoryKv {
  private mtimeMs = 0;
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly file: string) {
    super();
  }

  protected override async beforeRead(): Promise<void> {
    const { stat, readFile } = await import("node:fs/promises");
    let mtime: number;
    try {
      mtime = (await stat(this.file)).mtimeMs;
    } catch {
      return; // no snapshot yet
    }
    if (mtime === this.mtimeMs) return;
    try {
      const snap = JSON.parse(await readFile(this.file, "utf8")) as Snapshot;
      this.cells = new Map(Object.entries(snap.cells));
      this.mtimeMs = mtime;
    } catch {
      // A half-written or corrupt snapshot keeps the in-memory state; the next write replaces it.
    }
  }

  protected override async afterWrite(): Promise<void> {
    const write = this.queue.then(async () => {
      const { mkdir, rename, stat, writeFile } = await import("node:fs/promises");
      const { dirname } = await import("node:path");
      await mkdir(dirname(this.file), { recursive: true });
      const tmp = `${this.file}.${process.pid}.tmp`;
      const snap: Snapshot = { cells: Object.fromEntries(this.cells) };
      await writeFile(tmp, JSON.stringify(snap), "utf8");
      await rename(tmp, this.file);
      this.mtimeMs = (await stat(this.file)).mtimeMs;
    });
    this.queue = write.catch(() => undefined);
    await write;
  }
}

export function createFileRepo(file = `${process.env.LE_DATA_DIR ?? ".data"}/store.json`): Repo {
  return new KeyedRepo(new FileKv(file));
}
