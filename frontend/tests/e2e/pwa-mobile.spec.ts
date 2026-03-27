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

async function mockAuthenticatedMobileApp(
  page: import("@playwright/test").Page,
  options: {
    orgsUnavailable?: boolean;
    withAgentInstance?: boolean;
    projects?: Record<string, unknown>[];
    agentInstances?: Record<string, unknown>[];
  } = {},
) {
  const agentInstance = {
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
  };

  const agents = [
    {
      agent_id: "agent-1",
      user_id: "user-1",
      name: "Builder Bot",
      role: "Engineer",
      personality: "Helpful",
      system_prompt: "Build features carefully.",
      skills: [],
      icon: null,
      created_at: "2026-03-17T01:00:00.000Z",
      updated_at: "2026-03-17T01:00:00.000Z",
    },
    {
      agent_id: "agent-2",
      user_id: "user-1",
      name: "Research Bot",
      role: "Analyst",
      personality: "Curious",
      system_prompt: "Research carefully.",
      skills: [],
      icon: null,
      created_at: "2026-03-17T01:00:00.000Z",
      updated_at: "2026-03-17T01:00:00.000Z",
    },
  ];

  await mockAuthenticatedApp(page, {
    agentInstances: options.withAgentInstance === false ? [] : (options.agentInstances ?? [agentInstance]),
    agents,
    tasks,
    specs,
    orgsUnavailable: options.orgsUnavailable,
    projects: options.projects,
  });
}

async function openProjectDrawer(page: import("@playwright/test").Page, projectName?: string) {
  await page.getByRole("button", { name: projectName ? new RegExp(`Open project navigation for ${projectName}`, "i") : /Open project navigation/i }).click();
}

async function openAppSwitcher(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "Open apps" }).click();
}

async function tapPrimaryNav(page: import("@playwright/test").Page, label: "Agent" | "Execution" | "Stats") {
  await page
    .getByRole("navigation", { name: "Primary mobile navigation" })
    .getByRole("button", { name: label })
    .tap();
}

test("mobile login page renders with PWA metadata", async ({ page }) => {
  await page.goto("/login");

  await expect(page).toHaveTitle(/AURA/);
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#05070d");
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", "/manifest.webmanifest");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Host .*?(online|auth required|unreachable|error|checking)/i })).toBeVisible();
  await expect(page.getByPlaceholder("Email")).toBeVisible();
  await expect(page.locator("form").getByRole("button", { name: "Sign In" })).toBeVisible();
});

test("mobile login page can open host settings", async ({ page }) => {
  await page.goto("/login");

  await page.getByRole("button", { name: /Host .*?(online|auth required|unreachable|error|checking)/i }).click();
  await expect(page.getByRole("heading", { name: "Host Connection" })).toBeVisible();
});

test("mobile root uses project drawer plus the three-tab project navigation", async ({ page }) => {
  await mockAuthenticatedMobileApp(page);
  await page.goto("/projects");

  await expect(page).toHaveURL(/\/projects\/proj-1\/agents\/agent-inst-1$/);
  await expect(page.getByPlaceholder("Add a follow-up")).toBeVisible({ timeout: 10000 });
  await expect(page.getByRole("button", { name: "Open apps" })).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Primary mobile navigation" }).getByRole("button", { name: "Agent", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Primary mobile navigation" }).getByRole("button", { name: "Execution", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Primary mobile navigation" }).getByRole("button", { name: "Stats", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Primary mobile navigation" }).getByRole("button", { name: "Files", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Primary mobile navigation" }).getByRole("button", { name: "Feed", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Projects", exact: true })).toHaveCount(0);

  await openProjectDrawer(page);
  await expect(page.getByPlaceholder("Search Projects...")).toBeVisible();
  await expect(page.getByRole("treeitem", { name: "Demo Project" })).toBeVisible();
  await expect(page.getByText("Current project")).toBeVisible();
});

test("mobile project navigation opens shared agent, work, and stats routes", async ({ page }) => {
  await mockAuthenticatedMobileApp(page);
  await page.goto("/projects");

  await tapPrimaryNav(page, "Agent");
  await expect(page).toHaveURL(/\/projects\/proj-1\/agents\/agent-inst-1$/);
  await expect(page.getByPlaceholder("Add a follow-up")).toBeVisible({ timeout: 10000 });

  await tapPrimaryNav(page, "Execution");
  await expect(page).toHaveURL(/\/projects\/proj-1\/work$/);
  await expect(page.getByText("Execution", { exact: true })).toBeVisible({ timeout: 10000 });
  await expect(page.getByText("Specs")).toBeVisible({ timeout: 10000 });
  await expect(page.getByRole("main").getByRole("button", { name: "Tasks" })).toBeVisible();

  await tapPrimaryNav(page, "Stats");
  await expect(page).toHaveURL(/\/projects\/proj-1\/stats$/);
  await expect(page.getByText("Stats", { exact: true })).toBeVisible({ timeout: 10000 });
});

