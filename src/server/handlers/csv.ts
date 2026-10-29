import Papa from "papaparse";
import type { StoreInput } from "@/contract";
import { HttpError } from "../http/errors";

export const MAX_IMPORT_ROWS = 50;
export const MAX_CSV_BYTES = 100_000;
const REQUIRED = ["name", "address", "lat", "lon"] as const;
const MAX_TEXT = 80;
const MAX_ADDRESS = 120;

const CONTROL = /[\u0000-\u001f\u007f]/g;
const clean = (v: unknown) => String(v ?? "").replace(CONTROL, " ").trim();

function toCoord(raw: string, min: number, max: number): number | null {
  if (!/^[-+]?\d+(\.\d+)?$/.test(raw)) return null;
  const n = Number(raw);
  return n >= min && n <= max ? n : null;
}

/**
 * Parses `name,address,lat,lon` CSV. All-or-nothing: any bad row rejects the file with a message that
 * names the first few offending rows, so a head-office user can fix the sheet and re-upload.
 */
export function parseStoreCsv(text: string): StoreInput[] {
  if (new TextEncoder().encode(text).length > MAX_CSV_BYTES) {
    throw new HttpError(413, "csv_too_large", "That CSV is too large. Keep it under 100 KB.");
  }
  const parsed = Papa.parse<Record<string, unknown>>(text.replace(/^﻿/, "").trim(), {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim().toLowerCase(),
  });
  const fields = parsed.meta.fields ?? [];
  const missing = REQUIRED.filter((c) => !fields.includes(c));
  if (missing.length > 0) {
    throw new HttpError(400, "invalid_csv", `Missing column${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}. Expected name,address,lat,lon.`);
  }
  if (parsed.data.length === 0) throw new HttpError(400, "invalid_csv", "The CSV has a header but no stores.");
  if (parsed.data.length > MAX_IMPORT_ROWS) {
    throw new HttpError(400, "too_many_rows", `Import up to ${MAX_IMPORT_ROWS} stores at a time (found ${parsed.data.length}).`);
  }

  const problems: string[] = [];
  const stores: StoreInput[] = [];
  parsed.data.forEach((row, i) => {
    const line = i + 2; // header is line 1
    const name = clean(row.name);
    const addressLabel = clean(row.address);
    const lat = toCoord(clean(row.lat), -90, 90);
    const lon = toCoord(clean(row.lon), -180, 180);
    const bad: string[] = [];
    if (!name || name.length > MAX_TEXT) bad.push(`name must be 1-${MAX_TEXT} characters`);
    if (!addressLabel || addressLabel.length > MAX_ADDRESS) bad.push(`address must be 1-${MAX_ADDRESS} characters`);
    if (lat === null) bad.push("lat must be a number from -90 to 90");
    if (lon === null) bad.push("lon must be a number from -180 to 180");
    if (bad.length > 0) problems.push(`Row ${line}: ${bad.join(", ")}`);
    else stores.push({ name, addressLabel, lat: lat!, lon: lon! });
  });
  if (problems.length > 0) {
    const more = problems.length > 3 ? ` (and ${problems.length - 3} more)` : "";
    throw new HttpError(400, "invalid_csv", `${problems.slice(0, 3).join("; ")}${more}.`);
  }
  return stores;
}

const nameKey = (s: Pick<StoreInput, "name" | "addressLabel">) =>
  `${s.name}|${s.addressLabel}`.toLowerCase().replace(/\s+/g, " ").trim();

/** Drops rows whose name and address match a store the chain already has, or an earlier row. */
export function dedupeStores(rows: StoreInput[], existing: Pick<StoreInput, "name" | "addressLabel">[]): StoreInput[] {
  const seen = new Set(existing.map(nameKey));
  return rows.filter((row) => {
    const key = nameKey(row);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
