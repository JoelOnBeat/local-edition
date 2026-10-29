import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FsBlobStore, getMenuPhoto, MemoryBlobStore, putMenuPhoto, R2BlobStore, menuPhotoKey } from "./index";
import type { R2BucketLike } from "../platform/types";

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

describe("menu photo storage", () => {
  it("keys photos under ws/<workspace>/<uuid>.<ext> and reads them back for the owner only", async () => {
    const store = new MemoryBlobStore();
    const key = await putMenuPhoto("ws_abc123", png, "image/png", store);
    expect(key).toMatch(/^ws\/ws_abc123\/[0-9a-f-]{36}\.png$/);
    expect(await getMenuPhoto("ws_abc123", key, store)).toEqual({ bytes: png, contentType: "image/png" });
    expect(await getMenuPhoto("ws_other", key, store)).toBeNull();
    expect(await getMenuPhoto("ws_abc123", "ws/ws_abc123/../../etc/passwd.png", store)).toBeNull();
  });

  it("refuses the wrong type, an empty body and an oversize body without storing anything", async () => {
    const store = new MemoryBlobStore();
    await expect(putMenuPhoto("ws_a", png, "image/gif", store)).rejects.toMatchObject({ status: 415 });
    await expect(putMenuPhoto("ws_a", new Uint8Array(0), "image/png", store)).rejects.toMatchObject({ status: 413 });
    await expect(putMenuPhoto("ws_a", new Uint8Array(5 * 1024 * 1024 + 1), "image/png", store)).rejects.toMatchObject({ status: 413 });
    expect(store.objects.size).toBe(0);
    expect(() => menuPhotoKey("../evil", "image/png")).toThrow();
  });

  it("round trips through an R2-shaped bucket, keeping the content type", async () => {
    const objects = new Map<string, { bytes: ArrayBuffer; type?: string }>();
    const bucket: R2BucketLike = {
      async put(key, value, opts) { objects.set(key, { bytes: new Uint8Array(value as Uint8Array).buffer as ArrayBuffer, type: opts?.httpMetadata?.contentType }); },
      async get(key) { const o = objects.get(key); return o ? { size: o.bytes.byteLength, arrayBuffer: async () => o.bytes, httpMetadata: { contentType: o.type } } : null; },
      async delete(key) { for (const k of Array.isArray(key) ? key : [key]) objects.delete(k); },
    };
    const store = new R2BlobStore(bucket);
    const key = await putMenuPhoto("ws_r2", png, "image/webp", store);
    expect(await getMenuPhoto("ws_r2", key, store)).toEqual({ bytes: png, contentType: "image/webp" });
    await store.delete(key);
    expect(await getMenuPhoto("ws_r2", key, store)).toBeNull();
  });

  it("writes to the filesystem fallback, reads it back, and cannot be pointed outside its folder", async () => {
    const root = await mkdtemp(join(tmpdir(), "le-blob-"));
    const store = new FsBlobStore(root);
    const key = await putMenuPhoto("ws_fs", png, "image/jpeg", store);
    expect(await readdir(join(root, "ws", "ws_fs"))).toHaveLength(1);
    expect(await getMenuPhoto("ws_fs", key, store)).toEqual({ bytes: png, contentType: "image/jpeg" });
    await expect(store.put("../escape.png", png)).rejects.toThrow(/escapes/);
    await store.delete(key);
    expect(await store.get(key)).toBeNull();
  });
});
