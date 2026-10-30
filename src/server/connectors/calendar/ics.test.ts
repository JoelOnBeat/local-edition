import { describe, expect, it } from "vitest";
import type { EventItem } from "@/contract";
import { mockEditions } from "@/mocks/editions";
import { MemoryLedger } from "../ledger-memory";
import { createMemoryRepo } from "../../store/memory";
import { ensureDemoWorkspace } from "../../session";
import { buildIcs, escapeText, fold, localTimes, type IcsEvent } from "./ics";
import { listFeeds, renderFeed, resolveFeed, TOKEN_PATTERN } from "./feeds";

const event = (over: Partial<IcsEvent> = {}): IcsEvent => ({
  uid: "ed_williamsburg_2026-10-26-ev_1", weekOf: "2026-10-26", day: "Thu", time: "19:00", durationMinutes: 120,
  summary: "Vinyl night, with a pour-over; bring a record", description: "Line one\nLine two, with a comma", location: "Bedford Ave & N 7th St, New York",
  stampedAt: "2026-10-26T00:05:00.000Z", sequence: 1, ...over,
});

/** A small RFC 5545 structural checker: line endings, folding, balanced components, required properties. */
function validate(ics: string): { errors: string[]; lines: string[] } {
  const errors: string[] = [];
  if (!ics.endsWith("\r\n")) errors.push("must end with CRLF");
  if (/(^|[^\r])\n/.test(ics)) errors.push("bare LF");
  const physical = ics.split("\r\n").slice(0, -1);
  for (const l of physical) if (new TextEncoder().encode(l).length > 75) errors.push(`line over 75 octets: ${l.slice(0, 30)}`);
  const lines = physical.reduce<string[]>((acc, l) => (l.startsWith(" ") ? (acc[acc.length - 1] += l.slice(1), acc) : (acc.push(l), acc)), []);
  const stack: string[] = [];
  for (const l of lines) {
    if (l.startsWith("BEGIN:")) stack.push(l.slice(6));
    else if (l.startsWith("END:")) { if (stack.pop() !== l.slice(4)) errors.push(`unbalanced ${l}`); }
  }
  if (stack.length) errors.push("unclosed component");
  if (lines[0] !== "BEGIN:VCALENDAR" || lines.at(-1) !== "END:VCALENDAR") errors.push("not wrapped in VCALENDAR");
  for (const p of ["VERSION:2.0", "PRODID:"]) if (!lines.some((l) => l.startsWith(p))) errors.push(`missing ${p}`);
  const tzids = new Set(lines.filter((l) => l.startsWith("TZID:")).map((l) => l.slice(5)));
  let inEvent = false; let props: string[] = [];
  for (const l of lines) {
    if (l === "BEGIN:VEVENT") { inEvent = true; props = []; }
    else if (l === "END:VEVENT") {
      inEvent = false;
      for (const need of ["UID", "DTSTAMP", "DTSTART", "SUMMARY"]) if (!props.some((p) => p === need)) errors.push(`VEVENT missing ${need}`);
    } else if (inEvent) {
      const name = l.split(/[:;]/)[0]; props.push(name);
      const tz = /;TZID=([^:]+):/.exec(l)?.[1];
      if (tz && !tzids.has(tz)) errors.push(`TZID ${tz} has no VTIMEZONE`);
    }
  }
  return { errors, lines };
}

