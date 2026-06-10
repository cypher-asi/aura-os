import { expect, test } from "@playwright/test";
import { mockAuthenticatedApp } from "./helpers/mockAuthenticatedApp";

test.use({ serviceWorkers: "block" });

test("team settings integrations entry opens the Integrations app", async ({ page }) => {
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
  await expect(page.getByRole("button", { name: "Custom MCP Server" })).toBeVisible();

  await page.getByRole("button", { name: "GitHub (connected)" }).click();
  await expect(page.getByRole("heading", { name: "GitHub" })).toBeVisible();
  await expect(page.getByText("GitHub Ops")).toBeVisible();
  await expect(page.getByLabel("Integration name for GitHub")).toBeVisible();
  await expect(page.getByLabel("GitHub Token for GitHub")).toBeVisible();
});
