import { beforeEach, describe, expect, it } from "vitest";
import type { Store } from "@/contract";
import { MAX_CSV_BYTES, MAX_IMPORT_ROWS, parseStoreCsv } from "@/server/handlers/csv";
import { HttpError } from "@/server/http/errors";
import { importStores } from "@/server/handlers/workspace";
import { getWorkspace } from "@/server/handlers/workspace";
import { cookieOf, freshApp, req } from "./helpers";

const fail = (csv: string) => {
  try { parseStoreCsv(csv); } catch (e) { return e as HttpError; }
  throw new Error("expected the CSV to be rejected");
};

describe("T2 store CSV", () => {
  it("parses valid rows, tolerating BOM, header case, spaces and quoted commas", () => {
    const csv = '﻿Name, Address ,LAT,Lon\n"Greenpoint","Manhattan Ave, at Greenpoint Ave",40.7311,-73.9544\n\nCobble Hill,Court St & Atlantic Ave,40.6905,-73.9959\n';
    expect(parseStoreCsv(csv)).toEqual([
      { name: "Greenpoint", addressLabel: "Manhattan Ave, at Greenpoint Ave", lat: 40.7311, lon: -73.9544 },
      { name: "Cobble Hill", addressLabel: "Court St & Atlantic Ave", lat: 40.6905, lon: -73.9959 },
    ]);
  });

  it("rejects missing columns, header-only files and non-CSV text with an actionable message", () => {
    expect(fail("name,lat,lon\nA,1,2")).toMatchObject({ status: 400, code: "invalid_csv", message: expect.stringContaining("address") });
    expect(fail("name,address,lat,lon\n")).toMatchObject({ code: "invalid_csv" });
    expect(fail("just some words")).toMatchObject({ code: "invalid_csv" });
  });

  it("rejects bad coordinates and blank fields, naming the row (header is line 1)", () => {
    const e = fail("name,address,lat,lon\nOk,1 Main St,40.7,-73.9\nBad,2 Main St,91,-73.9\nWorse,,40,abc\n");
    expect(e.code).toBe("invalid_csv");
    expect(e.message).toContain("Row 3: lat must be a number from -90 to 90");
    expect(e.message).toContain("Row 4: address");
    expect(e.message).toContain("lon must be a number");
    expect(e.message).not.toContain("Row 2");
  });

  it("rejects lat/lon written as exponents, hex, empty or Infinity", () => {
    for (const bad of ["1e2", "0x10", "", "Infinity", "NaN"]) expect(fail(`name,address,lat,lon\nA,1 Main,${bad},10`).code).toBe("invalid_csv");
  });

  it("enforces the 50-row and size limits", () => {
    const rows = (n: number) => `name,address,lat,lon\n${Array.from({ length: n }, (_, i) => `S${i},${i} Main,40.7,-73.9`).join("\n")}`;
    expect(parseStoreCsv(rows(MAX_IMPORT_ROWS))).toHaveLength(MAX_IMPORT_ROWS);
    expect(fail(rows(MAX_IMPORT_ROWS + 1))).toMatchObject({ code: "too_many_rows" });
    expect(fail(`name,address,lat,lon\nA,${"x".repeat(MAX_CSV_BYTES)},1,2`)).toMatchObject({ status: 413, code: "csv_too_large" });
  });

  it("strips control characters so a cell cannot smuggle line breaks into a label", () => {
    const [row] = parseStoreCsv('name,address,lat,lon\n"A\u0007B","1 Main\u0000St",1,2');
    expect(row).toMatchObject({ name: "A B", addressLabel: "1 Main St" });
  });
});

describe("T2 POST /api/stores/import", () => {
  beforeEach(() => { freshApp(); });

  it("adds the rows to the caller's workspace only, and is all-or-nothing", async () => {
    const first = await getWorkspace(req("/api/workspace", { ip: "10.1.1.1" }));
    const cookie = cookieOf(first);
    const ok = await importStores(req("/api/stores/import", { cookie, method: "POST", headers: { "content-type": "text/csv" }, body: "name,address,lat,lon\nGreenpoint,Manhattan Ave & Greenpoint Ave,40.7311,-73.9544\nCobble Hill,Court St & Atlantic Ave,40.6905,-73.9959\n" }));
    const added = (await ok.json()) as Store[];
    expect(added.map((s) => s.name)).toEqual(["Greenpoint", "Cobble Hill"]);
    expect(added.every((s) => s.colorIndex >= 1 && s.colorIndex <= 8)).toBe(true);

    const bad = await importStores(req("/api/stores/import", { cookie, method: "POST", body: "name,address,lat,lon\nFine,1 Main,40,-73\nBroken,2 Main,200,-73" }));
    expect(bad.status).toBe(400);
    const ws = await (await getWorkspace(req("/api/workspace", { cookie }))).json();
    expect(ws.stores).toHaveLength(10); // 8 sample + 2, nothing from the rejected file
  });

  it("answers an empty body with {error, code}", async () => {
    const res = await importStores(req("/api/stores/import", { method: "POST", body: "" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "invalid_input" });
  });
});
