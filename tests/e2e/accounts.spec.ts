import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";

/**
 * Accounts smoke (server started with SMOKE_MODE=app, STORE_DRIVER=file, QLOO/TF/TAVILY in replay): sign up, onboard on the photo + CSV
 * fallback (no Square), build, approve, sign out, sign in; and a second account deleting itself. Plain screens, selected by data-testid.
 *
 * Run it against `LE_DATA_DIR=<scratch dir> QLOO_MODE=replay TF_MODE=replay TAVILY_MODE=replay npm run dev -- --port 3107` with
 * `SMOKE_MODE=app BASE_URL=http://localhost:3107 PORT=3107 npx playwright test tests/e2e/accounts.spec.ts --workers=1`.
 * Start the server with CODE_SENDER=log as well (codes are then readable from /api/auth/dev-outbox, a 404 in production); the password path
 * is still covered here. next.config.ts has `experimental.mcpServer: false`: without it `next dev` reloads pages in a loop under a browser.
 */
test.skip(process.env.SMOKE_MODE !== "app", "runs against a server started in app data mode (SMOKE_MODE=app)");

const unique = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const PASSWORD = "correct horse battery staple";
const ROOT = process.cwd();

/** A distinct client address per test, so the per-network sign-up window never mixes runs (dev has no Cloudflare header). */
test.use({ extraHTTPHeaders: { "x-forwarded-for": `198.51.100.${1 + Math.floor(Math.random() * 250)}` } });

async function signUp(page: Page, email: string, chain: string) {
  await open(page, "/signup");
  await expect(page.getByTestId("signup-free")).toBeVisible();
  await page.getByTestId("signup-name").fill("Maya Okafor");
  await page.getByTestId("signup-email").fill(email);
  await page.getByTestId("signup-chain").fill(chain);
  await page.getByTestId("signup-password").fill(PASSWORD);
  await page.getByTestId("signup-submit").click();
  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(page.getByTestId("account-email")).toHaveText(email);
}

/** Opens a page and waits until React has hydrated it (the account menu or form hook has asked who is signed in), so a click is never a native form submit. */
async function open(page: Page, path: string) {
  const hydrated = page.waitForResponse((r) => r.url().endsWith("/api/auth/me"));
  await page.goto(path);
  await hydrated;
}

/** The sign-in screen leads with the emailed code when a sender is configured; this switches to the password form. */
async function usePassword(page: Page) {
  const toggle = page.getByTestId("signin-use-password");
  if (await toggle.isVisible().catch(() => false)) await toggle.click();
  await expect(page.getByTestId("signin-form")).toBeVisible();
}

const stepStatus = (page: Page, id: string) => page.getByTestId(`step-nav-${id}`);

