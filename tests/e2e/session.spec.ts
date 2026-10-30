import { expect, test, type Page } from "@playwright/test";

/**
 * Session smoke in the three states the launch checklist asks for: signed out, signed in, and with an expired cookie. Also the emailed
 * code flow (CODE_SENDER=log, codes read from /api/auth/dev-outbox) and the links that read the session. Same server as accounts.spec.ts.
 */
test.skip(process.env.SMOKE_MODE !== "app", "runs against a server started in app data mode (SMOKE_MODE=app)");

const unique = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const ORIGIN = process.env.BASE_URL ?? "http://localhost:3107";
test.use({ extraHTTPHeaders: { "x-forwarded-for": `198.18.${Math.floor(Math.random() * 250)}.${1 + Math.floor(Math.random() * 250)}` } });

async function open(page: Page, path: string) {
  const hydrated = page.waitForResponse((r) => r.url().endsWith("/api/auth/me"));
  await page.goto(path);
  await hydrated;
}

async function pasteCode(page: Page, text: string) {
  await page.getByTestId("code-box-0").evaluate((el, value) => {
    const data = new DataTransfer();
    data.setData("text", value);
    el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  }, text);
}

/** Signs in (or up) with the emailed code and lands on the page the app chooses. */
async function codeSignIn(page: Page, email: string, from = "/signin") {
  await open(page, from);
  await page.getByTestId("signin-email").fill(email);
  await page.getByTestId("signin-send-code").click();
  await expect(page.getByTestId("code-boxes")).toBeVisible();
  const code = (await (await page.request.get(`/api/auth/dev-outbox?email=${encodeURIComponent(email)}`)).json()).code as string;
  await pasteCode(page, `${code.slice(0, 3)} ${code.slice(3)}`);
}

test.describe("state 1: signed out", () => {
  test("/app/* goes to /signin?next=<path>, public pages stay open, data routes answer 401", async ({ page }) => {
    await page.goto("/app/compare");
    await expect(page).toHaveURL(/\/signin\?next=%2Fapp%2Fcompare$/);
    await page.goto("/onboarding");
    await expect(page).toHaveURL(/\/signin$/);
    for (const path of ["/", "/privacy", "/terms", "/signin", "/proof", "/limits"]) expect((await page.request.get(path)).status(), path).toBe(200);
    const res = await page.request.get("/api/workspace");
    expect(res.status()).toBe(401);
    expect(await res.json()).toEqual({ error: "Sign in to continue.", code: "unauthenticated" });
    expect((await page.request.get("/api/status")).status()).toBe(200);
    expect((await page.request.get("/api/proof")).status()).toBe(200);
    expect((await page.request.post("/api/connectors/square/webhook", { data: {} })).status()).not.toBe(401);
  });

  test("the landing links read the session once and send a signed-out visitor to /signin", async ({ page }) => {
    let calls = 0;
    page.on("request", (r) => { if (r.url().endsWith("/api/auth/me")) calls++; });
    await open(page, "/");
    await expect(page.getByTestId("site-open-app")).toHaveText("Sign in");
    await expect(page.getByTestId("site-open-app")).toHaveAttribute("href", "/signin");
    await expect(page.getByTestId("landing-open-app")).toHaveText("Try the sample chain");
    await page.waitForTimeout(500);
    expect(calls).toBe(1);
  });

  test("\"Try the sample chain\" makes a guest session that passes the same wall", async ({ page, context }) => {
    await open(page, "/");
    await page.getByTestId("landing-open-app").click();
    await expect(page).toHaveURL(/\/app$/);
    await expect(page.getByTestId("nav-portfolio")).toBeVisible();
    const cookies = await context.cookies();
    expect(cookies.find((c) => c.name === "le_sid")).toMatchObject({ httpOnly: true, sameSite: "Lax" });
    expect(((await (await page.request.get("/api/auth/me")).json()) as { session: string }).session).toBe("guest");
    await page.goto("/");
    await expect(page.getByTestId("site-open-app")).toHaveText("Back to the sample chain");
  });
});

