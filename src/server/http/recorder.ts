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

const SECRET_PARAM = /^(api[-_]?key|key|token|access[-_]?token|auth|authorization|signature|sig|secret|x-api-key)$/i;
export const SECRET_HEADER = /^(authorization|x-api-key|api-key|x-le-signature|cookie|proxy-authorization)$/i;

/** URL with secret query params removed and the rest sorted, so recordings stay stable and key-free. */
export function canonicalUrl(raw: string): string {
  const u = new URL(raw);
  const kept = [...u.searchParams.entries()].filter(([k]) => !SECRET_PARAM.test(k));
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

/** Dev-only: one JSON file per response under `<root>/<provider>/<key>.json`. */
export class FileRecorder implements Recorder {
  constructor(private readonly root = ".recordings") {}

  async get(provider: string, key: string): Promise<RecordedResponse | undefined> {
    const { readFile } = await import("node:fs/promises");
    try {
      const text = await readFile(this.path(await import("node:path"), provider, key), "utf8");
      return JSON.parse(text) as RecordedResponse;
    } catch {
      return undefined;
    }
  }

  async put(entry: RecordedResponse): Promise<void> {
    const { mkdir, writeFile } = await import("node:fs/promises");
    const path = await import("node:path");
    const file = this.path(path, entry.provider, entry.key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(entry, null, 2), "utf8");
  }

  private path(path: typeof import("node:path"), provider: string, key: string): string {
    return path.join(this.root, safeSegment(provider), `${safeSegment(key)}.json`);
  }
}

let shared: Recorder | undefined;

/** Process-wide recorder: file-backed outside production, memory otherwise. Replace with `setRecorder`. */
export function getRecorder(): Recorder {
  shared ??= process.env.NODE_ENV === "production" ? new MemoryRecorder() : new FileRecorder();
  return shared;
}
export function setRecorder(recorder: Recorder | undefined): void {
  shared = recorder;
}
