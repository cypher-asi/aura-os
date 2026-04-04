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
        default_model: "claude-sonnet-4-5",
        has_secret: true,
        secret_last4: "ngAA",
        created_at: "2026-03-17T01:00:00.000Z",
        updated_at: "2026-03-17T01:00:00.000Z",
      },
    ],
  });

  await page.goto("/projects");
  await page.getByRole("button", { name: "Switch team" }).click();
  await page.getByRole("button", { name: "Team Settings" }).click();

  const dialog = page.getByRole("dialog").filter({ hasText: "Team Settings" });
  await expect(dialog).toBeVisible();

  await dialog.getByRole("button", { name: "Integrations" }).click();

  await expect(dialog.getByRole("heading", { name: "Integrations" })).toBeVisible();
  await expect(dialog.getByText("Create New Integration")).toBeVisible();
  await expect(dialog.getByText("Saved Integrations")).toBeVisible();

  await expect(dialog.getByText("Integration Name").first()).toBeVisible();
  await expect(dialog.getByText("Provider").first()).toBeVisible();
  await expect(dialog.getByText("Default Model").first()).toBeVisible();
  await expect(dialog.getByText("API Key").first()).toBeVisible();

  await expect(dialog.getByLabel("New integration name")).toBeVisible();
  await expect(dialog.getByLabel("New default model")).toBeVisible();
  await expect(dialog.getByLabel("New API key")).toBeVisible();

  await expect(dialog.getByText("Anthropic Prod")).toBeVisible();
  await expect(dialog.getByLabel("Integration name for Anthropic Prod")).toBeVisible();
  await expect(dialog.getByLabel("Default model for Anthropic Prod")).toBeVisible();
  await expect(dialog.getByLabel("API key for Anthropic Prod")).toBeVisible();
});
