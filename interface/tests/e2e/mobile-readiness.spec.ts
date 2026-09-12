import { expect, test } from "@playwright/test";
import { mockAuthenticatedApp } from "./helpers/mockAuthenticatedApp";

test.use({ serviceWorkers: "block" });
test.beforeEach(async ({ page }) => { await mockAuthenticatedApp(page); });
test.afterEach(async ({ page }, testInfo) => {
  await testInfo.attach("mobile-screen", { body: await page.screenshot(), contentType: "image/png" });
});

test("mobile navigation keeps all five tabs visible and exposes Process and Stats under More", async ({ page }) => {
  await page.goto("/projects/proj-1/agents");
  const nav = page.getByRole("navigation", { name: "Project sections" });
  await expect(nav.getByRole("button")).toHaveText(["Agents", "Files", "Tasks", "Run", "More"]);
  for (const button of await nav.getByRole("button").all()) await expect(button).toBeInViewport();
  await nav.getByRole("button", { name: "More", exact: true }).tap();
  const menu = page.getByRole("menu", { name: "More project sections" });
  await menu.getByRole("menuitem", { name: "Process" }).tap();
  await expect(page.getByText("Project automations")).toBeVisible();
  await expect(menu).toBeVisible();
  await menu.getByRole("menuitem", { name: "Stats" }).tap();
  await expect(page).toHaveURL(/\/stats$/);
  await nav.getByRole("button", { name: "Agents", exact: true }).tap();
  await expect(menu).toHaveCount(0);
  await nav.getByRole("button", { name: "More", exact: true }).tap();
  await page.goto("/projects/proj-1/files");
  await expect(menu).toHaveCount(0);
});

test.describe("tablet reporting a desktop user agent", () => {
  test.use({ viewport: { width: 1024, height: 768 }, hasTouch: true, isMobile: false,
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15" });
  test("can open the project create screen and create from the agent library", async ({ page }) => {
    await page.goto("/projects/proj-1/agents/create");
    await expect(page.getByLabel("Name", { exact: true })).toBeVisible();
    await expect(page).toHaveURL(/\/agents\/create$/);
    await page.goto("/agents");
    await page.getByRole("button", { name: "Create Remote Agent", exact: true }).click();
    await expect(page.getByLabel("Name", { exact: true })).toBeVisible();
  });
});

for (const native of [false, true]) {
  test(`${native ? "native" : "web"} billing preserves the intended purchase controls`, async ({ page }) => {
    if (native) await page.addInitScript(() => {
      Object.defineProperty(window, "Capacitor", { value: { isNativePlatform: () => true, getPlatform: () => "ios" }, configurable: true });
    });
    await page.goto("/projects/organization");
    await page.getByRole("button", { name: "Team settings", exact: true }).click();
    await page.getByRole("button", { name: "Billing", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Billing", exact: true })).toBeInViewport();
    await expect(page.getByText("Current Balance", { exact: true })).toBeVisible();
    if (native) {
      await expect(page.getByRole("button", { name: "Change Plan" })).toHaveCount(0);
      await expect(page.getByText("Credit purchases aren't available in the mobile app.")).toBeVisible();
      await page.getByRole("button", { name: "Rewards", exact: true }).click();
      await expect(page.getByRole("button", { name: "Upgrade", exact: true })).toHaveCount(0);
      await expect(page.getByText("Your Invite Code", { exact: true })).toBeVisible();
    } else {
      await page.getByRole("button", { name: "Change Plan" }).click();
      await expect(page.getByText("CHOOSE YOUR PLAN", { exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Upgrade", exact: true })).toHaveCount(3);
    }
  });
}

test("native chat hides browser dictation even when the WebView exposes the API", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "Capacitor", { value: { isNativePlatform: () => true, getPlatform: () => "ios" }, configurable: true });
    Object.defineProperty(window, "webkitSpeechRecognition", { value: class {}, configurable: true });
  });
  await page.goto("/projects/proj-1/agents/agent-inst-1");
  await expect(page.getByRole("textbox", { name: "Message agent" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start voice dictation" })).toHaveCount(0);
});