test.describe("state 2: signed in", () => {
  test("the code flow: paste, resend, change email, wrong code, then in; links, skip-the-form and next", async ({ page }) => {
    const email = `ines.${unique()}@birchcoffee.example`;
    await open(page, "/signin?next=%2Fapp%2Fcompare");
    await expect(page.getByTestId("signin-code-flow")).toHaveAttribute("data-step", "email");
    await page.getByTestId("signin-email").fill("typo@birchcoffee.example");
    await page.getByTestId("signin-send-code").click();
    await expect(page.getByTestId("signin-sent-to")).toContainText("typo@birchcoffee.example");
    await expect(page.getByTestId("signin-resend")).toBeDisabled(); // the cooldown
    await page.getByTestId("signin-change-email").click();
    await expect(page.getByTestId("signin-code-flow")).toHaveAttribute("data-step", "email");

    await page.getByTestId("signin-email").fill(email);
    await page.getByTestId("signin-send-code").click();
    await expect(page.getByTestId("code-boxes")).toBeVisible();
    await expect(page.locator('[data-testid^="code-box-"]')).toHaveCount(6);
    await pasteCode(page, "000000"); // wrong, unless the dice are very unkind
    await expect(page.getByTestId("signin-error")).toHaveAttribute("data-code", /invalid_code|code_expired/);
    const code = (await (await page.request.get(`/api/auth/dev-outbox?email=${encodeURIComponent(email)}`)).json()).code as string;
    await pasteCode(page, code.slice(0, 3) + "-" + code.slice(3));
    // A brand-new address becomes an account and goes straight to onboarding (not to `next`).
    await expect(page).toHaveURL(/\/onboarding$/);
    await expect(page.getByTestId("account-email")).toHaveText(email);
    const me = (await (await page.request.get("/api/auth/me")).json()) as { session: string; user: { hasPassword: boolean }; onboardingComplete: boolean };
    expect(me).toMatchObject({ session: "user", user: { hasPassword: false }, onboardingComplete: false });

    // Links: signed in without finished onboarding -> "Finish setting up" -> /onboarding.
    await open(page, "/");
    await expect(page.getByTestId("site-open-app")).toHaveText("Finish setting up");
    await expect(page.getByTestId("site-open-app")).toHaveAttribute("href", "/onboarding");

    // /signin with a valid session skips the form: to `next` under /app, else /app, never off-site.
    await page.goto("/signin?next=%2Fapp%2Fcompare");
    await expect(page).toHaveURL(/\/app\/compare$/);
    await page.goto("/signin?next=https%3A%2F%2Fevil.example%2F");
    await expect(page).toHaveURL(/\/app$/);
    await page.goto("/signin");
    await expect(page).toHaveURL(/\/app$/);
    expect((await page.request.get("/api/workspace")).status()).toBe(200);

    // Signed out again: the wall is back.
    await page.getByTestId("account-signout").click();
    await expect(page).toHaveURL(/\/signin$/);
    await page.goto("/app");
    await expect(page).toHaveURL(/\/signin\?next=%2Fapp$/);
  });

  test("a code account deletes itself by typing its email address", async ({ page }) => {
    const email = `omar.${unique()}@birchcoffee.example`;
    await codeSignIn(page, email);
    await expect(page).toHaveURL(/\/onboarding$/);
    await page.getByTestId("account-delete").click();
    await page.getByTestId("account-delete-password").fill("someone@else.example");
    await page.getByTestId("account-delete-confirm").click();
    await expect(page.getByTestId("account-error")).toHaveAttribute("data-code", "invalid_credentials");
    await page.getByTestId("account-delete-password").fill(email);
    await page.getByTestId("account-delete-confirm").click();
    await expect(page).toHaveURL(/\/signin\?deleted=1$/);
  });
});

test.describe("state 3: an expired or forged cookie", () => {
  test("the app's client guard sends it to sign-in with next, and the API says 401", async ({ page, context }) => {
    await context.addCookies([{ name: "le_sid", value: "Q".repeat(43), url: ORIGIN, httpOnly: true, sameSite: "Lax" }]);
    expect((await page.request.get("/api/workspace")).status()).toBe(401); // the middleware lets the cookie through, the handler refuses it
    await page.goto("/app/compare"); // not redirected by the middleware: a cookie exists
    await expect(page).toHaveURL(/\/signin\?next=%2Fapp%2Fcompare$/, { timeout: 15_000 });
    await expect(page.getByTestId("signin-code-flow").or(page.getByTestId("signin-form"))).toBeVisible();
    expect(((await (await page.request.get("/api/auth/me")).json()) as { session: unknown }).session).toBeNull();
  });

  test("the landing links treat it as signed out", async ({ page, context }) => {
    await context.addCookies([{ name: "le_sid", value: "Z".repeat(43), url: ORIGIN, httpOnly: true, sameSite: "Lax" }]);
    await open(page, "/");
    await expect(page.getByTestId("site-open-app")).toHaveText("Sign in");
  });
});
