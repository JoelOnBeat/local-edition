import { putMenuPhoto } from "../blob";
import { createLogger } from "../log";

const log = createLogger("menu-photo");

/** The write side of the photo store: `putPhoto(workspaceId, bytes, mime) -> key`. Defaults to `src/server/blob`. */
export interface PhotoBlob {
  putPhoto(workspaceId: string, bytes: Uint8Array, mime: string): Promise<string>;
}

let override: PhotoBlob | undefined;

/** Tests pass a fake; `undefined` returns to the blob module (R2 on Workers, files in dev, a Map under test). */
export function setPhotoBlob(next: PhotoBlob | undefined): void {
  override = next;
}

/**
 * Keeps the uploaded board photo (key `ws/<workspaceId>/<uuid>.<ext>`) so the menu can be re-checked later.
 * Best effort: the read works from the bytes in hand, so a storage outage costs the saved copy and nothing else.
 */
export async function stashPhoto(workspaceId: string, bytes: Uint8Array, mime: string): Promise<string | null> {
  try {
    return await (override ? override.putPhoto(workspaceId, bytes, mime) : putMenuPhoto(workspaceId, bytes, mime));
  } catch (e) {
    log.warn("could not store the menu photo", { err: (e as Error).name });
    return null;
  }
}
