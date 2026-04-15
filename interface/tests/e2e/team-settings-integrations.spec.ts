import { expect, test } from "@playwright/test";
import { mockAuthenticatedApp } from "./helpers/mockAuthenticatedApp";

test.use({ serviceWorkers: "block" });

test("team settings integrations show clear sections and labeled fields", async ({ page }) => {
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

  await expect(dialog.getByRole("heading", { name: "Integrations" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Add Integration" })).toBeVisible();
  await expect(dialog.getByText("Connections").first()).toBeVisible();
  await expect(dialog.getByText("Apps").first()).toBeVisible();
  await expect(dialog.getByText("MCP Servers").first()).toBeVisible();

  await expect(dialog.getByText("Anthropic Prod")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Edit" }).first()).toBeVisible();

  await expect(dialog.getByText("GitHub Ops")).toBeVisible();
  await dialog.getByRole("button", { name: "Add Integration" }).click();
  await expect(dialog.getByText("New Integration")).toBeVisible();
  await expect(dialog.getByText("Apps").first()).toBeVisible();
  await expect(dialog.getByRole("button", { name: "GitHub" }).first()).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Custom MCP Server" })).toBeVisible();

  await dialog.getByRole("button", { name: "GitHub" }).first().click();
  await expect(dialog.getByLabel("New integration name")).toBeVisible();
  await expect(dialog.getByLabel("New GitHub Token")).toBeVisible();
  await expect(dialog.getByLabel("New preferred model")).toHaveCount(0);

  await dialog.getByRole("button", { name: "Edit" }).first().click();
  await expect(dialog.getByLabel("Integration name for Anthropic Prod")).toBeVisible();
  await expect(dialog.getByLabel("Anthropic API Key for Anthropic Prod")).toBeVisible();
  await dialog.getByText("Advanced").click();
  await expect(dialog.getByLabel("Preferred model for Anthropic Prod")).toBeVisible();
});
