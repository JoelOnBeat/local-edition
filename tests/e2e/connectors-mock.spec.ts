import { expect, test } from "@playwright/test";

/**
 * Mock-mode smoke (server started with NEXT_PUBLIC_DATA_MODE=mock): build -> edition approve -> delivery chips -> connections log ->
 * store reply note -> accept suggestion. All navigation is in-app on purpose: the mock backend lives in the page and resets on a reload.
 */
test.skip(process.env.SMOKE_MODE !== "mock", "runs against a server started in mock data mode (SMOKE_MODE=mock)");

test("build, approve, deliveries, sync log, store reply, accept suggestion", async ({ page }) => {
  test.setTimeout(180_000); // the mock build streams eight stores at human speed
  await page.goto("/app");

  // 1. Build: the run view opens and finishes.
  await page.getByTestId("build-editions").click();
  await expect(page).toHaveURL(/\/app\/runs\//);
  await expect(page.getByTestId("run-status")).toHaveAttribute("data-finished", "true", { timeout: 120_000 });
  await page.getByTestId("run-back").first().click();

  // 2. Williamsburg: approving the special sends it to Square; approving everything sends the card to Slack and mail.
  await page.getByTestId("store-row-store_williamsburg").click();
  await expect(page.getByTestId("item-special")).toBeVisible();
  await expect(page.getByTestId("delivery-strip")).toHaveCount(0);
  await page.getByTestId("approve-special").click();
  await expect(page.getByTestId("item-special")).toHaveAttribute("data-status", "approved");
  await expect(page.getByTestId("delivery-square")).toHaveAttribute("data-status", "sent");
  await page.getByTestId("approve-all").click();
  await expect(page.getByTestId("edition-status")).toHaveAttribute("data-status", "approved");
  await expect(page.getByTestId("delivery-slack")).toHaveAttribute("data-status", "sent");
  await expect(page.getByTestId("delivery-gmail")).toHaveAttribute("data-status", "sent");

  // 3. The store's reply is filed next to the edition, and the poll label is shown because a mailbox is connected.
  await expect(page.getByTestId("store-note").first()).toContainText("Orange Peel Cortado");
  await expect(page.getByTestId("mail-poll-label")).toHaveText("Checks for store replies every 20 seconds");

  // 4. Connections: the sync log lists the moves, newest first.
  await page.getByTestId("nav-connections").click();
  await expect(page.getByTestId("sync-log")).toBeVisible();
  const kinds = page.getByTestId("sync-event");
  await expect(kinds.first()).toBeVisible();
  const text = (await kinds.allTextContents()).join("\n");
  expect(text).toContain("Orange Peel Cortado");
  expect(text).toMatch(/Staff card/);
  await expect(page.getByTestId("mail-poll-label")).toBeVisible();

  // 5. Park Slope: a manager asked for a change; accepting runs the regenerate and clears the suggestion.
  await page.getByTestId("nav-portfolio").click();
  await page.getByTestId("store-row-store_park-slope").click();
  await expect(page.getByTestId("store-note").first()).toContainText("non-dairy");
  await expect(page.getByTestId("suggestion")).toHaveCount(1);
  await page.getByTestId("suggestion-accept").click();
  await expect(page.getByTestId("suggestion")).toHaveCount(0, { timeout: 30_000 });
  await expect(page.getByTestId("suggestion-error")).toHaveCount(0);
});

test("/proof and /limits read server data without onboarding a workspace", async ({ page }) => {
  await page.goto("/limits");
  await expect(page.getByTestId("limits-qloo")).toBeVisible();
  await expect(page.getByTestId("limits-tavily-today")).toContainText("of 10 today");
  await page.goto("/proof");
  await expect(page.getByTestId("proof-model-row").first()).toBeVisible();
  expect(await page.getByTestId("proof-model-row").count()).toBeGreaterThanOrEqual(7);
});
