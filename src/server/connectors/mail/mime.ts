/** Minimal RFC 5322 / 2045 writer for one multipart/alternative message (plain text first, HTML last, as clients expect). */

const utf8 = new TextEncoder();

function b64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

const wrap76 = (s: string): string => s.replace(/(.{76})/g, "$1\r\n");

/** RFC 2047 encoded-word for a header value that is not plain ASCII. */
export function encodeHeader(value: string): string {
  return /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${b64(utf8.encode(value))}?=`;
}

/** Display names with specials must be quoted; line breaks are never allowed (header injection). */
export function mailbox(name: string | null, email: string): string {
  const cleanEmail = email.replace(/[\r\n<>,;"]/g, "");
  if (!name) return cleanEmail;
  const cleanName = name.replace(/[\r\n"\\]/g, " ").trim();
  return cleanName ? `${encodeHeader(`"${cleanName}"`)} <${cleanEmail}>` : cleanEmail;
}

export function buildMime(input: { to: string; subject: string; text: string; html: string; boundary?: string }): string {
  const boundary = input.boundary ?? `le_${crypto.randomUUID().replace(/-/g, "")}`;
  const part = (type: string, body: string) =>
    [`--${boundary}`, `Content-Type: ${type}; charset="UTF-8"`, "Content-Transfer-Encoding: base64", "", wrap76(b64(utf8.encode(body)))].join("\r\n");
  return [
    `To: ${input.to}`,
    `Subject: ${encodeHeader(input.subject.replace(/[\r\n]+/g, " "))}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    part("text/plain", input.text),
    part("text/html", input.html),
    `--${boundary}--`,
    "",
  ].join("\r\n");
}

/** Base64url of the whole message: the `raw` field of Gmail's users.messages.send. */
export function toRaw(mime: string): string {
  return b64(utf8.encode(mime)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