test("mobile project agent tab surfaces the active project agent and switches instances", async ({ page }) => {
  await mockAuthenticatedMobileApp(page, {
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
      {
        agent_instance_id: "agent-inst-2",
        project_id: "proj-1",
        agent_id: "agent-2",
        name: "Research Bot",
        role: "Analyst",
        personality: "Curious",
        system_prompt: "Research carefully.",
        skills: [],
        icon: null,
        status: "working",
        current_task_id: null,
        current_session_id: null,
        total_input_tokens: 0,
        total_output_tokens: 0,
        created_at: "2026-03-17T01:00:00.000Z",
        updated_at: "2026-03-17T01:00:00.000Z",
      },
    ],
  });

  await page.goto("/projects/proj-1/agents/agent-inst-1");

  const projectAgentSelect = page.getByLabel("Project agent");
  await expect(projectAgentSelect).toHaveValue("agent-inst-1");
  await projectAgentSelect.selectOption("agent-inst-2");
  await expect(page).toHaveURL(/\/projects\/proj-1\/agents\/agent-inst-2$/);
  await expect(projectAgentSelect).toHaveValue("agent-inst-2");
});

test("mobile global app switcher opens feed, leaderboard, and profile", async ({ page }) => {
  await mockAuthenticatedMobileApp(page);
  await page.goto("/projects");

  await openAppSwitcher(page);
  await expect(page.getByRole("button", { name: "Projects" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Agent library" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Feed" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Leaderboard" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Profile" })).toBeVisible();

  await page.getByRole("button", { name: "Agent library" }).click();
  await expect(page).toHaveURL(/\/agents$/);
  await expect(page.getByText("Select an agent from your library.")).toBeVisible();
  await expect(page.getByText("Builder Bot")).toBeVisible();
  await expect(page.getByText("Helpful")).toBeVisible();
  await expect(page.getByPlaceholder("Add a follow-up")).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Primary mobile navigation" })).toHaveCount(0);

  await openAppSwitcher(page);
  await page.getByRole("button", { name: "Feed" }).click();
  await expect(page).toHaveURL(/\/feed$/);
  await expect(page.getByRole("button", { name: "My Agents" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Primary mobile navigation" })).toHaveCount(0);

  await openAppSwitcher(page);
  await page.getByRole("button", { name: "Leaderboard" }).click();
  await expect(page).toHaveURL(/\/leaderboard$/);
  await expect(page.getByRole("button", { name: "My Agents" })).toBeVisible();

  await openAppSwitcher(page);
  await page.getByRole("button", { name: "Profile" }).click();
  await expect(page).toHaveURL(/\/profile$/);
  await expect(page.getByRole("button", { name: "All activity" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Demo Project" })).toBeVisible();
});

test("mobile agent library toggles the selected standalone chat open and closed", async ({ page }) => {
  await mockAuthenticatedMobileApp(page);
  await page.goto("/agents");

  await expect(page).toHaveURL(/\/agents$/);
  await expect(page.getByText("Select an agent from your library.")).toBeVisible();

  await page.getByRole("button", { name: /Builder Bot/i }).click();
  await expect(page).toHaveURL(/\/agents\/agent-1$/);

  await page.getByRole("button", { name: /Builder Bot/i }).click();
  await expect(page).toHaveURL(/\/agents$/);
  await expect(page.getByText("Select an agent from your library.")).toBeVisible();
});

test("mobile global surfaces use the app switcher to return to project mode", async ({ page }) => {
  await mockAuthenticatedMobileApp(page);
  await page.goto("/feed");

  await openAppSwitcher(page);
  await page.getByRole("button", { name: "Projects" }).click();

  await expect(page).toHaveURL(/\/projects\/proj-1\/agents\/agent-inst-1$/);
  await expect(page.getByPlaceholder("Add a follow-up")).toBeVisible({ timeout: 10000 });
});

test("mobile files view shows imported workspace snapshots", async ({ page }) => {
  await mockAuthenticatedApp(page, {
    project: {
      project_id: "proj-1",
      org_id: "org-1",
      name: "Imported Project",
      description: "Imported workspace project",
      linked_folder_path: "/tmp/imported-workspaces/proj-1/workspace",
      workspace_source: "imported",
      workspace_display_path: "Imported project files",
      current_status: "active",
      created_at: "2026-03-17T01:00:00.000Z",
      updated_at: "2026-03-17T01:00:00.000Z",
    },
    tasks,
    specs,
  });

  const directoryLoaded = page.waitForResponse((response) =>
    response.url().includes("/api/list-directory") && response.request().method() === "POST",
  );
  await page.goto("/projects/proj-1/files");

  await expect(page.getByPlaceholder("Search files...")).toBeVisible();
  expect((await directoryLoaded).ok()).toBeTruthy();
  await expect(page.getByText("No linked workspace")).toHaveCount(0);
  await expect(page.getByText("Workspace snapshot")).toBeVisible();
  await expect(page.getByRole("button", { name: /README\.md/i })).toBeVisible({ timeout: 10000 });
  await expect(page.getByRole("button", { name: /auth\.ts/i })).toBeVisible({ timeout: 10000 });
  await page.getByRole("button", { name: /README\.md/i }).click();
  await expect(page.getByText("Preview the imported snapshot here on mobile.")).toBeVisible({ timeout: 10000 });
});

test("mobile drawer scales across current, recent, and other projects", async ({ page }) => {
  await mockAuthenticatedMobileApp(page, {
    projects: [
      {
        project_id: "proj-1",
        org_id: "org-1",
        name: "Project Atlas",
        description: "Current project",
        linked_folder_path: "/tmp/demo-project",
        current_status: "active",
        created_at: "2026-03-17T01:00:00.000Z",
        updated_at: "2026-03-17T04:00:00.000Z",
      },
      {
        project_id: "proj-2",
        org_id: "org-1",
        name: "Design System",
        description: "Tokens and shell polish",
        linked_folder_path: "/tmp/design-system",
        current_status: "active",
        created_at: "2026-03-16T01:00:00.000Z",
        updated_at: "2026-03-17T03:00:00.000Z",
      },
      {
        project_id: "proj-3",
        org_id: "org-1",
        name: "Docs Refresh",
        description: "Onboarding copy",
        linked_folder_path: "/tmp/docs-refresh",
        current_status: "active",
        created_at: "2026-03-15T01:00:00.000Z",
        updated_at: "2026-03-17T02:00:00.000Z",
      },
      {
        project_id: "proj-4",
        org_id: "org-1",
        name: "Orbit QA",
        description: "Repo workflows",
        linked_folder_path: "/tmp/orbit-qa",
        current_status: "active",
        created_at: "2026-03-14T01:00:00.000Z",
        updated_at: "2026-03-16T23:00:00.000Z",
      },
    ],
  });

  await page.goto("/projects/proj-1/work");
  await openProjectDrawer(page, "Project Atlas");

  await expect(page.getByText("Current project", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Recent projects", { exact: true })).toBeVisible();
  await expect(page.getByText("Other projects", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open Design System" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open Docs Refresh" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open Orbit QA" })).toBeVisible();
});

test("mobile agent tab shows a project empty state when no agent exists", async ({ page }) => {
  await mockAuthenticatedMobileApp(page, { withAgentInstance: false });
  await page.goto("/projects");

  await tapPrimaryNav(page, "Agent");
  await expect(page).toHaveURL(/\/projects\/proj-1\/agent$/);
  await expect(page.getByText("No agent is assigned yet.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Open Tasks" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open Stats" })).toBeVisible();
});

test("mobile project title opens the drawer from the primary project tabs", async ({ page }) => {
  await mockAuthenticatedMobileApp(page);
  await page.goto("/projects/proj-1/work");

  await expect(page.getByRole("button", { name: /Open project navigation for Demo Project/i })).toBeVisible();
  await expect(page.getByRole("button", { name: "Back to project" })).toHaveCount(0);
  await openProjectDrawer(page, "Demo Project");
  const projectNavigation = page.getByRole("tree", { name: "Project navigation" });
  await expect(page.getByRole("treeitem", { name: "Demo Project" })).toBeVisible();
  await expect(projectNavigation.getByRole("treeitem", { name: "Demo Project" })).toBeVisible();
  await expect(projectNavigation.getByRole("button", { name: "Agent", exact: true })).toHaveCount(0);
  await expect(projectNavigation.getByRole("button", { name: "Tasks", exact: true })).toHaveCount(0);
  await expect(projectNavigation.getByRole("button", { name: "Files", exact: true })).toHaveCount(0);
  await expect(projectNavigation.getByRole("button", { name: "Stats", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Close drawer" }).dispatchEvent("click");
  await expect(page.getByRole("navigation", { name: "Primary mobile navigation" })).toBeVisible();

  await tapPrimaryNav(page, "Agent");
  await expect(page.getByRole("button", { name: "Back to project" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Open project navigation for Demo Project/i })).toBeVisible();
});

test("mobile new project modal opens from the project drawer", async ({ page, browserName }) => {
  test.skip(browserName === "webkit", "Headless WebKit is flaky with file chooser coverage; Chromium covers the modal flow.");
  await mockAuthenticatedMobileApp(page);
  await page.goto("/projects");

  await openProjectDrawer(page);
  await page.locator('button[title="New Project"]:visible').click();

  await expect(page.getByPlaceholder("Project name")).toBeVisible();
  await expect(page.getByText("Project path")).toBeVisible();
  await expect(page.getByText("Environment")).toBeVisible();
  await expect(page.getByRole("button", { name: "Create Project" })).toBeDisabled();
});

test("mobile new project modal falls back to an existing project org when org lookup is unavailable", async ({ page, browserName }) => {
  test.skip(browserName === "webkit", "Headless WebKit is flaky with file chooser coverage; Chromium covers the modal flow.");
  await mockAuthenticatedApp(page, { orgsUnavailable: true });
  await page.goto("/projects/proj-1/agents/agent-inst-1");

  await openProjectDrawer(page);
  await page.locator('button[title="New Project"]:visible').click();

  await expect(page.getByPlaceholder("Project name")).toBeVisible();
  await expect(page.getByText("Loading your team...")).toHaveCount(0);
  await expect(page.getByText("No team found. Log out and back in to create a default team.")).toHaveCount(0);
  await expect(
    page.getByRole("dialog").getByRole("button", { name: "Create Project" }),
  ).toBeDisabled();
});

test("mobile work view opens shared preview details for specs and tasks", async ({ page }) => {
  await mockAuthenticatedMobileApp(page);
  await page.goto("/projects/proj-1/work");

  await expect(page.getByText("Execution", { exact: true })).toBeVisible({ timeout: 10000 });
  const specButton = page.getByRole("button", { name: "Open spec Mobile parity spec", exact: true });
  await expect(specButton).toBeVisible({ timeout: 10000 });
  await specButton.click();
  await expect(page.getByRole("heading", { name: "Mobile parity" })).toBeVisible();

  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Mobile parity" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Close", exact: true })).toHaveCount(0);
  const taskButton = page.getByRole("button", { name: "Open task Patch auth flow", exact: true });
  await taskButton.scrollIntoViewIfNeeded();
  await expect(taskButton).toBeVisible({ timeout: 10000 });
  await taskButton.click();
  await expect(page.getByText("Files Changed")).toBeVisible();
});

test("mobile account sheet exposes team, host, and app settings", async ({ page }) => {
  await mockAuthenticatedMobileApp(page);
  await page.goto("/projects");

  await page.getByRole("button", { name: "Open account" }).click();
  await expect(page.getByRole("button", { name: "Team settings" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Host settings" })).toBeVisible();
  await expect(page.getByRole("button", { name: "App settings" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Profile" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Leaderboard" })).toHaveCount(0);
});

test("mobile team settings shows an unavailable state when org loading fails", async ({ page }) => {
  await mockAuthenticatedMobileApp(page, { orgsUnavailable: true });
  await page.goto("/projects");

  await page.getByRole("button", { name: "Open account" }).click();
  await page.getByRole("button", { name: "Team settings" }).click();

  const dialog = page.getByRole("dialog").filter({ hasText: "Team Settings" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Team settings are currently unavailable.")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Retry" })).toBeVisible();
});

test("manifest and service worker assets are reachable", async ({ page }) => {
  const manifestResponse = await page.request.get("/manifest.webmanifest");
  expect(manifestResponse.ok()).toBeTruthy();

  const manifest = await manifestResponse.json();
  expect(manifest.name).toBe("AURA");
  expect(manifest.display).toBe("standalone");
  expect(manifest.icons).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ src: "/pwa-192.png" }),
      expect.objectContaining({ src: "/pwa-512.png" }),
    ]),
  );

  const swResponse = await page.request.get("/sw.js");
  expect(swResponse.ok()).toBeTruthy();
  expect(await swResponse.text()).toContain("STATIC_CACHE");
});

test.describe("service worker registration", () => {
  test.use({ serviceWorkers: "allow" });

  test("service worker registers in chromium", async ({ page, context, browserName }) => {
    test.skip(browserName !== "chromium", "Playwright only exposes service workers in Chromium.");

    await page.goto("/login");
    await page.evaluate(async () => {
      if (!("serviceWorker" in navigator)) return;
      await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
    });

    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
    expect(worker.url()).toContain("/sw.js");
  });
});
