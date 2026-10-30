/** "just now", "4 min ago", "3 h ago", "2 days ago". Falls back to the date for anything older than a week. */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const s = Math.round((now - Date.parse(iso)) / 1000);
  if (!Number.isFinite(s)) return "";
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d} ${d === 1 ? "day" : "days"} ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "America/New_York" });
}
