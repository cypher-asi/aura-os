import { expect, test } from "@playwright/test";
import { mockAuthenticatedApp } from "./helpers/mockAuthenticatedApp";

test.use({ serviceWorkers: "block" });

function formFactor(projectName: string): "desktop" | "tablet" | "phone" {
  if (projectName.startsWith("desktop")) return "desktop";
  if (projectName.startsWith("tablet")) return "tablet";
  return "phone";
}

const projectWorkTasks = [
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

const projectWorkSpecs = [
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

async function mockProjectWorkApp(page: import("@playwright/test").Page) {
  await mockAuthenticatedApp(page, {
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
        status: "idle",
        current_task_id: null,
        current_session_id: null,
        total_input_tokens: 0,
        total_output_tokens: 0,
        created_at: "2026-03-17T01:00:00.000Z",
        updated_at: "2026-03-17T01:00:00.000Z",
      },
    ],
    tasks: projectWorkTasks,
    specs: projectWorkSpecs,
  });
}

async function expectGlobalMobileChrome(
  page: import("@playwright/test").Page,
  factor: "desktop" | "tablet" | "phone",
) {
  if (factor === "desktop") {
    await expect(page.getByRole("button", { name: /Open project navigation/i })).toHaveCount(0);
    return;
  }

  await expect(page.getByRole("button", { name: /Open project navigation/i })).toBeVisible();
  await expect(page.getByRole("button", { name: "Agent" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Tasks" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Files" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Feed" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Projects" })).toHaveCount(0);
}

async function tapPrimaryNav(
  page: import("@playwright/test").Page,
  label: "Agent" | "Tasks" | "Files" | "Feed",
) {
  await page
    .getByRole("navigation", { name: "Primary mobile navigation" })
    .getByRole("button", { name: label })
    .tap();
}

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

test("login keeps the same host targeting entry across form factors", async ({ page }) => {
  await page.goto("/login");

  await expect(page.getByRole("button", { name: "Change host" })).toBeVisible();
  await page.getByRole("button", { name: "Change host" }).click();
  await expect(page.getByRole("heading", { name: "Host Connection" })).toBeVisible();
});

test("projects root keeps the shared welcome view while mobile/tablet use project navigation chrome", async ({ page }, testInfo) => {
  const factor = formFactor(testInfo.project.name);

  await mockAuthenticatedApp(page);
  await page.goto("/projects");

  await expect(page.getByText("Welcome to AURA")).toBeVisible();
  await expect(page.getByText("Select a project from navigation or create a new one to get started.")).toBeVisible();

  if (factor === "desktop") {
    await expect(page.getByPlaceholder("Search Projects...")).toBeVisible();
  } else {
    await expect(page.getByRole("treeitem", { name: "Demo Project" })).toHaveCount(0);
    await expectGlobalMobileChrome(page, factor);
  }
});

test("projects root does not auto-redirect from remembered agent state", async ({ page }, testInfo) => {
  const factor = formFactor(testInfo.project.name);

  await mockAuthenticatedApp(page);
  await page.addInitScript(() => {
    localStorage.setItem("aura:lastAgent", JSON.stringify({
      projectId: "proj-1",
      agentInstanceId: "agent-inst-1",
    }));
  });
  await page.goto("/projects");

  await expect(page).toHaveURL(/\/projects$/);
  await expect(page.getByText("Welcome to AURA")).toBeVisible();

  await expectGlobalMobileChrome(page, factor);
});

test("feed keeps shared content while mobile/tablet use the four-tab primary navigation", async ({ page }, testInfo) => {
  const factor = formFactor(testInfo.project.name);

  await mockAuthenticatedApp(page);
  await page.goto("/feed");

  await expect(page.getByRole("treeitem", { name: "My Agents" })).toBeVisible();
  await expect(page.getByRole("treeitem", { name: "Organization" })).toBeVisible();
  await expectGlobalMobileChrome(page, factor);
});

