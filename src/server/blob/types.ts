import { z } from "zod";

export interface BlobObject {
  bytes: Uint8Array;
  contentType: string;
}

/** Menu-photo storage. R2 in production, the filesystem under `.data/blobs` in `next dev`, a Map in tests. */
export interface BlobStore {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<BlobObject | null>;
  delete(key: string): Promise<void>;
}

export const PHOTO_TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" } as const;
export type PhotoType = keyof typeof PHOTO_TYPES;

/** Same ceiling as the menu-read route (MENU_IMAGE_MAX_BYTES, 5 MB). */
export const PHOTO_MAX_BYTES = 5 * 1024 * 1024;

/** `ws/<workspaceId>/<uuid>.<ext>`: the only key shape any store accepts, so a key can never escape its folder. */
export const PhotoKey = z.string().regex(/^ws\/[A-Za-z0-9_~-]{1,64}\/[A-Za-z0-9-]{8,64}\.(jpg|png|webp)$/);
