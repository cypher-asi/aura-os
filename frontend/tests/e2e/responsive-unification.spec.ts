import { expect, test } from "@playwright/test";
import { mockAuthenticatedApp } from "./helpers/mockAuthenticatedApp";

test.use({ serviceWorkers: "block" });

function formFactor(projectName: string): "desktop" | "tablet" | "phone" {
  if (projectName.startsWith("desktop")) return "desktop";
  if (projectName.startsWith("tablet")) return "tablet";
  return "phone";
}

async function expectResponsiveNavigation(page: import("@playwright/test").Page, factor: "desktop" | "tablet" | "phone") {
  if (factor === "desktop") {
    await expect(page.getByRole("button", { name: "Open navigation" })).toHaveCount(0);
  } else {
    await expect(page.getByRole("button", { name: "Open navigation" })).toBeVisible();
  }
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

  await expectResponsiveNavigation(page, factor);

  if (factor === "desktop") {
    await expect(page.getByPlaceholder("Search Projects...")).toBeVisible();
  }
});

test("projects root does not auto-redirect from remembered agent state", async ({ page }, testInfo) => {
  const factor = formFactor(testInfo.project.name);

  await mockAuthenticatedApp(page);
  await page.addInitScript(() => {
    localStorage.setItem("aura:lastAgent", JSON.stringify({
      projectId: "proj-1",
      agentInstanceId: "agent-inst-1",
    }));
  });
  await page.goto("/projects");

  await expect(page).toHaveURL(/\/projects$/);
  await expect(page.getByText("Welcome to AURA")).toBeVisible();

  await expectResponsiveNavigation(page, factor);
});

test("feed reuses sidebar selectors across form factors", async ({ page }, testInfo) => {
  const factor = formFactor(testInfo.project.name);

  await mockAuthenticatedApp(page);

  await page.goto("/feed");
  await expect(page.getByRole("treeitem", { name: "My Agents" })).toBeVisible();
  await expect(page.getByRole("treeitem", { name: "Organization" })).toBeVisible();
  await expectResponsiveNavigation(page, factor);
});

test("leaderboard reuses sidebar selectors across form factors", async ({ page }, testInfo) => {
  const factor = formFactor(testInfo.project.name);

  await mockAuthenticatedApp(page);

  await page.goto("/leaderboard");
  await expect(page.getByRole("treeitem", { name: "My Agents" })).toBeVisible();
  await expect(page.getByRole("treeitem", { name: "Following" })).toBeVisible();
  await expectResponsiveNavigation(page, factor);
});

test("profile reuses sidebar selectors across form factors", async ({ page }, testInfo) => {
  const factor = formFactor(testInfo.project.name);

  await mockAuthenticatedApp(page);

  await page.goto("/profile");
  await expect(page.getByRole("treeitem", { name: "All" })).toBeVisible();
  await expect(page.getByRole("treeitem", { name: "aura-code" })).toBeVisible();
  await expectResponsiveNavigation(page, factor);
});

test("projects execution uses shared project navigation with capability-driven details access", async ({ page }, testInfo) => {
  const factor = formFactor(testInfo.project.name);

  await mockAuthenticatedApp(page);
  await page.goto("/projects/proj-1/execution");

  await expect(page.getByText("Demo Project")).toBeVisible({ timeout: 10000 });
  await expect(page.getByRole("treeitem", { name: "Execution" })).toBeVisible({ timeout: 10000 });
  await expect(page.locator("main").getByRole("button", { name: "Start" }).first()).toBeVisible({ timeout: 10000 });

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

  if (factor === "desktop") {
    await expect(page.getByRole("treeitem", { name: "Builder Bot" })).toBeVisible();
    await expect(page.getByRole("treeitem", { name: "Research Bot" })).toBeVisible();
    await expect(page.getByPlaceholder("Search Agents...")).toBeVisible();
    await expect(page.getByRole("button", { name: "Open navigation" })).toHaveCount(0);
  } else {
    await expect(page.getByRole("button", { name: "Open navigation" })).toBeVisible();
    await page.getByRole("button", { name: "Open navigation" }).click();
    await expect(page.getByRole("treeitem", { name: "Builder Bot" }).first()).toBeVisible();
    await expect(page.getByRole("treeitem", { name: "Research Bot" }).first()).toBeVisible();
  }
});

test("collapsing the active project exits nested project content", async ({ page }, testInfo) => {
  const factor = formFactor(testInfo.project.name);
  test.skip(factor === "desktop", "Desktop has multiple collapse controls on screen; this regression targets responsive navigation state.");

  await mockAuthenticatedApp(page);
  await page.goto("/projects/proj-1/execution");

  await expect(page.getByRole("treeitem", { name: "Execution" })).toBeVisible({ timeout: 10000 });
  await page.locator('[role="tree"]').first().locator('[role="button"][aria-label="Collapse"]').dispatchEvent("click");

  await expect(page).toHaveURL(/\/projects$/);
  await expect(page.getByText("Welcome to AURA")).toBeVisible();

  if (factor !== "desktop") {
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

test("modal flows lock the background document across form factors", async ({ page }) => {
  await mockAuthenticatedApp(page);
  await page.goto("/projects");

  await page.getByRole("button", { name: "Open host settings" }).click();

  await expect(page.getByRole("heading", { name: "Host Connection" })).toBeVisible();
  await expect.poll(async () => {
    return page.evaluate(() => {
      const bodyOverflow = window.getComputedStyle(document.body).overflow;
      const htmlOverflow = window.getComputedStyle(document.documentElement).overflow;
      return bodyOverflow === "hidden" || htmlOverflow === "hidden";
    });
  }).toBe(true);
});
