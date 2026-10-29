import { HttpError } from "../http/errors";
import { platformEnv } from "../platform/env";
import { serverEnv } from "@/lib/env";
import { FsBlobStore, MemoryBlobStore, R2BlobStore } from "./stores";
import { PHOTO_MAX_BYTES, PHOTO_NAME, PHOTO_TYPES, PhotoKey, type BlobObject, type BlobStore, type PhotoType } from "./types";

export * from "./types";
export { FsBlobStore, MemoryBlobStore, R2BlobStore } from "./stores";

const slot = globalThis as typeof globalThis & { __leBlob?: BlobStore };

/** Tests inject a store; `undefined` goes back to the automatic choice. */
export function setBlobStore(store: BlobStore | undefined): void {
  slot.__leBlob = store;
}

/**
 * The photo store: R2 when LE_BLOB is bound (production, `opennextjs-cloudflare preview`, or `next dev` with
 * STORE_DRIVER=d1 through wrangler's platform proxy), else the filesystem in dev and a Map under test.
 */
export async function getBlobStore(): Promise<BlobStore> {
  if (slot.__leBlob) return slot.__leBlob;
  const env = await platformEnv({ allowDevProxy: serverEnv().STORE_DRIVER === "d1" });
  const bucket = env?.LE_BLOB;
  slot.__leBlob = bucket ? new R2BlobStore(bucket) : process.env.VITEST ? new MemoryBlobStore() : new FsBlobStore();
  return slot.__leBlob;
}

export function isPhotoType(type: string): type is PhotoType {
  return type in PHOTO_TYPES;
}

/** `ws/<workspaceId>/menu-photo.<ext>`: one photo per workspace, so a new upload overwrites the last one. */
export function menuPhotoKey(workspaceId: string, contentType: PhotoType): string {
  const key = `ws/${workspaceId}/${PHOTO_NAME}.${PHOTO_TYPES[contentType]}`;
  if (!PhotoKey.safeParse(key).success) throw new HttpError(400, "invalid_workspace", "That workspace id cannot hold photos.");
  return key;
}

/** Every key a workspace's photo can be under (one per file type). */
export function workspacePhotoKeys(workspaceId: string): string[] {
  return (Object.keys(PHOTO_TYPES) as PhotoType[]).map((type) => menuPhotoKey(workspaceId, type));
}

/**
 * Stores a menu photo for a workspace and returns its key. Wrong type or size is a 4xx, never stored. The workspace keeps
 * ONE photo: the key is fixed per file type, and a photo of another type removes the old one, so a script that uploads in
 * a loop cannot grow the bucket.
 */
export async function putMenuPhoto(workspaceId: string, bytes: Uint8Array, contentType: string, store?: BlobStore): Promise<string> {
  if (!isPhotoType(contentType)) throw new HttpError(415, "unsupported_media", "Menu photos must be JPEG, PNG or WebP.");
  if (bytes.byteLength === 0 || bytes.byteLength > PHOTO_MAX_BYTES) throw new HttpError(413, "payload_too_large", "Menu photos must be between 1 byte and 5 MB.");
  const key = menuPhotoKey(workspaceId, contentType);
  const blobs = store ?? (await getBlobStore());
  await blobs.put(key, bytes, contentType);
  await blobs.delete(workspacePhotoKeys(workspaceId).filter((k) => k !== key));
  return key;
}

/**
 * Deletes the photos of workspaces that expired (their D1 rows are purged by `purgeExpired`, which calls this first).
 * One R2 delete call holds up to 1,000 keys, so 300 workspaces go in one call. Throws when a delete fails, so the caller
 * keeps the rows and tries again next run instead of orphaning the photos.
 */
export async function deleteWorkspacePhotos(workspaceIds: string[], store?: BlobStore): Promise<void> {
  const blobs = store ?? (await getBlobStore());
  for (let i = 0; i < workspaceIds.length; i += 300) {
    const keys = workspaceIds.slice(i, i + 300).flatMap((id) => (PhotoKey.safeParse(`ws/${id}/${PHOTO_NAME}.jpg`).success ? workspacePhotoKeys(id) : []));
    if (keys.length) await blobs.delete(keys);
  }
}

/** Reads a photo back (the Worker base64s it into the vision call). A key outside this workspace's folder is a miss. */
export async function getMenuPhoto(workspaceId: string, key: string, store?: BlobStore): Promise<BlobObject | null> {
  if (!PhotoKey.safeParse(key).success || !key.startsWith(`ws/${workspaceId}/`)) return null;
  return (store ?? (await getBlobStore())).get(key);
}
