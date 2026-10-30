/** Cookie reading and writing shared by the visitor workspace cookie (`le_ws`) and the session cookie (`le_sid`). */

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const at = part.indexOf("=");
    if (at !== -1 && part.slice(0, at).trim() === name) {
      try {
        return decodeURIComponent(part.slice(at + 1).trim());
      } catch {
        return null; // a malformed %-sequence is a cookie we did not issue: treat it as absent
      }
    }
  }
  return null;
}

/** Always Secure in production; elsewhere only when the request itself came over https. */
export function isSecureRequest(request: Request): boolean {
  if (process.env.NODE_ENV === "production") return true;
  return new URL(request.url).protocol === "https:" || request.headers.get("x-forwarded-proto") === "https";
}

/** HttpOnly, SameSite=Lax, Path=/ and Secure when the request is. `maxAgeSeconds` 0 expires the cookie. */
export function buildCookie(name: string, value: string, maxAgeSeconds: number, secure: boolean): string {
  const attrs = [`${name}=${encodeURIComponent(value)}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${maxAgeSeconds}`];
  if (secure) attrs.push("Secure");
  return attrs.join("; ");
}
