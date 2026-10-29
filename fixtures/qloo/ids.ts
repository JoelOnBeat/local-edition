import { hash53 } from "@/server/qloo/evidence";

/** Deterministic UUID-shaped id for a synthetic entity. */
export function fakeUuid(seed: string): string {
  const hex = (hash53(seed, 11) + hash53(seed, 29) + hash53(seed, 47)).slice(0, 32);
  const variant = "89ab"[parseInt(hex[16], 16) % 4];
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
