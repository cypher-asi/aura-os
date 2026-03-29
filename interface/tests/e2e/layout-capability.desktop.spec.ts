import { expect, test } from "@playwright/test";
import { mockAuthenticatedApp } from "./helpers/mockAuthenticatedApp";

test("desktop browser login exposes host settings", async ({ page }) => {
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

  await page.goto("/login");

  await expect(page.getByRole("button", { name: "Change host" })).toBeVisible();
  await page.getByRole("button", { name: "Change host" }).click();
  await expect(page.getByRole("heading", { name: "Host Connection" })).toBeVisible();
});

test("desktop browser projects root keeps desktop welcome layout", async ({ page }) => {
  await mockAuthenticatedApp(page);

  await page.goto("/projects");

  await expect(page.getByText("Welcome to AURA")).toBeVisible();
  await expect(page.getByText("Pick up work without hunting through the app.")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Open navigation" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Open host settings" })).toBeVisible();
});

test("desktop browser project execution keeps desktop chrome and hides workspace-only files tab", async ({ page }) => {
  await mockAuthenticatedApp(page);

  await page.goto("/projects/proj-1/execution");

  await expect(page.getByText("Demo Project")).toBeVisible();
  await expect(page.getByRole("button", { name: "Chat" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Tasks" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Files" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Open navigation" })).toHaveCount(0);
});

test("desktop browser agents route keeps desktop layout without mobile switcher", async ({ page }) => {
  await mockAuthenticatedApp(page);

  await page.goto("/agents/agent-1");

  await expect(page.getByPlaceholder("Search Agents...")).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Choose agent" })).toHaveCount(0);
  await expect(page.getByText("Builder Bot")).toBeVisible();
  await expect(page.getByText("Helpful")).toBeVisible();
  await expect(page.getByPlaceholder("Add a follow-up")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Open navigation" })).toHaveCount(0);
});

test("desktop browser feed keeps desktop filter rail without mobile chip bar", async ({ page }) => {
  await mockAuthenticatedApp(page);

  await page.goto("/feed");

  await expect(page.getByRole("treeitem", { name: "My Agents" })).toBeVisible();
  await expect(page.getByRole("treeitem", { name: "Organization" })).toBeVisible();
  await expect(page.getByText("Feed scope")).toHaveCount(0);
});

test("desktop imported projects hide file browsing even with a desktop bridge", async ({ page }) => {
  await page.addInitScript(() => {
    (window as Window & { ipc?: { postMessage: (message: unknown) => void } }).ipc = {
      postMessage: () => {},
    };
  });

  await mockAuthenticatedApp(page, {
    project: {
      workspace_source: "imported",
      linked_folder_path: "",
    },
  });

  await page.goto("/projects/proj-1/execution");

  await expect(page.getByRole("button", { name: "Files" })).toHaveCount(0);
});
