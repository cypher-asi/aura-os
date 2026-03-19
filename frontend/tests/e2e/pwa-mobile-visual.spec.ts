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

test("capture mobile login screen", async ({ page, browserName }, testInfo) => {
  mkdirSync("test-artifacts", { recursive: true });

  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "AURA" })).toBeVisible();

  const projectName = testInfo.project.name.replace(/\s+/g, "-");
  const path = `test-artifacts/${projectName}-${browserName}-login.png`;
  await page.screenshot({ path, fullPage: true });
});

test("capture mobile projects polish screens", async ({ page, browserName }, testInfo) => {
  mkdirSync("test-artifacts/review-shots", { recursive: true });

  await mockAuthenticatedApp(page);

  const projectName = testInfo.project.name.replace(/\s+/g, "-");

  await page.goto("/projects");
  await expect(page.getByText("Welcome to AURA")).toBeVisible();
  await page.screenshot({
    path: `test-artifacts/review-shots/${projectName}-${browserName}-projects-root-polished.png`,
    fullPage: true,
  });

  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(page.getByPlaceholder("Search Projects...")).toBeVisible({ timeout: 10000 });
  await page.screenshot({
    path: `test-artifacts/review-shots/${projectName}-${browserName}-projects-drawer-polished.png`,
    fullPage: true,
  });
});

test("capture mobile agents polish screen", async ({ page, browserName }, testInfo) => {
  mkdirSync("test-artifacts/review-shots", { recursive: true });

  await mockAuthenticatedApp(page);

  const projectName = testInfo.project.name.replace(/\s+/g, "-");

  await page.goto("/agents/agent-1");
  await expect(page.getByText("Chat with Builder Bot")).toBeVisible();
  await page.screenshot({
    path: `test-artifacts/review-shots/${projectName}-${browserName}-agents-polished.png`,
    fullPage: true,
  });
});
