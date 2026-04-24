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

const processes = [
  {
    process_id: "proc-1",
    org_id: "org-1",
    user_id: "user-1",
    project_id: "proj-1",
    name: "Nightly QA",
    description: "Run nightly checks",
    enabled: true,
    folder_id: null,
    schedule: "Nightly",
    tags: [],
    last_run_at: "2026-03-17T01:00:00.000Z",
    next_run_at: "2026-03-18T01:00:00.000Z",
    created_at: "2026-03-17T01:00:00.000Z",
    updated_at: "2026-03-17T01:00:00.000Z",
  },
];

const processRuns = {
  "proc-1": [
    {
      run_id: "run-1",
      process_id: "proc-1",
      status: "running",
      trigger: "manual",
      error: null,
      started_at: "2026-03-17T01:00:00.000Z",
      completed_at: null,
    },
  ],
};

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
        machine_type: "remote",
        workspace_path: "/home/aura/project-atlas",
        status: "working",
        current_task_id: null,
        current_session_id: null,
        total_input_tokens: 0,
        total_output_tokens: 0,
        created_at: "2026-03-17T01:00:00.000Z",
        updated_at: "2026-03-17T01:00:00.000Z",
      },
    ],
    processes,
    processRuns,
    tasks,
    specs,
    agents: [
      {
        agent_id: "agent-1",
        user_id: "user-1",
        org_id: "org-1",
        name: "Builder Bot",
        role: "Engineer",
        personality: "Helpful",
        system_prompt: "Build features carefully.",
        skills: ["github", "slack"],
        icon: null,
        machine_type: "remote",
        environment: "cloud",
        auth_source: "api_key",
        adapter_type: "codex_cli",
        created_at: "2026-03-17T01:00:00.000Z",
        updated_at: "2026-03-17T01:00:00.000Z",
      },
      {
        agent_id: "agent-2",
        user_id: "user-1",
        org_id: "org-1",
        name: "Research Bot",
        role: "Analyst",
        personality: "Curious",
        system_prompt: "Research carefully.",
        skills: [],
        icon: null,
        machine_type: "remote",
        environment: "cloud",
        auth_source: "aura_managed",
        adapter_type: "aura_harness",
        created_at: "2026-03-17T01:00:00.000Z",
        updated_at: "2026-03-17T01:00:00.000Z",
      },
      {
        agent_id: "agent-3",
        user_id: "user-1",
        org_id: "org-1",
        name: "Mobile QA Agent",
        role: "Validator",
        personality: "Meticulous",
        system_prompt: "Check mobile flows carefully.",
        skills: [],
        icon: null,
        machine_type: "remote",
        environment: "swarm_microvm",
        auth_source: "aura_managed",
        adapter_type: "aura_harness",
        created_at: "2026-03-17T01:00:00.000Z",
        updated_at: "2026-03-17T01:00:00.000Z",
      },
    ],
    agentSkillInstallations: {
      "agent-1": [
        {
          agent_id: "agent-1",
          skill_name: "github",
          source_url: "https://example.com/skills/github",
          installed_at: "2026-03-17T01:00:00.000Z",
          version: "1.0.0",
          approved_paths: [],
          approved_commands: [],
        },
        {
          agent_id: "agent-1",
          skill_name: "slack",
          source_url: null,
          installed_at: "2026-03-17T01:00:00.000Z",
          version: null,
          approved_paths: [],
          approved_commands: [],
        },
      ],
    },
    remoteAgentStates: {
      "agent-1": {
        agent_id: "agent-1",
        state: "running",
        uptime_seconds: 4523,
        active_sessions: 2,
        endpoint: "ssh://builder-bot.remote",
        runtime_version: "2026.4.0",
      },
    },
    integrations: [
      {
        integration_id: "int-1",
        org_id: "org-1",
        kind: "workspace_connection",
        provider: "anthropic",
        name: "Primary Anthropic",
        has_secret: true,
        enabled: true,
        created_at: "2026-03-17T01:00:00.000Z",
        updated_at: "2026-03-17T01:00:00.000Z",
      },
    ],
  });
}