test("sign up, onboard on the photo + CSV fallback, build, approve, sign out, sign in", async ({ page }) => {
  test.setTimeout(240_000);
  const email = `maya.${unique()}@kettleandkiln.example`;
  await signUp(page, email, "Kettle & Kiln");

  // 1. Chain basics.
  await expect(page.getByTestId("step-panel")).toHaveAttribute("data-step", "basics");
  await page.getByTestId("basics-category").selectOption("coffee");
  await page.getByTestId("basics-city").fill("New York");
  await page.getByTestId("basics-save").click();
  await expect(stepStatus(page, "basics")).toHaveAttribute("data-status", "done");

  // 2. Menu: no Square, so a photo of the menu board.
  await expect(page.getByTestId("step-panel")).toHaveAttribute("data-step", "menu");
  await page.getByTestId("menu-photo").setInputFiles(join(ROOT, "public/sample/menu-board-photo.png"));
  await expect(page.getByTestId("menu-read")).toBeVisible({ timeout: 60_000 });
  await page.getByTestId("menu-save").click();
  await expect(stepStatus(page, "menu")).toHaveAttribute("data-status", "done");

  // 3. Stores: the CSV.
  await page.getByTestId("step-nav-stores").click();
  await page.getByTestId("stores-csv").fill(readFileSync(join(ROOT, "fixtures/sample/stores.csv"), "utf8"));
  await page.getByTestId("stores-import").click();
  await expect(page.getByTestId("store-row")).toHaveCount(8);
  await expect(stepStatus(page, "stores")).toHaveAttribute("data-status", "done");

  // 4. Brand voice, 5. taste anchors.
  await page.getByTestId("step-nav-voice").click();
  await page.getByTestId("voice-0").fill("Warm and plain-spoken, like the person who knows your order.");
  await page.getByTestId("voice-save").click();
  await expect(stepStatus(page, "voice")).toHaveAttribute("data-status", "done");
  await page.getByTestId("step-nav-anchors").click();
  await page.getByTestId("anchors-q").fill("blue bottle");
  await page.getByTestId("anchors-search").click();
  await page.getByTestId("anchor-pick-0").click();
  await page.getByTestId("anchors-save").click();
  await expect(stepStatus(page, "anchors")).toHaveAttribute("data-status", "done");

  // 6. Optional tools: skip. The build step is open and no longer blocked.
  await page.getByTestId("step-nav-tools").click();
  await page.getByTestId("step-skip").click();
  await expect(stepStatus(page, "tools")).toHaveAttribute("data-status", "skipped");

  // 7. Build, then approve.
  await page.getByTestId("step-nav-build").click();
  await expect(page.getByTestId("step-blocked")).toHaveCount(0);
  await page.getByTestId("build-start").click();
  await expect(page.getByTestId("build-phase")).toHaveAttribute("data-phase", "built", { timeout: 150_000 });
  await expect(page.getByTestId("build-edition")).toHaveCount(8);
  await page.getByTestId("build-approve-all").click();
  await expect(page.getByTestId("build-phase")).toHaveAttribute("data-phase", "approved", { timeout: 60_000 });
  await expect(stepStatus(page, "build")).toHaveAttribute("data-status", "done");
  await expect(page.getByTestId("onboarding-complete")).toBeVisible();
  const editions = (await (await page.request.get("/api/editions")).json()) as { status: string }[];
  expect(editions).toHaveLength(8);
  expect(editions.every((e) => e.status === "approved")).toBe(true);

  // 8. Sign out: the session is gone, the data stays.
  await page.getByTestId("account-signout").click();
  await expect(page).toHaveURL(/\/signin$/);
  expect((await (await page.request.get("/api/auth/me")).json()).user).toBeNull();

  // 9. Wrong password first (plain error, no sign-in), then the right one: back in the same workspace, onboarding already complete.
  await usePassword(page);
  await page.getByTestId("signin-pw-email").fill(email);
  await page.getByTestId("signin-password").fill("not the password at all");
  await page.getByTestId("signin-submit").click();
  await expect(page.getByTestId("signin-pw-error")).toHaveAttribute("data-code", "invalid_credentials");
  await page.getByTestId("signin-password").fill(PASSWORD);
  await page.getByTestId("signin-submit").click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByTestId("account-email")).toHaveText(email);
  const again = (await (await page.request.get("/api/editions")).json()) as { status: string }[];
  expect(again).toHaveLength(8);
});

test("a visitor who tried the sample chain keeps it on sign-up; deleting the account removes it", async ({ page }) => {
  const email = `omar.${unique()}@birchcoffee.example`;
  await open(page, "/"); // "Try the sample chain": a real guest session on a private sample workspace
  await page.getByTestId("landing-open-app").click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByTestId("nav-portfolio")).toBeVisible();
  await expect(page.getByTestId("account-signup")).toBeVisible();
  await page.getByTestId("account-signup").click();
  await expect(page.getByTestId("signup-keep")).toBeVisible();
  await page.getByTestId("signup-keep").check();
  await page.getByTestId("signup-name").fill("Omar Haddad");
  await page.getByTestId("signup-email").fill(email);
  await page.getByTestId("signup-chain").fill("Birch Coffee");
  await page.getByTestId("signup-password").fill(PASSWORD);
  await page.getByTestId("signup-submit").click();
  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(stepStatus(page, "stores")).toHaveAttribute("data-status", "done"); // the sample's stores came along
  expect(((await (await page.request.get("/api/workspace")).json()) as { stores: unknown[] }).stores).toHaveLength(8);

  // Wrong password first: nothing is deleted.
  await page.getByTestId("account-delete").click();
  await page.getByTestId("account-delete-password").fill("not the password at all");
  await page.getByTestId("account-delete-confirm").click();
  await expect(page.getByTestId("account-error")).toHaveAttribute("data-code", "invalid_credentials");
  await page.getByTestId("account-delete-password").fill(PASSWORD);
  await page.getByTestId("account-delete-confirm").click();
  await expect(page).toHaveURL(/\/signin\?deleted=1$/);
  await expect(page.getByTestId("signin-deleted")).toBeVisible();

  await usePassword(page);
  await page.getByTestId("signin-pw-email").fill(email);
  await page.getByTestId("signin-password").fill(PASSWORD);
  await page.getByTestId("signin-submit").click();
  await expect(page.getByTestId("signin-pw-error")).toHaveAttribute("data-code", "invalid_credentials");
});
