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
  await expect(page.getByRole("tree", { name: "Projects" })).toBeVisible();
  await expect(page.locator('[data-agent-surface="chat-input-bar"]').first()).toBeVisible();
  await page.screenshot({
    path: `test-artifacts/review-shots/${projectName}-desktop-projects-root.png`,
    fullPage: true,
  });

  await page.goto("/projects/proj-1/execution");
  await expect(page.getByText("Demo Project")).toBeVisible();
  await expect(page.getByRole("button", { name: "Plans" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Tasks" }).first()).toBeVisible();
  await page.screenshot({
    path: `test-artifacts/review-shots/${projectName}-desktop-project-execution.png`,
    fullPage: true,
  });

  await page.goto("/projects/proj-1/files");
  await expect(page.getByText("Files").first()).toBeVisible();
  await expect(page.getByRole("main").getByRole("textbox", { name: "Search" })).toBeVisible();
  await page.screenshot({
    path: `test-artifacts/review-shots/${projectName}-desktop-project-files.png`,
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
  await expect(page.getByRole("textbox", { name: "Search" })).toBeVisible();
  await page.screenshot({
    path: `test-artifacts/review-shots/${projectName}-desktop-process.png`,
    fullPage: true,
  });

  await page.goto("/tasks/proj-1/agents/agent-inst-1");
  await expect(page.getByText("Ready")).toBeVisible();
  await expect(page.getByRole("button", { name: /Builder Bot Patch auth flow/i })).toBeVisible();
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
  await expect(page.locator('[data-agent-surface="chat-input-bar"]').first()).toBeVisible();

  await page.getByTitle("New Agent").click();
  const createDialog = page.getByRole("dialog");
  await expect(createDialog.getByRole("heading", { name: "Create Agent" })).toBeVisible();
  await expect(createDialog.getByRole("button", { name: "Remote" })).toBeVisible();
  await expect(createDialog.getByRole("button", { name: "Local" })).toBeVisible();
  await expect(createDialog.getByRole("textbox", { name: "Personality" })).toBeVisible();
  await page.screenshot({
    path: `test-artifacts/review-shots/${projectName}-desktop-agent-create.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "Cancel" }).click();

  await page.goto("/projects/proj-1/agents/agent-inst-1");
  await expect(page.locator('[data-agent-surface="chat-input-bar"]').first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Plans" })).toBeVisible();
  await page.screenshot({
    path: `test-artifacts/review-shots/${projectName}-desktop-project-agent-chat.png`,
    fullPage: true,
  });

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

test("project agent mentions stay visible and send exact bindings", async ({ page }, testInfo) => {
  mkdirSync("test-artifacts/review-shots", { recursive: true });
  const baseAgent = {
    project_id: "proj-1",
    personality: "Helpful",
    system_prompt: "Help with the project.",
    skills: [],
    icon: null,
    machine_type: "remote",
    environment: "cloud",
    auth_source: "aura_managed",
    adapter_type: "aura_harness",
    workspace_path: "/tmp/demo-project",
    status: "idle",
    current_task_id: null,
    current_session_id: null,
    instance_role: "chat",
    source: "ui",
    total_input_tokens: 0,
    total_output_tokens: 0,
    created_at: "2026-03-17T01:00:00.000Z",
    updated_at: "2026-03-17T01:00:00.000Z",
  };
  await mockAuthenticatedApp(page, {
    agentInstances: [
      {
        ...baseAgent,
        agent_instance_id: "agent-inst-1",
        agent_id: "agent-1",
        name: "Builder Bot",
        role: "Engineer",
      },
      {
        ...baseAgent,
        agent_instance_id: "agent-inst-2",
        agent_id: "agent-2",
        name: "Maya",
        role: "Product designer",
      },
    ],
  });

  await page.route("**/api/projects/proj-1/sessions", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });

  let sentBody: Record<string, unknown> | null = null;
  await page.route(
    "**/api/projects/proj-1/agents/agent-inst-1/events/stream",
    async (route) => {
      sentBody = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: "event: done\ndata: {}\n\n",
      });
    },
  );

  await page.goto("/projects/proj-1/agents/agent-inst-1");
  const input = page.locator('[data-agent-field="chat-input"]');
  await expect(input).toBeVisible();
  await expect(page.getByRole("button", { name: /Maya Archive Maya/i })).toBeVisible();
  await input.pressSequentially("Please ask @ma");
  await expect(page.getByText("Project agents")).toBeVisible();
  await expect(page.getByRole("button", { name: /Maya Product designer/i })).toBeVisible();

  const projectName = testInfo.project.name.replace(/\s+/g, "-");
  await page.screenshot({
    path: `test-artifacts/review-shots/${projectName}-project-agent-mention-menu.png`,
    fullPage: true,
  });

  await page.getByRole("button", { name: /Maya Product designer/i }).click();
  await expect(page.getByLabel("Agents included in this message")).toContainText("Maya");
  await expect(input).toHaveValue("Please ask @Maya ");
  await page.screenshot({
    path: `test-artifacts/review-shots/${projectName}-project-agent-mention-chip.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "Send" }).click();
  await expect.poll(() => sentBody).not.toBeNull();
  expect(sentBody?.agent_mentions).toEqual([
    { agent_id: "agent-2", agent_instance_id: "agent-inst-2" },
  ]);
});
