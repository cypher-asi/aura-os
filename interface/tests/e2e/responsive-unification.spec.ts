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

async function openAccountSheet(page: import("@playwright/test").Page) {
  const workspaceHeading = page.getByRole("heading", { name: "Continue work" });

  for (let attempt = 0; attempt < 3 && !/\/projects\/organization$/.test(page.url()); attempt += 1) {
    try {
      await page.goto("/projects/organization", { waitUntil: "domcontentloaded" });
      await page.waitForURL(/\/projects\/organization$/, { timeout: 5000 });
    } catch (error) {
      if (attempt === 2) throw error;
      await page.waitForLoadState("domcontentloaded").catch(() => {});
    }
  }

  await expect(workspaceHeading).toBeVisible();
}

async function expectProjectMobileChrome(
  page: import("@playwright/test").Page,
  factor: "desktop" | "tablet" | "phone",
) {
  if (factor === "desktop") {
    await expect(page.getByRole("button", { name: "Open apps" })).toHaveCount(0);
    return;
  }

  await expect(page.getByRole("button", { name: "Open apps" })).toHaveCount(0);
  const navigation = page.getByRole("navigation", { name: "Project sections" });
  await expect(page.getByRole("button", { name: "Open project navigation", exact: true })).toBeVisible();
  await expect(navigation.getByRole("button", { name: "Agents", exact: true })).toBeVisible();
  await expect(navigation.getByRole("button", { name: "Execution", exact: true })).toBeVisible();
  await expect(navigation.getByRole("button", { name: "Stats", exact: true })).toHaveCount(1);
  await expect(navigation.getByRole("button", { name: "Files", exact: true })).toHaveCount(1);
  await expect(navigation.getByRole("button", { name: "Feed", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Open workspace" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Projects", exact: true })).toHaveCount(0);
}

async function expectGlobalAppChrome(
  page: import("@playwright/test").Page,
  factor: "desktop" | "tablet" | "phone",
) {
  if (factor === "desktop") {
    await expect(page.getByRole("button", { name: "Open apps" })).toHaveCount(0);
    return;
  }

  await expect(page.getByRole("button", { name: "Open apps" })).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Project sections" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Open project navigation/i })).toBeVisible();
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

test("login keeps the same host targeting entry across form factors", async ({ page }, testInfo) => {
  const factor = formFactor(testInfo.project.name);
  await page.goto("/login");

  const hostButton = factor === "desktop"
    ? page.getByRole("button", { name: "Change host" })
    : page.getByRole("button", { name: /Host .*?(online|auth required|unreachable|error|checking)/i });

  await expect(hostButton).toBeVisible();
  await hostButton.click();
  await expect(page.getByRole("heading", { name: "Host Connection" })).toBeVisible();
});

test("projects entry keeps desktop welcome, while mobile/tablet resolve to the project agents roster", async ({ page }, testInfo) => {
  const factor = formFactor(testInfo.project.name);

  await mockAuthenticatedApp(page);
  await page.goto("/projects");

  if (factor === "desktop") {
    await expect(page.getByRole("tree", { name: "Projects" })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Search" })).toBeVisible();
    await expect(page.getByPlaceholder("What do you want to create?")).toBeVisible();
  } else {
    await expect(page).toHaveURL(/\/projects\/proj-1\/agents$/);
    await expect(page.getByRole("button", { name: "Open chat with Builder Bot" })).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole("button", { name: "Open chat with Builder Bot" })).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole("treeitem", { name: "Demo Project" })).toHaveCount(0);
    await expectProjectMobileChrome(page, factor);
  }
});

test("projects entry preserves desktop remembered chat while smaller form factors land on the roster", async ({ page }, testInfo) => {
  const factor = formFactor(testInfo.project.name);

  await mockAuthenticatedApp(page);
  await page.addInitScript(() => {
    localStorage.setItem("aura-last-agent", JSON.stringify({ "proj-1": "agent-inst-1" }));
  });
  await page.goto("/projects");

  if (factor === "desktop") {
    await expect(page).toHaveURL(/\/projects\/proj-1\/agents\/agent-inst-1$/);
    await expect(page.getByRole("tree", { name: "Projects" })).toBeVisible();
    await expect(page.getByPlaceholder("What do you want to create?")).toBeVisible();
  } else {
    await expect(page).toHaveURL(/\/projects\/proj-1\/agents$/);
    await expect(page.getByRole("button", { name: "Open chat with Builder Bot" })).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole("button", { name: "Open chat with Builder Bot" })).toBeVisible({ timeout: 10000 });
  }

  if (factor === "desktop") {
    await expectProjectMobileChrome(page, factor);
  } else {
    await expectProjectMobileChrome(page, factor);
  }
});

