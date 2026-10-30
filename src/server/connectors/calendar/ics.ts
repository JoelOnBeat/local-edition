import type { Weekday } from "@/contract";

/** iCalendar (RFC 5545) writer for the event-night feeds. Pure: no clock, so the same edition always yields the same bytes. */

export const CALENDAR_TZID = "America/New_York";
export const UID_DOMAIN = "localedition.pages.dev";

export interface IcsEvent {
  /** Stable for the life of the event: edition id + item id. Never reused for a different event. */
  uid: string;
  /** Monday of the edition week, YYYY-MM-DD. */
  weekOf: string;
  day: Weekday;
  /** "19:00", wall-clock in America/New_York. */
  time: string;
  durationMinutes: number;
  summary: string;
  description: string;
  location: string;
  /** When the event was last written (ISO). Becomes DTSTAMP, so it does not change between fetches. */
  stampedAt: string;
  /** Item version: SEQUENCE, so calendars take an edited event as an update. */
  sequence: number;
  url?: string | null;
}

const DAY_OFFSET: Record<Weekday, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };

/** Escapes TEXT values: backslash, semicolon, comma, newline. */
export const escapeText = (s: string): string => s.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

/** Folds a content line at 75 octets, continuing with CRLF + space; never splits a multi-byte character. */
export function fold(line: string): string {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let cur = "";
  let bytes = 0;
  let limit = 75;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (bytes + n > limit) {
      parts.push(cur);
      cur = "";
      bytes = 0;
      limit = 74; // continuation lines start with a space
    }
    cur += ch;
    bytes += n;
  }
  parts.push(cur);
  return parts.join("\r\n ");
}

const pad = (n: number) => String(n).padStart(2, "0");
const stamp = (d: Date) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;

/** Local wall-clock start and end as `YYYYMMDDTHHMMSS` (floating arithmetic in UTC, then written without a Z). */
export function localTimes(e: Pick<IcsEvent, "weekOf" | "day" | "time" | "durationMinutes">): { start: string; end: string } {
  const [y, m, d] = e.weekOf.split("-").map(Number);
  const [hh, mm] = e.time.split(":").map(Number);
  const start = new Date(Date.UTC(y, m - 1, d + DAY_OFFSET[e.day], hh, mm));
  return { start: stamp(start), end: stamp(new Date(start.getTime() + e.durationMinutes * 60_000)) };
}

const utcStamp = (iso: string): string => `${stamp(new Date(iso))}Z`;

const VTIMEZONE = [
  "BEGIN:VTIMEZONE",
  `TZID:${CALENDAR_TZID}`,
  "BEGIN:DAYLIGHT",
  "TZOFFSETFROM:-0500", "TZOFFSETTO:-0400", "TZNAME:EDT", "DTSTART:20070311T020000", "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU",
  "END:DAYLIGHT",
  "BEGIN:STANDARD",
  "TZOFFSETFROM:-0400", "TZOFFSETTO:-0500", "TZNAME:EST", "DTSTART:20071104T020000", "RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU",
  "END:STANDARD",
  "END:VTIMEZONE",
];

export function buildIcs(calendarName: string, events: IcsEvent[]): string {
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Local Edition//Event nights//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(calendarName)}`, `X-WR-TIMEZONE:${CALENDAR_TZID}`,
    "REFRESH-INTERVAL;VALUE=DURATION:PT6H", "X-PUBLISHED-TTL:PT6H",
    ...VTIMEZONE,
  ];
  for (const e of [...events].sort((a, b) => a.uid.localeCompare(b.uid))) {
    const { start, end } = localTimes(e);
    lines.push(
      "BEGIN:VEVENT",
      `UID:${e.uid}@${UID_DOMAIN}`,
      `DTSTAMP:${utcStamp(e.stampedAt)}`,
      `SEQUENCE:${e.sequence}`,
      `DTSTART;TZID=${CALENDAR_TZID}:${start}`,
      `DTEND;TZID=${CALENDAR_TZID}:${end}`,
      `SUMMARY:${escapeText(e.summary)}`,
      `DESCRIPTION:${escapeText(e.description)}`,
      `LOCATION:${escapeText(e.location)}`,
      ...(e.url ? [`URL:${e.url}`] : []),
      "TRANSP:TRANSPARENT",
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return `${lines.map(fold).join("\r\n")}\r\n`;
}
