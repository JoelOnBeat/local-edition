import { KeyedRepo, type KvLike } from "./keyed-repo";
import type { Repo } from "./repo";

interface Cell {
  /** JSON text, so callers can never mutate stored rows through a shared reference. */
  json: string;
  /** Epoch ms after which the cell is gone. */
  exp?: number;
}

/** Map-backed KvLike with TTL. Also the base of the dev file driver. */
export class MemoryKv implements KvLike {
  protected cells = new Map<string, Cell>();

  constructor(private readonly now: () => number = Date.now) {}

  /** Hooks for the file driver: load before a read, persist after a write. */
  protected async beforeRead(): Promise<void> {}
  protected async afterWrite(): Promise<void> {}

  private live(key: string): Cell | undefined {
    const cell = this.cells.get(key);
    if (!cell) return undefined;
    if (cell.exp !== undefined && cell.exp <= this.now()) {
      this.cells.delete(key);
      return undefined;
    }
    return cell;
  }

  async get(key: string): Promise<unknown | null> {
    await this.beforeRead();
    const cell = this.live(key);
    return cell ? JSON.parse(cell.json) : null;
  }

  async put(key: string, value: unknown, opts: { ttlSeconds?: number } = {}): Promise<void> {
    await this.beforeRead();
    this.cells.set(key, {
      json: JSON.stringify(value),
      exp: opts.ttlSeconds === undefined ? undefined : this.now() + opts.ttlSeconds * 1000,
    });
    await this.afterWrite();
  }

  async delete(key: string): Promise<void> {
    await this.beforeRead();
    if (this.cells.delete(key)) await this.afterWrite();
  }

  async list(prefix: string): Promise<string[]> {
    await this.beforeRead();
    return [...this.cells.keys()].filter((k) => k.startsWith(prefix) && this.live(k));
  }
}

export function createMemoryRepo(now?: () => number): Repo {
  return new KeyedRepo(new MemoryKv(now));
}
