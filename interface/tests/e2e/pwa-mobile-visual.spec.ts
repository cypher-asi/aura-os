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

const tasks = [
  {
    task_id: "task-1",
    project_id: "proj-1",
    spec_id: "spec-1",
    dependency_ids: [],
    parent_task_id: null,
    session_id: null,
    user_id: "user-1",
    assigned_agent_instance_id: "agent-inst-1",
    title: "Patch auth flow",
    description: "Verify mobile preview parity",
    status: "ready",
    execution_notes: "",
    files_changed: [{ op: "modify", path: "src/auth.ts" }],
    build_steps: [],
    test_steps: [],
    order_index: 0,
    total_input_tokens: 0,
    total_output_tokens: 0,
    model: null,
    live_output: "",
    created_at: "2026-03-17T01:00:00.000Z",
    updated_at: "2026-03-17T01:00:00.000Z",
  },
];

const specs = [
  {
    spec_id: "spec-1",
    project_id: "proj-1",
    title: "Mobile parity spec",
    markdown_contents: "# Mobile parity",
    order_index: 0,
    created_at: "2026-03-17T01:00:00.000Z",
    updated_at: "2026-03-17T01:00:00.000Z",
  },
];

async function mockMobileVisualApp(page: import("@playwright/test").Page) {
  await mockAuthenticatedApp(page, {
    project: {
      project_id: "proj-1",
      org_id: "org-1",
      name: "Project Atlas",
      description: "Parity test project",
      current_status: "active",
      created_at: "2026-03-17T01:00:00.000Z",
      updated_at: "2026-03-17T01:00:00.000Z",
    },
    projects: [
      {
        project_id: "proj-1",
        org_id: "org-1",
        name: "Project Atlas",
        description: "Parity test project",
        current_status: "active",
        created_at: "2026-03-17T01:00:00.000Z",
        updated_at: "2026-03-17T02:00:00.000Z",
      },
      {
        project_id: "proj-2",
        org_id: "org-1",
        name: "Design System",
        description: "Tokens and shell polish",
        current_status: "active",
        created_at: "2026-03-16T01:00:00.000Z",
        updated_at: "2026-03-17T01:30:00.000Z",
      },
      {
        project_id: "proj-3",
        org_id: "org-1",
        name: "Docs Refresh",
        description: "Welcome and onboarding flows",
        current_status: "active",
        created_at: "2026-03-15T01:00:00.000Z",
        updated_at: "2026-03-17T01:15:00.000Z",
      },
      {
        project_id: "proj-4",
        org_id: "org-1",
        name: "Orbit QA",
        description: "Repo and collaboration checks",
        current_status: "active",
        created_at: "2026-03-14T01:00:00.000Z",
        updated_at: "2026-03-16T23:00:00.000Z",
      },
    ],
    agentInstances: [
      {
        agent_instance_id: "agent-inst-1",
        project_id: "proj-1",
        agent_id: "agent-1",
        name: "Builder Bot",
        role: "Engineer",
        personality: "Helpful",
        system_prompt: "Build features carefully.",
        skills: [],
        icon: null,
        machine_type: "remote",
        workspace_path: "/home/aura/project-atlas",
        status: "idle",
        current_task_id: null,
        current_session_id: null,
        total_input_tokens: 0,
        total_output_tokens: 0,
        created_at: "2026-03-17T01:00:00.000Z",
        updated_at: "2026-03-17T01:00:00.000Z",
      },
    ],
    tasks,
    specs,
  });
}

test("capture mobile login screen", async ({ page, browserName }, testInfo) => {
  mkdirSync("test-artifacts", { recursive: true });

  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "AURA" })).toBeVisible();

  const projectName = testInfo.project.name.replace(/\s+/g, "-");
  const path = `test-artifacts/${projectName}-${browserName}-login.png`;
  await page.screenshot({ path, fullPage: true });
});

test("capture mobile root and project drawer", async ({ page, browserName }, testInfo) => {
  mkdirSync("test-artifacts/review-shots", { recursive: true });

  await mockMobileVisualApp(page);
  const projectName = testInfo.project.name.replace(/\s+/g, "-");

  await page.goto("/projects");
  await expect(page).toHaveURL(/\/projects\/proj-1\/agents\/agent-inst-1$/);
  await expect(page.getByPlaceholder("Add a follow-up")).toBeVisible({ timeout: 10000 });
  await page.screenshot({
    path: `test-artifacts/review-shots/${projectName}-${browserName}-projects-root-mobile-ia.png`,
    fullPage: true,
  });

  await page.getByRole("button", { name: /Open project navigation/i }).click();
  await expect(page.getByPlaceholder("Search Projects...")).toBeVisible({ timeout: 10000 });
  await page.screenshot({
    path: `test-artifacts/review-shots/${projectName}-${browserName}-projects-drawer-mobile-ia.png`,
    fullPage: true,
  });

  await page.getByRole("button", { name: "Close drawer" }).dispatchEvent("click");
  await page.getByRole("button", { name: "Open apps" }).click();
  await expect(page.getByRole("button", { name: "Projects" })).toBeVisible({ timeout: 10000 });
  await page.screenshot({
    path: `test-artifacts/review-shots/${projectName}-${browserName}-global-switcher-mobile-ia.png`,
    fullPage: true,
  });

  await page.getByRole("button", { name: "Agent library" }).click();
  await expect(page).toHaveURL(/\/agents$/);
  await expect(page.getByText("Builder Bot")).toBeVisible({ timeout: 10000 });
  await page.screenshot({
    path: `test-artifacts/review-shots/${projectName}-${browserName}-agent-library-root-mobile-ia.png`,
    fullPage: true,
  });

  await page.getByRole("button", { name: /Builder Bot/i }).click();
  await expect(page).toHaveURL(/\/agents\/agent-1$/);
  await expect(page.getByText("System Prompt")).toBeVisible({ timeout: 10000 });
  await page.screenshot({
    path: `test-artifacts/review-shots/${projectName}-${browserName}-agent-library-details-mobile-ia.png`,
    fullPage: true,
  });
});