describe("iCalendar writer", () => {
  it("produces a valid calendar with a VTIMEZONE for America/New_York", () => {
    const ics = buildIcs("Kettle & Kiln: event nights", [event(), event({ uid: "b", day: "Sat", time: "23:00" })]);
    const { errors, lines } = validate(ics);
    expect(errors).toEqual([]);
    expect(lines).toContain("DTSTART;TZID=America/New_York:20261029T190000");
    expect(lines).toContain("DTEND;TZID=America/New_York:20261029T210000");
    expect(lines).toContain("X-WR-TIMEZONE:America/New_York");
    expect(lines.filter((l) => l === "BEGIN:VEVENT")).toHaveLength(2);
  });
  it("rolls a late event over midnight", () => {
    expect(localTimes({ weekOf: "2026-10-26", day: "Sat", time: "23:00", durationMinutes: 120 })).toEqual({ start: "20261031T230000", end: "20261101T010000" });
    expect(localTimes({ weekOf: "2026-10-26", day: "Sun", time: "09:30", durationMinutes: 60 }).start).toBe("20261101T093000");
  });
  it("keeps UIDs stable and the bytes identical between renders (no clock inside)", () => {
    const a = buildIcs("x", [event()]);
    expect(buildIcs("x", [event()])).toBe(a);
    expect(a).toContain("UID:ed_williamsburg_2026-10-26-ev_1@localedition.pages.dev");
    expect(a).toContain("DTSTAMP:20261026T000500Z");
  });
  it("escapes commas, semicolons, backslashes and newlines, and folds long lines without splitting characters", () => {
    expect(escapeText("a,b;c\\d\ne")).toBe("a\\,b\;c\\\\d\\ne");
    const long = event({ description: `${"Rolled with cardamom sugar, orange zest. ".repeat(8)}Café ☕ 🎶`.trim() });
    const ics = buildIcs("x", [long]);
    expect(validate(ics).errors).toEqual([]);
    const unfolded = ics.replace(/\r\n /g, "");
    expect(unfolded).toContain("Café ☕ 🎶");
  });
  it("an empty feed is still a valid calendar", () => {
    expect(validate(buildIcs("Nothing yet", [])).errors).toEqual([]);
  });
  it("fold leaves short lines alone", () => {
    expect(fold("SUMMARY:short")).toBe("SUMMARY:short");
  });
});

describe("calendar feeds", () => {
  async function setup(approve: "all" | "none") {
    const repo = createMemoryRepo();
    await ensureDemoWorkspace(repo);
    for (const e of mockEditions) {
      const copy = structuredClone(e);
      copy.items = copy.items.map((i) => (i.kind === "event" ? { ...i, status: approve === "all" ? "approved" : "draft" } : i)) as typeof copy.items;
      await repo.putEdition(copy);
    }
    const deps = { ledger: new MemoryLedger(), repo, appUrl: "https://localedition.pages.dev" };
    return deps;
  }

  it("offers a chain feed and one per store with unguessable, stable tokens and subscribe links", async () => {
    const deps = await setup("all");
    const feeds = await listFeeds(deps, "demo");
    expect(feeds).toHaveLength(9);
    expect(feeds[0]).toMatchObject({ scope: "chain", storeId: null, eventCount: 8 });
    expect(feeds[1]).toMatchObject({ scope: "store", eventCount: 1 });
    for (const f of feeds) {
      const token = /\/api\/calendar\/([^/]+)\.ics$/.exec(f.url)![1];
      expect(token).toMatch(TOKEN_PATTERN);
      expect(f.webcalUrl).toBe(f.url.replace("https:", "webcal:"));
      expect(f.googleUrl).toBe(`https://calendar.google.com/calendar/r?cid=${encodeURIComponent(f.webcalUrl)}`);
      expect(f.outlookUrl).toContain(`url=${encodeURIComponent(f.url)}`);
    }
    expect(new Set(feeds.map((f) => f.url)).size).toBe(9);
    expect((await listFeeds(deps, "demo")).map((f) => f.url)).toEqual(feeds.map((f) => f.url));
  });

  it("serves only approved event nights, as valid ICS, for the right scope", async () => {
    const deps = await setup("all");
    const feeds = await listFeeds(deps, "demo");
    const chainIcs = await renderFeed(deps, await resolveFeed(deps, feeds[0].url.split("/").pop()!));
    expect(validate(chainIcs).errors).toEqual([]);
    expect(chainIcs.match(/BEGIN:VEVENT/g)).toHaveLength(8);
    const storeIcs = await renderFeed(deps, await resolveFeed(deps, feeds[1].url.split("/").pop()!));
    expect(storeIcs.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    const ev = mockEditions[0].items.find((i): i is EventItem => i.kind === "event")!;
    expect(storeIcs.replace(/\r\n /g, "")).toContain(`SUMMARY:${escapeText(ev.title)} (Williamsburg)`);

    const none = await setup("none");
    const f2 = await listFeeds(none, "demo");
    expect(f2[0].eventCount).toBe(0);
    expect((await renderFeed(none, await resolveFeed(none, f2[0].url.split("/").pop()!))).includes("BEGIN:VEVENT")).toBe(false);
  });

  it("a guessed, malformed or unknown token is a 404 and reveals nothing", async () => {
    const deps = await setup("all");
    for (const t of ["", "abc", "../../etc/passwd.ics", "a".repeat(32), "A".repeat(200)]) {
      await expect(resolveFeed(deps, t)).rejects.toMatchObject({ status: 404 });
    }
  });
});
