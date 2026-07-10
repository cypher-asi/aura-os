import { expect, test } from "@playwright/test";
import { mockAuthenticatedApp } from "./helpers/mockAuthenticatedApp";

test.use({ serviceWorkers: "block" });

test("team settings integrations entry opens the Integrations app", async ({ page }, testInfo) => {
  await mockAuthenticatedApp(page, {
    integrations: [
      {
        integration_id: "int-1",
        org_id: "org-1",
        name: "Anthropic Prod",
        provider: "anthropic",
        kind: "workspace_connection",
        default_model: "claude-sonnet-4-5",
        has_secret: true,
        secret_last4: "ngAA",
        created_at: "2026-03-17T01:00:00.000Z",
        updated_at: "2026-03-17T01:00:00.000Z",
      },
      {
        integration_id: "int-2",
        org_id: "org-1",
        name: "GitHub Ops",
        provider: "github",
        kind: "workspace_integration",
        default_model: null,
        has_secret: true,
        secret_last4: "hub7",
        created_at: "2026-03-17T01:00:00.000Z",
        updated_at: "2026-03-17T01:00:00.000Z",
      },
    ],
  });

  await page.goto("/projects");
  await page.getByRole("button", { name: "Switch team" }).click();
  const teamSwitcher = page.locator("body > div").last();
  await expect(teamSwitcher.getByRole("button", { name: "Team Settings" })).toBeVisible();
  await teamSwitcher.getByRole("button", { name: "Team Settings" }).click();

  const dialog = page.getByRole("dialog").filter({ hasText: "Team Settings" });
  await expect(dialog).toBeVisible();

  await dialog.getByRole("button", { name: "Integrations" }).click();

  await expect(page).toHaveURL(/\/integrations$/);
  await expect(page.getByRole("dialog").filter({ hasText: "Team Settings" })).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Search integrations" })).toBeVisible();
  await expect(page.getByRole("button", { name: "GitHub (connected)" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Google" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Brave Search (BYOK)" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Custom MCP Server" })).toBeVisible();

  await page.getByRole("button", { name: "Brave Search (BYOK)" }).click();
  await expect(page.getByRole("heading", { name: "Brave Search (BYOK)" })).toBeVisible();
  await expect(
    page.getByText("Aura Web Search works without setup and uses your plan's quota"),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("brave-search-byok.png"),
    fullPage: true,
  });

  await page.getByRole("button", { name: "GitHub (connected)" }).click();
  await expect(page.getByRole("heading", { name: "GitHub" })).toBeVisible();
  await expect(page.getByText("GitHub Ops")).toBeVisible();
  await expect(page.getByLabel("Integration name for GitHub")).toBeVisible();
  await expect(page.getByLabel("GitHub Token for GitHub")).toBeVisible();
});

test("billing tiers show Aura Web Search quotas", async ({ page }, testInfo) => {
  await mockAuthenticatedApp(page);
  await page.goto("/projects");

  await page.getByRole("button", { name: "Switch team" }).click();
  const teamSwitcher = page.locator("body > div").last();
  await teamSwitcher.getByRole("button", { name: "Team Settings" }).click();

  const settingsDialog = page.getByRole("dialog").filter({ hasText: "Team Settings" });
  await settingsDialog.getByRole("button", { name: "Billing" }).click();
  await settingsDialog.getByRole("button", { name: "Change Plan" }).click();

  const tierDialog = page.getByRole("dialog").filter({ hasText: "CHOOSE YOUR PLAN" });
  const webSearchRows = tierDialog
    .getByText("Aura Web Search", { exact: true })
    .locator("..");
  await expect(webSearchRows).toHaveCount(4);
  for (const [index, allowance] of [
    "5/min · 50/day",
    "15/min · 250/day",
    "30/min · 1,000/day",
    "60/min · 5,000/day",
  ].entries()) {
    await expect(webSearchRows.nth(index).getByText(allowance, { exact: true })).toBeVisible();
  }

  await page.screenshot({
    path: testInfo.outputPath("web-search-tier-allowances.png"),
    fullPage: true,
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);
  const sageQuota = tierDialog.getByText("60/min · 5,000/day", { exact: true });
  await sageQuota.scrollIntoViewIfNeeded();
  await expect(sageQuota).toBeInViewport();
  await page.screenshot({
    path: testInfo.outputPath("web-search-tier-allowances-mobile.png"),
    fullPage: true,
  });
});
