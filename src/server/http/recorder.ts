/**
 * Record/replay of upstream responses. Keys are sha256 of method + URL (secret params removed,
 * remaining params sorted) + canonical body. Headers never enter the key or the file.
 * FileRecorder is dev-only (fs, lazy-imported); a Workers/KV recorder implements `Recorder`.
 */

export interface RecordedResponse {
  key: string;
  provider: string;
  method: string;
  /** URL without secret params. */
  url: string;
  status: number;
  body: unknown;
  recordedAt: string;
}

export interface Recorder {
  get(provider: string, key: string): Promise<RecordedResponse | undefined>;
  put(entry: RecordedResponse): Promise<void>;
}

/**
 * Query params that may enter a recording key or file: an ALLOWLIST. Qloo's namespaced params
 * (`filter.*`, `signal.*`, `bias.*`, `feature.*`) plus a fixed set of plain names. Anything else
 * (`access_key`, `subscription-key`, a future credential name) is dropped, never recorded.
 */
const SAFE_PARAM_NAMESPACED = /^(filter|signal|bias|feature)\.[a-z0-9_.-]+$/i;
const SAFE_PARAM_PLAIN = new Set([
  "query", "q", "types", "type", "take", "limit", "offset", "page", "sort_by", "operator",
  "entity_ids", "entity_id", "ids", "tags", "tag_types", "audience_ids", "start_date", "end_date", "city",
]);
const isSafeParam = (name: string) => SAFE_PARAM_PLAIN.has(name.toLowerCase()) || SAFE_PARAM_NAMESPACED.test(name);
export const SECRET_HEADER = /^(authorization|x-api-key|api-key|x-le-signature|cookie|proxy-authorization)$/i;

/** URL with only allowlisted query params (sorted), no `user:pass@` and no hash, so recordings stay stable and key-free. */
export function canonicalUrl(raw: string): string {
  const u = new URL(raw);
  u.username = "";
  u.password = "";
  const kept = [...u.searchParams.entries()].filter(([k]) => isSafeParam(k));
  kept.sort(([a, av], [b, bv]) => (a === b ? av.localeCompare(bv) : a.localeCompare(b)));
  u.search = "";
  for (const [k, v] of kept) u.searchParams.append(k, v);
  u.hash = "";
  return u.toString();
}

export function stableStringify(value: unknown): string {
  if (value === undefined) return "";
  if (typeof value === "string") return value;
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, val]) => [k, walk(val)]),
      );
    }
    return v;
  };
  return JSON.stringify(walk(value));
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function recordKey(req: { method: string; url: string; body?: unknown }): Promise<string> {
  return sha256Hex(`${req.method.toUpperCase()}\n${canonicalUrl(req.url)}\n${stableStringify(req.body)}`);
}

export class MemoryRecorder implements Recorder {
  private readonly entries = new Map<string, RecordedResponse>();

  async get(provider: string, key: string) {
    return this.entries.get(`${provider}/${key}`);
  }
  async put(entry: RecordedResponse) {
    this.entries.set(`${entry.provider}/${entry.key}`, entry);
  }
  size(): number {
    return this.entries.size;
  }
}

const safeSegment = (s: string) => s.replace(/[^a-z0-9_-]/gi, "_");

/** Dev-only: one JSON file per response under `<root>/<provider>/<key>.json`. Root defaults to `<project>/.recordings` (or LE_RECORDINGS_DIR) and ignores itself. */
export class FileRecorder implements Recorder {
  constructor(private readonly root?: string) {}

  private async dir(): Promise<string> {
    return this.root ?? (await (await import("./dirs")).recordingsDir());
  }

  async get(provider: string, key: string): Promise<RecordedResponse | undefined> {
    const { readFile } = await import("node:fs/promises");
    try {
      const text = await readFile(this.path(await import("node:path"), await this.dir(), provider, key), "utf8");
      return JSON.parse(text) as RecordedResponse;
    } catch {
      return undefined;
    }
  }

  async put(entry: RecordedResponse): Promise<void> {
    const { mkdir, writeFile } = await import("node:fs/promises");
    const path = await import("node:path");
    const root = await this.dir();
    await (await import("./dirs")).ensureIgnoredDir(root);
    const file = this.path(path, root, entry.provider, entry.key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(entry, null, 2), "utf8");
  }

  private path(path: typeof import("node:path"), root: string, provider: string, key: string): string {
    return path.join(root, safeSegment(provider), `${safeSegment(key)}.json`);
  }
}

/** Production keeps nothing: it never replays, and live responses (embeddings especially) would only leak memory. */
export class NullRecorder implements Recorder {
  async get(): Promise<undefined> {
    return undefined;
  }
  async put(): Promise<void> {}
}

let shared: Recorder | undefined;

/** Process-wide recorder: file-backed outside production, a no-op in production. Replace with `setRecorder`. */
export function getRecorder(): Recorder {
  shared ??= process.env.NODE_ENV === "production" ? new NullRecorder() : new FileRecorder();
  return shared;
}
export function setRecorder(recorder: Recorder | undefined): void {
  shared = recorder;
}