test("capture mobile work, files, and account sheet", async ({ page, browserName }, testInfo) => {
  mkdirSync("test-artifacts/review-shots", { recursive: true });

  await mockMobileVisualApp(page);
  const projectName = testInfo.project.name.replace(/\s+/g, "-");

  await page.goto("/projects/proj-1/work");
  await expect(page.getByRole("main").getByText("Execution", { exact: true })).toBeVisible({ timeout: 15000 });
  await page.screenshot({
    path: `test-artifacts/review-shots/${projectName}-${browserName}-project-work-mobile-ia.png`,
    fullPage: true,
  });

  const statsTab = page.getByRole("navigation", { name: "Primary mobile navigation" }).getByRole("button", { name: "Stats" });
  await expect(statsTab).toBeVisible({ timeout: 10000 });
  await page.screenshot({
    path: `test-artifacts/review-shots/${projectName}-${browserName}-project-work-stats-collapsed-mobile-ia.png`,
    fullPage: true,
  });

  await statsTab.click();
  await expect(page).toHaveURL(/\/projects\/proj-1\/stats$/);
  await expect(page.getByText("Completion")).toBeVisible({ timeout: 10000 });
  await expect(page.getByText("Tokens")).toBeVisible({ timeout: 10000 });
  await page.screenshot({
    path: `test-artifacts/review-shots/${projectName}-${browserName}-project-work-stats-expanded-mobile-ia.png`,
    fullPage: true,
  });

  await page.goto("/projects/proj-1/files");
  await expect(page).toHaveURL(/\/projects\/proj-1\/files$/);
  await expect(page.getByText("Files stay on the remote agent")).toBeVisible({ timeout: 15000 });
  await expect(page.getByText("Agent workspace", { exact: true })).toBeVisible({ timeout: 10000 });
  await expect(page.getByRole("button", { name: "Open Agent" })).toBeVisible({ timeout: 10000 });
  await expect(page.getByRole("button", { name: "Open Execution" })).toBeVisible({ timeout: 10000 });
  await expect(page.getByRole("button", { name: "Open Stats" })).toBeVisible({ timeout: 10000 });
  await page.screenshot({
    path: `test-artifacts/review-shots/${projectName}-${browserName}-project-files-mobile-ia.png`,
    fullPage: true,
  });

  await page.goto("/projects/proj-1/agents/agent-inst-1");
  await expect(page).toHaveURL(/\/projects\/proj-1\/agents\/agent-inst-1$/);
  await page.getByRole("button", { name: "Open account" }).click();
  await expect(page.getByRole("button", { name: "Team settings" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Host settings" })).toBeVisible();
  await expect(page.getByRole("button", { name: "App settings" })).toBeVisible();
  await page.screenshot({
    path: `test-artifacts/review-shots/${projectName}-${browserName}-account-sheet-mobile-ia.png`,
    fullPage: true,
  });
});

test("capture mobile profile and comments sheet", async ({ page, browserName }, testInfo) => {
  mkdirSync("test-artifacts/review-shots", { recursive: true });

  await mockMobileVisualApp(page);
  const projectName = testInfo.project.name.replace(/\s+/g, "-");

  await page.goto("/profile");
  await expect(page.getByRole("button", { name: "All activity" })).toBeVisible({ timeout: 10000 });
  await expect(page.getByText("Shared summary components now power desktop and mobile profile surfaces.")).toBeVisible({ timeout: 10000 });
  await page.screenshot({
    path: `test-artifacts/review-shots/${projectName}-${browserName}-profile-mobile-ia.png`,
    fullPage: true,
  });

  await page.getByText("Shared summary components now power desktop and mobile profile surfaces.").click();
  await expect(page.getByRole("textbox", { name: "Comment" })).toBeVisible({ timeout: 10000 });
  await page.screenshot({
    path: `test-artifacts/review-shots/${projectName}-${browserName}-profile-comments-mobile-ia.png`,
    fullPage: true,
  });
});