test("leaderboard remains reachable directly with shared content across form factors", async ({ page }, testInfo) => {
  const factor = formFactor(testInfo.project.name);

  await mockAuthenticatedApp(page);
  await page.goto("/leaderboard");

  await expect(page.getByRole("treeitem", { name: "My Agents" })).toBeVisible();
  await expect(page.getByRole("treeitem", { name: "Following" })).toBeVisible();
  await expectGlobalMobileChrome(page, factor);
});

test("profile remains reachable directly with shared content across form factors", async ({ page }, testInfo) => {
  const factor = formFactor(testInfo.project.name);

  await mockAuthenticatedApp(page);
  await page.goto("/profile");

  await expect(page.getByRole("treeitem", { name: "All" })).toBeVisible();
  await expect(page.getByRole("treeitem", { name: "aura-code" })).toBeVisible();
  await expectGlobalMobileChrome(page, factor);
});

test("project work route uses the combined mobile work view while desktop keeps shared project chrome", async ({ page }, testInfo) => {
  const factor = formFactor(testInfo.project.name);

  await mockProjectWorkApp(page);
  await page.goto("/projects/proj-1/work");

  if (factor === "desktop") {
    await expect(page.getByText("Task Feed")).toBeVisible({ timeout: 10000 });
    await expect(page.getByPlaceholder("Search Projects...")).toBeVisible();
    await expect(page.getByRole("treeitem", { name: "Demo Project" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Specs" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Tasks" })).toBeVisible();
  } else {
    await expect(page.getByText("Execution", { exact: true })).toBeVisible({ timeout: 15000 });
    await expect(page.getByText("Specs")).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole("main").getByRole("button", { name: "Tasks" })).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole("treeitem", { name: "Demo Project" })).toHaveCount(0);
    await tapPrimaryNav(page, "Tasks");
    await expect(page).toHaveURL(/\/projects\/proj-1\/work$/);
    await expect(page.getByRole("button", { name: /Open project navigation for Demo Project/i })).toBeVisible();
  }
});

test("primary project destinations keep the title drawer instead of a back button on smaller form factors", async ({ page }, testInfo) => {
  const factor = formFactor(testInfo.project.name);
  test.skip(factor === "desktop", "Desktop keeps the persistent sidebar model.");

  await mockProjectWorkApp(page);
  await page.goto("/projects/proj-1/work");

  await expect(page.getByRole("button", { name: "Back to project" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Open project navigation for Demo Project/i })).toBeVisible();
});

test("account sheet holds profile, leaderboard, and settings access on smaller form factors", async ({ page }, testInfo) => {
  const factor = formFactor(testInfo.project.name);
  test.skip(factor === "desktop", "Desktop keeps these surfaces in persistent chrome.");

  await mockAuthenticatedApp(page);
  await page.goto("/projects");

  await page.getByRole("button", { name: "Open account" }).click();
  await expect(page.getByRole("button", { name: "Profile" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Leaderboard" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Team settings" })).toBeVisible();
  await expect(page.getByRole("button", { name: "App settings" })).toBeVisible();
});

test("modal flows lock the background document across form factors", async ({ page }, testInfo) => {
  const factor = formFactor(testInfo.project.name);

  await mockAuthenticatedApp(page);
  await page.goto("/projects");

  if (factor === "desktop") {
    await page.getByRole("button", { name: "Open host settings" }).click();
    await expect(page.getByRole("heading", { name: "Host Connection" })).toBeVisible();
  } else {
    await page.getByRole("button", { name: "Open account" }).click();
    await page.getByRole("button", { name: "App settings" }).click();
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  }

  await expect.poll(async () => {
    return page.evaluate(() => {
      const bodyOverflow = window.getComputedStyle(document.body).overflow;
      const htmlOverflow = window.getComputedStyle(document.documentElement).overflow;
      return bodyOverflow === "hidden" || htmlOverflow === "hidden";
    });
  }).toBe(true);
});