test("capture mobile login screen", async ({ page, browserName }, testInfo) => {
  mkdirSync("test-artifacts/review-shots", { recursive: true });

  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "AURA" })).toBeVisible();

  const projectName = testInfo.project.name.replace(/\s+/g, "-");
  await page.screenshot({
    path: `test-artifacts/review-shots/${projectName}-${browserName}-login-mobile-ia.png`,
    fullPage: true,
  });

  await page.getByRole("button", { name: /Host .*?(online|auth required|unreachable|error|checking)/i }).click();
  await expect(page.getByRole("heading", { name: "Host Connection" })).toBeVisible();
  await page.screenshot({
    path: `test-artifacts/review-shots/${projectName}-${browserName}-login-host-settings-mobile-ia.png`,
    fullPage: true,
  });

  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "AURA" })).toBeVisible();

  await page.getByRole("button", { name: "Forgot password?" }).click();
  await expect(page.getByText("Reset Password")).toBeVisible();
  await page.screenshot({
    path: `test-artifacts/review-shots/${projectName}-${browserName}-login-reset-password-mobile-ia.png`,
    fullPage: true,
  });
});

test("capture mobile root and project drawer", async ({ page, browserName }, testInfo) => {
  mkdirSync("test-artifacts/review-shots", { recursive: true });

  await mockMobileVisualApp(page);
  const projectName = testInfo.project.name.replace(/\s+/g, "-");

  await page.goto("/projects");
  await expect(page).toHaveURL(/\/projects\/proj-1\/agents$/);
  await expect(page.getByRole("button", { name: "Open chat with Builder Bot" })).toBeVisible({ timeout: 10000 });
  await expect(page.getByText("Project roster")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Open workspace" })).toHaveCount(0);
  await page.screenshot({
    path: `test-artifacts/review-shots/${projectName}-${browserName}-projects-root-mobile-ia.png`,
    fullPage: true,
  });

  await page.getByRole("button", { name: "Open chat with Builder Bot" }).click();
  await expect(page.getByPlaceholder("What do you want to create?")).toBeVisible({ timeout: 10000 });
  await expect(page.getByRole("button", { name: /Sonnet|Opus|GPT|Kimi|DeepSeek|OSS/i }).first()).toBeVisible({ timeout: 10000 });
  await page.screenshot({
    path: `test-artifacts/review-shots/${projectName}-${browserName}-project-chat-mobile-ia.png`,
    fullPage: true,
  });

  await page.getByRole("button", { name: "Open project navigation", exact: true }).click();
  await expect(page.getByPlaceholder("Search projects...")).toBeVisible({ timeout: 10000 });
  const drawerBox = await page.locator('[class*="mobileNavDrawer"]').first().boundingBox();
  const viewport = page.viewportSize();
  expect(drawerBox).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(drawerBox!.width).toBeGreaterThan(viewport!.width * 0.7);
  expect(drawerBox!.width).toBeLessThan(viewport!.width * 0.8);
  await page.screenshot({
    path: `test-artifacts/review-shots/${projectName}-${browserName}-projects-drawer-mobile-ia.png`,
  });

  await page.goto("/agents");
  await expect(page).toHaveURL(/\/agents$/);
  await expect(page.getByText("Builder Bot")).toBeVisible({ timeout: 10000 });
  await expect(page.getByRole("button", { name: "Create Remote Agent" })).toBeVisible({ timeout: 10000 });
  await page.screenshot({
    path: `test-artifacts/review-shots/${projectName}-${browserName}-agent-library-root-mobile-ia.png`,
    fullPage: true,
  });

  await page.getByRole("button", { name: /Builder Bot/i }).click();
  await expect(page).toHaveURL(/\/agents\/agent-1$/);
  await expect(page.getByText("Remote Runtime")).toBeVisible({ timeout: 10000 });
  await expect(page.getByText("Installed Skills")).toBeVisible({ timeout: 10000 });
  await page.screenshot({
    path: `test-artifacts/review-shots/${projectName}-${browserName}-agent-library-details-mobile-ia.png`,
    fullPage: true,
  });

  await page.goto("/projects/proj-1/agents/create");
  await expect(page.getByLabel("Name")).toBeVisible({ timeout: 10000 });
  await page.screenshot({
    path: `test-artifacts/review-shots/${projectName}-${browserName}-agent-create-mobile-ia.png`,
    fullPage: true,
  });
});

test("capture mobile work, process, and agent settings", async ({ page, browserName }, testInfo) => {
  mkdirSync("test-artifacts/review-shots", { recursive: true });

  await mockMobileVisualApp(page);
  const projectName = testInfo.project.name.replace(/\s+/g, "-");

  await page.goto("/projects");
  await page.getByRole("navigation", { name: "Project sections" }).getByRole("button", { name: "Execution" }).click();
  await expect(page).toHaveURL(/\/projects\/proj-1\/work$/);
  await expect(page.getByRole("button", { name: "Start remote work" })).toBeVisible({ timeout: 15000 });
  await page.screenshot({
    path: `test-artifacts/review-shots/${projectName}-${browserName}-project-work-mobile-ia.png`,
    fullPage: true,
  });

  await page.getByRole("navigation", { name: "Project sections" }).getByRole("button", { name: "Tasks" }).click();
  await expect(page).toHaveURL(/\/projects\/proj-1\/tasks$/);
  await expect(page.getByText("What needs attention")).toBeVisible({ timeout: 10000 });
  await page.screenshot({
    path: `test-artifacts/review-shots/${projectName}-${browserName}-project-tasks-mobile-ia.png`,
    fullPage: true,
  });

  await page.getByRole("navigation", { name: "Project sections" }).getByRole("button", { name: "Files" }).click();
  await expect(page).toHaveURL(/\/projects\/proj-1\/files$/);
  await expect(page.getByText("Remote workspace", { exact: true })).toBeVisible({ timeout: 10000 });
  await page.screenshot({
    path: `test-artifacts/review-shots/${projectName}-${browserName}-project-files-mobile-ia.png`,
    fullPage: true,
  });

  await page.getByText("README.md").click();
  await expect(page.getByRole("button", { name: "Back to files" })).toBeVisible({ timeout: 10000 });
  await page.screenshot({
    path: `test-artifacts/review-shots/${projectName}-${browserName}-project-files-preview-mobile-ia.png`,
    fullPage: true,
  });

  await page.getByRole("button", { name: "Back to files" }).click();

  const processTab = page.getByRole("navigation", { name: "Project sections" }).getByRole("button", { name: "Process" });
  await expect(processTab).toBeVisible({ timeout: 10000 });
  await processTab.click();
  await expect(page).toHaveURL(/\/projects\/proj-1\/process$/);
  await expect(page.getByText("Project automations")).toBeVisible({ timeout: 10000 });
  await page.screenshot({
    path: `test-artifacts/review-shots/${projectName}-${browserName}-project-process-mobile-ia.png`,
    fullPage: true,
  });

  const statsTab = page.getByRole("navigation", { name: "Project sections" }).getByRole("button", { name: "Stats" });
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

  await page.goto("/projects/proj-1/agents/agent-inst-1/details");
  await expect(page.getByText(/Agent Settings/i)).toBeVisible({ timeout: 10000 });
  await expect(page.getByText("github", { exact: true })).toBeVisible({ timeout: 10000 });
  await expect(page.getByRole("button", { name: "Add skills" })).toBeVisible({ timeout: 10000 });
  await page.screenshot({
    path: `test-artifacts/review-shots/${projectName}-${browserName}-project-agent-details-mobile-ia.png`,
    fullPage: true,
  });

  await page.goto("/projects/proj-1/agents/agent-inst-1");
  await expect(page.getByRole("button", { name: "Switch" })).toBeVisible({ timeout: 10000 });
  await page.getByRole("button", { name: "Switch" }).click();
  await expect(page.getByText("Switch agent")).toBeVisible({ timeout: 10000 });
  await page.screenshot({
    path: `test-artifacts/review-shots/${projectName}-${browserName}-project-agent-switcher-mobile-ia.png`,
    fullPage: true,
  });

  await page.goto("/projects");
  await expect(page.getByRole("button", { name: "Open chat with Builder Bot" })).toBeVisible({ timeout: 10000 });
  await page.getByRole("button", { name: "Add project agent" }).click();
  await expect(page.getByText("Add Project Agent")).toBeVisible({ timeout: 10000 });
  await page.screenshot({
    path: `test-artifacts/review-shots/${projectName}-${browserName}-project-agent-actions-mobile-ia.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: /Attach Existing Agent/i }).click();
  await expect(page).toHaveURL(/\/projects\/proj-1\/agents\/attach$/);
  await expect(page.getByText("Add Existing Agent")).toBeVisible({ timeout: 10000 });
  await page.screenshot({
    path: `test-artifacts/review-shots/${projectName}-${browserName}-project-agent-attach-mobile-ia.png`,
    fullPage: true,
  });
  await page.goto("/projects/proj-1/agents/create");
  await expect(page.getByLabel("Name")).toBeVisible({ timeout: 10000 });
  await expect(page.getByLabel("Role")).toBeVisible({ timeout: 10000 });
  await page.screenshot({
    path: `test-artifacts/review-shots/${projectName}-${browserName}-project-agent-create-mobile-ia.png`,
    fullPage: true,
  });

  await page.getByLabel("Name").fill("Atlas");
  await page.getByLabel("Role").fill("Engineer");
  await page.screenshot({
    path: `test-artifacts/review-shots/${projectName}-${browserName}-project-agent-create-form-mobile-ia.png`,
    fullPage: true,
  });
});

test("capture mobile project agent switcher", async ({ page, browserName }, testInfo) => {
  mkdirSync("test-artifacts/review-shots", { recursive: true });

  await mockMobileVisualApp(page);
  const projectName = testInfo.project.name.replace(/\s+/g, "-");

  await page.goto("/projects/proj-1/agents/agent-inst-1");
  await expect(page.getByRole("button", { name: "Switch" })).toBeVisible({ timeout: 10000 });
  await page.getByRole("button", { name: "Switch" }).click();
  await expect(page.getByText("Switch agent")).toBeVisible({ timeout: 10000 });
  await page.screenshot({
    path: `test-artifacts/review-shots/${projectName}-${browserName}-project-agent-switcher-mobile-ia.png`,
    fullPage: true,
  });
});

test("capture mobile organization workspace", async ({ page, browserName }, testInfo) => {
  mkdirSync("test-artifacts/review-shots", { recursive: true });

  await mockMobileVisualApp(page);
  const projectName = testInfo.project.name.replace(/\s+/g, "-");

  await page.goto("/projects/organization");
  await expect(page).toHaveURL(/\/projects\/organization$/);
  await expect(page.getByRole("heading", { name: "Continue work" })).toBeVisible();
  await expect(page.getByText("Teams", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "New Project" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Team settings" })).toBeVisible();
  await page.screenshot({
    path: `test-artifacts/review-shots/${projectName}-${browserName}-organization-workspace-mobile-ia.png`,
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

test("capture mobile feed and project empty state", async ({ page, browserName }, testInfo) => {
  mkdirSync("test-artifacts/review-shots", { recursive: true });

  await page.addInitScript(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await mockMobileVisualApp(page);
  const projectName = testInfo.project.name.replace(/\s+/g, "-");

  await page.goto("/feed");
  await expect(page.getByRole("button", { name: "My Agents" })).toBeVisible({ timeout: 10000 });
  await page.screenshot({
    path: `test-artifacts/review-shots/${projectName}-${browserName}-feed-mobile-ia.png`,
    fullPage: true,
  });

  await mockAuthenticatedApp(page, {
    project: {
      project_id: "proj-empty",
      org_id: "org-1",
      name: "Project Atlas",
      description: "Parity test project",
      current_status: "active",
      created_at: "2026-03-17T01:00:00.000Z",
      updated_at: "2026-03-17T01:00:00.000Z",
    },
    projects: [
      {
        project_id: "proj-empty",
        org_id: "org-1",
        name: "Project Atlas",
        description: "Parity test project",
        current_status: "active",
        created_at: "2026-03-17T01:00:00.000Z",
        updated_at: "2026-03-17T02:00:00.000Z",
      },
    ],
    agentInstances: [],
    tasks: tasks.map((task) => ({ ...task, project_id: "proj-empty" })),
    specs: specs.map((spec) => ({ ...spec, project_id: "proj-empty" })),
  });

  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.goto("/projects/proj-empty/agent");
  await expect(page.getByText("No agent is assigned yet. Add one now, or continue working in Execution or Stats.")).toBeVisible({ timeout: 10000 });
  await expect(page.getByRole("button", { name: "Open Execution" })).toBeVisible({ timeout: 10000 });
  await expect(page.getByRole("button", { name: "Open Stats" })).toBeVisible({ timeout: 10000 });
  await page.screenshot({
    path: `test-artifacts/review-shots/${projectName}-${browserName}-project-agent-empty-state-mobile-ia.png`,
    fullPage: true,
  });
});
