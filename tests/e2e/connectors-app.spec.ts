import { expect, test } from "@playwright/test";
import { Connection, ConnectionsResponse, DeliveriesResponse } from "../../src/contract";

/**
 * App-mode smoke (server started with DATA_MODE=app, STORE_DRIVER=file and TF/TAVILY/QLOO in replay): the same flow against the real
 * routes. No connector credentials exist in this setup, so no delivery is expected; what must hold is that approval, the merged
 * connections read and the public pages all work against the real handlers.
 */
test.skip(process.env.SMOKE_MODE !== "app", "runs against a server started in app data mode (SMOKE_MODE=app)");

test("build, approve, merged connections, deliveries read, anchors search", async ({ page }) => {
  test.setTimeout(100_000);
  await page.goto("/app");
  await page.getByTestId("build-editions").click();
  await expect(page).toHaveURL(/\/app\/runs\//);
  await expect(page.getByTestId("run-status")).toHaveAttribute("data-finished", "true", { timeout: 40_000 });
  await page.getByTestId("run-back").first().click();

  await page.locator('[data-testid^="store-row-store_williamsburg"]').click();
  await expect(page.getByTestId("item-special")).toBeVisible();
  await page.getByTestId("approve-special").click();
  // With guardrails down (replay), copy is `unchecked`: the first click offers "Approve anyway", which a reader confirms by hand.
  const anyway = page.getByTestId("item-problem-fix-special");
  const approved = page.locator('[data-testid="item-special"][data-status="approved"]');
  await expect(anyway.or(approved)).toBeVisible();
  if (await anyway.isVisible()) await anyway.click();
  await expect(approved).toBeVisible();
  await page.getByTestId("approve-all").click();
  await expect(page.getByTestId("edition-status")).toHaveAttribute("data-status", /approved|flagged|draft/);

  const edition = await (await page.request.get("/api/editions")).json();
  const editionId = (edition as { id: string; storeId: string }[]).find((e) => e.storeId.includes("williamsburg"))!.id;
  const deliveries = DeliveriesResponse.parse(await (await page.request.get(`/api/connectors/deliveries?editionId=${editionId}`)).json());
  expect(Array.isArray(deliveries.deliveries)).toBe(true);

  const merged = ConnectionsResponse.parse(await (await page.request.get("/api/connections")).json());
  expect(merged.connections.map((c: Connection) => c.provider)).toEqual(["square", "slack", "gmail", "outlook", "calendar"]);

  await page.getByTestId("nav-connections").click();
  await expect(page.getByTestId("sync-log")).toBeVisible();
  await expect(page.getByTestId("conn-card-square")).toBeVisible();

  const anchors = await page.request.get("/api/anchors/search?q=blue");
  expect(anchors.status()).toBe(200);
});

test("/proof and /limits do not give a visitor a workspace", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/limits");
  await expect(page.getByTestId("limits-tavily-today")).toBeVisible();
  await expect(page.getByTestId("limits-qloo-today")).toBeVisible();
  await page.goto("/proof");
  await expect(page.getByTestId("proof-model-row").first()).toBeVisible();
  expect((await context.cookies()).filter((c) => c.name === "le_ws")).toEqual([]);
  await context.close();
});
