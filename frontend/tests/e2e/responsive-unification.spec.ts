import { expect, test } from "@playwright/test";
import { mockAuthenticatedApp } from "./helpers/mockAuthenticatedApp";

function formFactor(projectName: string): "desktop" | "tablet" | "phone" {
  if (projectName.startsWith("desktop")) return "desktop";
  if (projectName.startsWith("tablet")) return "tablet";
  return "phone";
}

test.beforeEach(async ({ page }) => {
  await page.route("**/api/auth/session", async (route) => {
    await route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ error: "Unauthorized", code: "unauthorized", details: null }),
    });
  });

  await page.route("**/api/auth/validate", async (route) => {
    await route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ error: "Unauthorized", code: "unauthorized", details: null }),
    });
  });
});

test("login keeps the same host targeting entry across form factors", async ({ page }) => {
  await page.goto("/login");

  await expect(page.getByRole("button", { name: "Change host" })).toBeVisible();
  await page.getByRole("button", { name: "Change host" }).click();
  await expect(page.getByRole("heading", { name: "Host Connection" })).toBeVisible();
});

test("projects root reuses the same welcome view across form factors", async ({ page }, testInfo) => {
  const factor = formFactor(testInfo.project.name);

  await mockAuthenticatedApp(page);
  await page.goto("/projects");

  await expect(page.getByText("Welcome to AURA")).toBeVisible();
  await expect(page.getByText("Select a project from navigation or create a new one to get started.")).toBeVisible();

  if (factor === "desktop") {
    await expect(page.getByRole("button", { name: "Open navigation" })).toHaveCount(0);
    await expect(page.getByPlaceholder("Search Projects...")).toBeVisible();
  } else {
    await expect(page.getByRole("button", { name: "Open navigation" })).toBeVisible();
  }
});

test("feed, leaderboard, and profile reuse sidebar selectors across form factors", async ({ page }, testInfo) => {
  const factor = formFactor(testInfo.project.name);

  await mockAuthenticatedApp(page);

  await page.goto("/feed");
  await expect(page.getByRole("treeitem", { name: "My Agents" })).toBeVisible();
  await expect(page.getByRole("treeitem", { name: "Organization" })).toBeVisible();

  await page.goto("/leaderboard");
  await expect(page.getByRole("treeitem", { name: "My Agents" })).toBeVisible();
  await expect(page.getByRole("treeitem", { name: "Following" })).toBeVisible();

  await page.goto("/profile");
  await expect(page.getByRole("treeitem", { name: "All" })).toBeVisible();
  await expect(page.getByRole("treeitem", { name: "aura-code" })).toBeVisible();

  if (factor === "desktop") {
    await expect(page.getByRole("button", { name: "Open navigation" })).toHaveCount(0);
  } else {
    await expect(page.getByRole("button", { name: "Open navigation" })).toBeVisible();
  }
});

test("projects execution uses shared project navigation with capability-driven details access", async ({ page }, testInfo) => {
  const factor = formFactor(testInfo.project.name);

  await mockAuthenticatedApp(page);
  await page.goto("/projects/proj-1/execution");

  await expect(page.getByText("Demo Project")).toBeVisible();
  await expect(page.getByRole("treeitem", { name: "Execution" })).toBeVisible();

  if (factor === "desktop") {
    await expect(page.getByRole("button", { name: "Open navigation" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Tasks" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Open details" })).toHaveCount(0);
  } else {
    await expect(page.getByRole("treeitem", { name: "Builder Bot" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Open details" })).toBeVisible();
  }
});

test("agents route keeps shared content with responsive navigation affordances", async ({ page }, testInfo) => {
  const factor = formFactor(testInfo.project.name);

  await mockAuthenticatedApp(page);
  await page.goto("/agents/agent-1");

  await expect(page.getByText("Chat with Builder Bot")).toBeVisible();
  await expect(page.getByRole("treeitem", { name: "Builder Bot" })).toBeVisible();
  await expect(page.getByRole("treeitem", { name: "Research Bot" })).toBeVisible();

  if (factor === "desktop") {
    await expect(page.getByPlaceholder("Search Agents...")).toBeVisible();
    await expect(page.getByRole("button", { name: "Open navigation" })).toHaveCount(0);
  } else {
    await expect(page.getByRole("button", { name: "Open navigation" })).toBeVisible();
  }
});

test("navigation drawer remains settings access on smaller form factors only", async ({ page }, testInfo) => {
  const factor = formFactor(testInfo.project.name);

  test.skip(factor === "desktop", "Desktop keeps persistent navigation and settings controls.");

  await mockAuthenticatedApp(page);
  await page.goto("/projects/proj-1/execution");

  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(page.getByRole("button", { name: "Team settings" })).toBeVisible();
  await expect(page.getByRole("button", { name: "App settings" })).toBeVisible();
});

test("modal flows lock the background document across form factors", async ({ page }, testInfo) => {
  const factor = formFactor(testInfo.project.name);

  await mockAuthenticatedApp(page);
  await page.goto("/projects");

  if (factor !== "desktop") {
    await page.getByRole("button", { name: "Open navigation" }).click();
  }

  const newProjectButton = page.locator('button[title="New Project"]:visible');
  await expect(newProjectButton).toBeVisible();
  await newProjectButton.click();

  await expect(page.getByPlaceholder("Project name")).toBeVisible();
  await expect.poll(async () => page.evaluate(() => window.getComputedStyle(document.body).overflow)).toBe("hidden");
});
