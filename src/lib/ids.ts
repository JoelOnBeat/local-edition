/** Short prefixed ids (`ed_7k2m9x...`) from Web Crypto; works in Node and Workers. */
export function newId(prefix: string, bytes = 8): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  const body = [...buf].map((b) => b.toString(36).padStart(2, "0")).join("").slice(0, bytes * 2);
  return `${prefix}_${body}`;
}

/** Unguessable token for share links (staff cards). 24 base36 chars. */
export function newToken(): string {
  return newId("t", 12).slice(2);
}
