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
  await expect(page.getByRole("button", { name: "Tasks" })).toBeVisible();
  await page.screenshot({
    path: `test-artifacts/review-shots/${projectName}-desktop-project-execution.png`,
    fullPage: true,
  });
});

test("capture desktop agents, feed, and profile views", async ({ page }, testInfo) => {
  mkdirSync("test-artifacts/review-shots", { recursive: true });

  await mockAuthenticatedApp(page);
  const projectName = testInfo.project.name.replace(/\s+/g, "-");

  await page.goto("/agents/agent-1");
  await expect(page.getByPlaceholder("Search Agents...")).toBeVisible();
  await page.screenshot({
    path: `test-artifacts/review-shots/${projectName}-desktop-agents.png`,
    fullPage: true,
  });

  await page.goto("/feed");
  await expect(page.getByRole("treeitem", { name: "My Agents" })).toBeVisible();
  await page.screenshot({
    path: `test-artifacts/review-shots/${projectName}-desktop-feed.png`,
    fullPage: true,
  });

  await page.goto("/profile");
  await expect(page.getByRole("treeitem", { name: "All" })).toBeVisible();
  await page.screenshot({
    path: `test-artifacts/review-shots/${projectName}-desktop-profile.png`,
    fullPage: true,
  });
});
