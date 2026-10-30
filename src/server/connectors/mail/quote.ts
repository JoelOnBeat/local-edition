/** Reduces a mail reply to what the person actually wrote: no quoted history, signature or disclaimer. */

const QUOTE_START = [
  /^on .{5,120}wrote:\s*$/i,
  /^-{2,}\s*original message\s*-{2,}/i,
  /^_{5,}$/,
  /^from:\s.+/i,
  /^sent from my /i,
  /^get outlook for /i,
  /^-- ?$/,
];

export function stripQuoted(raw: string): string {
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  const kept: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith(">")) continue;
    // "On Mon, Oct 26, 2026 at 9:14 AM Name <x@y>" can wrap onto a second line that ends in "wrote:".
    const isWrapped = /^on .{5,120}$/i.test(line) && /wrote:\s*$/i.test((lines[i + 1] ?? "").trim());
    if (isWrapped || QUOTE_START.some((re) => re.test(line))) break;
    kept.push(lines[i]);
  }
  return kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export const excerptOf = (text: string, max = 400): string => (text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`);

/** "Name <a@b.c>" or "a@b.c" -> { name, email } (lowercased email). */
export function parseSender(raw: string): { name: string | null; email: string } {
  const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(raw);
  if (m) return { name: m[1].trim() || null, email: m[2].trim().toLowerCase() };
  return { name: null, email: raw.trim().toLowerCase() };
}

/** Subject without RE:/FW: prefixes, lowercased: the key that ties an Outlook (or id-less Gmail) reply to the card email we sent. */
export const normalizeSubject = (subject: string): string => subject.replace(/^\s*((re|fw|fwd|aw|sv)\s*:\s*)+/i, "").replace(/\s+/g, " ").trim().toLowerCase();
