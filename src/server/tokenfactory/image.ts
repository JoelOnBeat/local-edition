import { HttpError } from "@/server/http/errors";
import type { MenuMime } from "./menu";

/** Identify an image by its first bytes, never by the claimed content type. */
export function sniffImage(b: Uint8Array): MenuMime | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) {
    return "image/png";
  }
  const ascii = (from: number, to: number) => String.fromCharCode(...b.subarray(from, to));
  if (b.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  return null;
}

/** Throws HttpError(415 unsupported_image) when the bytes are not a jpg, png or webp, or the file is empty. */
export function requireMenuImage(bytes: Uint8Array): MenuMime {
  if (bytes.length === 0) throw new HttpError(400, "empty_image", "The image file is empty.");
  const mime = sniffImage(bytes);
  if (!mime) throw new HttpError(415, "unsupported_image", "The file is not a jpg, png or webp image.");
  return mime;
}
