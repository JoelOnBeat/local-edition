import type { R2BucketLike } from "../platform/types";
import type { BlobObject, BlobStore } from "./types";

export class MemoryBlobStore implements BlobStore {
  readonly objects = new Map<string, BlobObject>();
  async put(key: string, bytes: Uint8Array, contentType: string) { this.objects.set(key, { bytes: bytes.slice(), contentType }); }
  async get(key: string) {
    const o = this.objects.get(key);
    return o ? { bytes: o.bytes.slice(), contentType: o.contentType } : null;
  }
  async delete(key: string | string[]) { for (const k of [key].flat()) this.objects.delete(k); }
}

/** Cloudflare R2 (binding `LE_BLOB`). */
export class R2BlobStore implements BlobStore {
  constructor(private readonly bucket: R2BucketLike) {}
  async put(key: string, bytes: Uint8Array, contentType: string) {
    await this.bucket.put(key, bytes, { httpMetadata: { contentType } });
  }
  async get(key: string) {
    const o = await this.bucket.get(key);
    if (!o) return null;
    return { bytes: new Uint8Array(await o.arrayBuffer()), contentType: o.httpMetadata?.contentType ?? "application/octet-stream" };
  }
  async delete(key: string | string[]) { await this.bucket.delete(key); }
}

const EXT_TYPES: Record<string, string> = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" };

/**
 * Dev-only filesystem store (`.data/blobs`). Node's `fs` is imported lazily so the Worker bundle never pulls
 * it in; callers reach this class only when no R2 binding exists. Keys are already validated (PhotoKey).
 */
export class FsBlobStore implements BlobStore {
  constructor(private readonly root: string = ".data/blobs") {}
  private async path(key: string) {
    const { join, resolve } = await import("node:path");
    const base = resolve(this.root);
    const full = resolve(join(base, key));
    if (!full.startsWith(base + "/")) throw new Error("Blob key escapes the store.");
    return { full, dir: resolve(full, "..") };
  }
  async put(key: string, bytes: Uint8Array) {
    const fs = await import("node:fs/promises");
    const { full, dir } = await this.path(key);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(full, bytes);
  }
  async get(key: string) {
    const fs = await import("node:fs/promises");
    const { full } = await this.path(key);
    try {
      return { bytes: new Uint8Array(await fs.readFile(full)), contentType: EXT_TYPES[key.slice(key.lastIndexOf(".") + 1)] ?? "application/octet-stream" };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
  }
  async delete(key: string | string[]) {
    const fs = await import("node:fs/promises");
    for (const k of [key].flat()) await fs.rm((await this.path(k)).full, { force: true });
  }
}
