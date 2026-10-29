import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { deleteWorkspacePhotos, FsBlobStore, getMenuPhoto, MemoryBlobStore, putMenuPhoto, R2BlobStore, menuPhotoKey, workspacePhotoKeys } from "./index";
import type { R2BucketLike } from "../platform/types";

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

describe("menu photo storage", () => {
  it("keys photos under ws/<workspace>/menu-photo.<ext> and reads them back for the owner only", async () => {
    const store = new MemoryBlobStore();
    const key = await putMenuPhoto("ws_abc123", png, "image/png", store);
    expect(key).toBe("ws/ws_abc123/menu-photo.png");
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

  it("keeps ONE photo per workspace: re-uploads overwrite, and another file type replaces the old one", async () => {
    const store = new MemoryBlobStore();
    for (let i = 0; i < 5; i++) await putMenuPhoto("ws_loop", new Uint8Array([1, 2, 3, i]), "image/png", store);
    expect([...store.objects.keys()]).toEqual(["ws/ws_loop/menu-photo.png"]);
    expect((await store.get("ws/ws_loop/menu-photo.png"))?.bytes[3]).toBe(4);
    await putMenuPhoto("ws_loop", png, "image/webp", store);
    expect([...store.objects.keys()]).toEqual(["ws/ws_loop/menu-photo.webp"]);
    await putMenuPhoto("ws_other", png, "image/png", store);
    expect(store.objects.size).toBe(2);
  });

  it("deletes the photos of expired workspaces only, in bulk calls of at most 1,000 keys", async () => {
    const store = new MemoryBlobStore();
    for (const id of ["ws_a", "ws_b", "ws_keep"]) await putMenuPhoto(id, png, "image/jpeg", store);
    const calls: number[] = [];
    const real = store.delete.bind(store);
    store.delete = async (k) => { calls.push([k].flat().length); await real(k); };
    await deleteWorkspacePhotos(["ws_a", "ws_b"], store);
    expect([...store.objects.keys()]).toEqual(["ws/ws_keep/menu-photo.jpg"]);
    expect(calls).toEqual([6]);
    calls.length = 0;
    await deleteWorkspacePhotos(Array.from({ length: 700 }, (_, i) => `ws_x${i}`), store);
    expect(calls.every((n) => n <= 900)).toBe(true);
    expect(calls).toEqual([900, 900, 300]);
    expect(workspacePhotoKeys("ws_q")).toHaveLength(3);
  });

  it("skips ids that cannot form a key instead of failing the purge", async () => {
    const store = new MemoryBlobStore();
    await expect(deleteWorkspacePhotos(["bad/id", "ws_ok"], store)).resolves.toBeUndefined();
  });
});