test("feed keeps shared content while mobile/tablet use the global app chrome", async ({ page }, testInfo) => {
  const factor = formFactor(testInfo.project.name);

  await mockAuthenticatedApp(page);
  await page.goto("/feed");

  if (factor === "desktop") {
    await expect(page.getByRole("treeitem", { name: "My Agents" })).toBeVisible();
    await expect(page.getByRole("treeitem", { name: "Organization" })).toBeVisible();
  } else {
    await expect(page.getByRole("button", { name: "My Agents" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Organization" })).toBeVisible();
  }
  await expectGlobalAppChrome(page, factor);
});

test("profile remains reachable directly with shared content across form factors", async ({ page }, testInfo) => {
  const factor = formFactor(testInfo.project.name);

  await mockAuthenticatedApp(page);
  await page.goto("/profile");

  if (factor === "desktop") {
    await expect(page.getByRole("treeitem", { name: "All" })).toBeVisible();
    await expect(page.getByRole("treeitem", { name: "Demo Project" })).toBeVisible();
  } else {
    await expect(page.getByRole("button", { name: "All activity" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Demo Project" })).toBeVisible();
    await expect(page.getByRole("treeitem", { name: "All" })).toHaveCount(0);
  }
  await expectGlobalAppChrome(page, factor);
});

test("project work route uses the combined mobile work view while desktop keeps shared project chrome", async ({ page }, testInfo) => {
  const factor = formFactor(testInfo.project.name);

  await mockProjectWorkApp(page);
  await page.goto("/projects/proj-1/work");

  if (factor === "desktop") {
    await expect(page.getByRole("textbox", { name: "Search" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Demo Project" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Specs" })).toBeVisible();
    await page.getByRole("button", { name: "Specs" }).click();
    await expect(page.getByText("Mobile parity spec")).toBeVisible();
  } else {
    await expect(page.getByRole("button", { name: "Start remote work" })).toBeVisible({ timeout: 15000 });
    await expect(page.getByText("Recent activity")).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("Specs")).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole("button", { name: "Open spec Mobile parity spec" })).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole("treeitem", { name: "Demo Project" })).toHaveCount(0);
    await page
      .getByRole("navigation", { name: "Project sections" })
      .getByRole("button", { name: "Stats" })
      .click();
    await expect(page).toHaveURL(/\/projects\/proj-1\/stats$/);
    await expect(page.getByText("Completion")).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("Tokens")).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole("button", { name: "Open project navigation", exact: true })).toBeVisible();
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

test("organization workspace holds team and project actions on smaller form factors", async ({ page }, testInfo) => {
  const factor = formFactor(testInfo.project.name);
  test.skip(factor === "desktop", "Desktop keeps these surfaces in persistent chrome.");

  await mockAuthenticatedApp(page);
  await page.goto("/projects/proj-1/agents/agent-inst-1");

  await openAccountSheet(page);
  await expect(page.getByRole("button", { name: "Team settings" })).toBeVisible();
  await expect(page.getByRole("button", { name: "New Project" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open workspace" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "App settings" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Profile" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Leaderboard" })).toHaveCount(0);
});

test("modal flows lock the background document across form factors", async ({ page }, testInfo) => {
  const factor = formFactor(testInfo.project.name);

  await mockAuthenticatedApp(page);
  await page.goto("/projects/proj-1/agents/agent-inst-1");

  if (factor === "desktop") {
    await page.getByRole("button", { name: "Open host settings" }).click();
    await expect(page.getByRole("heading", { name: "Host Connection" })).toBeVisible();
  } else {
    await page.getByRole("button", { name: "Open project navigation", exact: true }).click();
    await expect(page.getByRole("tree", { name: "Project navigation" })).toBeVisible();
  }

  await expect.poll(async () => {
    return page.evaluate(() => {
      const bodyOverflow = window.getComputedStyle(document.body).overflow;
      const htmlOverflow = window.getComputedStyle(document.documentElement).overflow;
      return bodyOverflow === "hidden" || htmlOverflow === "hidden";
    });
  }).toBe(true);
});
