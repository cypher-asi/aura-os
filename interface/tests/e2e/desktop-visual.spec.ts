import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { mockAuthenticatedApp } from "./helpers/mockAuthenticatedApp";

test.use({ serviceWorkers: "block" });

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

test("capture desktop login and host settings", async ({ page }, testInfo) => {
  mkdirSync("test-artifacts/review-shots", { recursive: true });

  const projectName = testInfo.project.name.replace(/\s+/g, "-");

  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "AURA" })).toBeVisible();
  await page.screenshot({
    path: `test-artifacts/review-shots/${projectName}-desktop-login.png`,
    fullPage: true,
  });

  await page.getByRole("button", { name: "Change host" }).click();
  await expect(page.getByRole("heading", { name: "Host Connection" })).toBeVisible();
  await page.screenshot({
    path: `test-artifacts/review-shots/${projectName}-desktop-host-settings.png`,
    fullPage: true,
  });
});

test("capture desktop projects root and execution chrome", async ({ page }, testInfo) => {
  mkdirSync("test-artifacts/review-shots", { recursive: true });

  await mockAuthenticatedApp(page);
  const projectName = testInfo.project.name.replace(/\s+/g, "-");

  await page.goto("/projects");
  await expect(page.getByText("Welcome to AURA")).toBeVisible();
  await expect(page.getByRole("button", { name: "Open host settings" })).toBeVisible();
  await page.screenshot({
    path: `test-artifacts/review-shots/${projectName}-desktop-projects-root.png`,
    fullPage: true,
  });

  await page.goto("/projects/proj-1/execution");
  await expect(page.getByText("Demo Project")).toBeVisible();
  await expect(page.getByRole("main").getByText("Task Feed")).toBeVisible();
  await expect(page.getByRole("button", { name: "Specs" })).toBeVisible();
  await page.screenshot({
    path: `test-artifacts/review-shots/${projectName}-desktop-project-execution.png`,
    fullPage: true,
  });

  await page.getByRole("button", { name: "Stats" }).click();
  await expect(page.getByText("Completion")).toBeVisible();
  await expect(page.getByText("Tokens")).toBeVisible();
  await page.screenshot({
    path: `test-artifacts/review-shots/${projectName}-desktop-project-stats.png`,
    fullPage: true,
  });

  await page.goto("/process");
  await expect(page.getByRole("button", { name: "Nightly QA" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Search" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Run/i }).first()).toBeVisible();
  await page.screenshot({
    path: `test-artifacts/review-shots/${projectName}-desktop-process.png`,
    fullPage: true,
  });

  await page.goto("/tasks/proj-1/agents/agent-inst-1");
  await expect(page.getByText("Ready")).toBeVisible();
  await expect(page.getByText("Patch auth flow")).toBeVisible();
  await page.screenshot({
    path: `test-artifacts/review-shots/${projectName}-desktop-tasks.png`,
    fullPage: true,
  });
});

test("capture desktop agents, feed, and profile views", async ({ page }, testInfo) => {
  mkdirSync("test-artifacts/review-shots", { recursive: true });

  await mockAuthenticatedApp(page);
  const projectName = testInfo.project.name.replace(/\s+/g, "-");

  await page.goto("/agents/agent-1");
  await expect(page.getByRole("textbox", { name: "Search" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Research Bot/i })).toBeVisible();
  await page.screenshot({
    path: `test-artifacts/review-shots/${projectName}-desktop-agents.png`,
    fullPage: true,
  });

  await page.getByRole("button", { name: /Research Bot/i }).click();
  await expect(page).toHaveURL(/\/agents\/agent-2$/);
  await expect(page.getByPlaceholder("What do you want to create?")).toBeVisible();

  await page.getByTitle("New Agent").click();
  await expect(page.getByRole("heading", { name: "Create Agent" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Swarm/i })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Personality" })).toBeVisible();
  await page.screenshot({
    path: `test-artifacts/review-shots/${projectName}-desktop-agent-create.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "Cancel" }).click();

  await page.goto("/feed");
  await expect(page.getByRole("treeitem", { name: "My Agents" })).toBeVisible();
  await page.screenshot({
    path: `test-artifacts/review-shots/${projectName}-desktop-feed.png`,
    fullPage: true,
  });

  await page.goto("/profile");
  await expect(page.getByRole("treeitem", { name: "All" })).toBeVisible({ timeout: 10000 });
  await expect(page.getByText("Shared summary components now power desktop and mobile profile surfaces.")).toBeVisible({ timeout: 10000 });
  await page.screenshot({
    path: `test-artifacts/review-shots/${projectName}-desktop-profile.png`,
    fullPage: true,
  });

  await page.getByText("Shared summary components now power desktop and mobile profile surfaces.").click();
  await expect(page.getByRole("textbox", { name: "Comment" })).toBeVisible();
  await page.screenshot({
    path: `test-artifacts/review-shots/${projectName}-desktop-profile-comments.png`,
    fullPage: true,
  });
});
