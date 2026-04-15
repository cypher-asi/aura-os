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

async function mockAuthenticatedMobileApp(
  page: import("@playwright/test").Page,
  options: {
    orgsUnavailable?: boolean;
    orgs?: Record<string, unknown>[];
    projectsByOrgId?: Record<string, Record<string, unknown>[]>;
    withAgentInstance?: boolean;
    projects?: Record<string, unknown>[];
    agentInstances?: Record<string, unknown>[];
    agents?: Record<string, unknown>[];
    agentSkillInstallations?: Record<string, Record<string, unknown>[]>;
    remoteAgentStates?: Record<string, Record<string, unknown>>;
    processes?: Record<string, unknown>[];
    processRuns?: Record<string, Record<string, unknown>[]>;
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
    machine_type: "local",
    workspace_path: "/tmp/demo-project",
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
    agents: options.agents ?? agents,
    agentSkillInstallations: options.agentSkillInstallations,
    remoteAgentStates: options.remoteAgentStates,
    tasks,
    specs,
    processes: options.processes ?? processes,
    processRuns: options.processRuns ?? processRuns,
    orgsUnavailable: options.orgsUnavailable,
    orgs: options.orgs,
    projectsByOrgId: options.projectsByOrgId,
    projects: options.projects,
  });
}

async function openProjectDrawer(page: import("@playwright/test").Page, projectName?: string) {
  await page.getByRole("button", { name: projectName ? new RegExp(`Open project navigation for ${projectName}`, "i") : /Open project navigation/i }).click();
}

async function openAppSwitcher(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "Open apps" }).click();
}

async function openAccountSheet(page: import("@playwright/test").Page) {
  await openAppSwitcher(page);
  const accountSettingsButton = page.getByRole("button", { name: "Account settings" });
  await accountSettingsButton.scrollIntoViewIfNeeded();
  await accountSettingsButton.click();
}

async function tapPrimaryNav(page: import("@playwright/test").Page, label: "Agent" | "Tasks" | "Execution" | "Process" | "Stats") {
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

test("mobile root uses project drawer plus the five-tab project navigation", async ({ page }) => {
  await mockAuthenticatedMobileApp(page);
  await page.goto("/projects");

  await expect(page).toHaveURL(/\/projects\/proj-1\/agents\/agent-inst-1$/);
  await expect(page.getByPlaceholder("What do you want to create?")).toBeVisible({ timeout: 10000 });
  await expect(page.getByRole("button", { name: "Add or create project agent" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open apps" })).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Primary mobile navigation" }).getByRole("button", { name: "Agent", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Primary mobile navigation" }).getByRole("button", { name: "Tasks", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Primary mobile navigation" }).getByRole("button", { name: "Execution", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Primary mobile navigation" }).getByRole("button", { name: "Process", exact: true }),
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
  const projectNavigation = page.getByRole("tree", { name: "Project navigation" });
  await expect(page.getByRole("treeitem", { name: "Demo Project" })).toBeVisible();
  await expect(page.getByText("Agent & skills", { exact: true })).toBeVisible();
  await expect(projectNavigation.getByText("Open agent", { exact: true })).toBeVisible();
  await expect(projectNavigation.getByRole("button", { name: "Agent", exact: true })).toHaveCount(0);
  await expect(projectNavigation.getByRole("button", { name: "Tasks", exact: true })).toHaveCount(0);
  await expect(projectNavigation.getByRole("button", { name: "Execution", exact: true })).toHaveCount(0);
  await expect(projectNavigation.getByRole("button", { name: "Process", exact: true })).toHaveCount(0);
  await expect(projectNavigation.getByRole("button", { name: "Stats", exact: true })).toHaveCount(0);
});

test("mobile project navigation opens shared agent, work, process, and stats routes", async ({ page }) => {
  await mockAuthenticatedMobileApp(page);
  await page.goto("/projects");

  await tapPrimaryNav(page, "Agent");
  await expect(page).toHaveURL(/\/projects\/proj-1\/agents\/agent-inst-1$/);
  await expect(page.getByPlaceholder("What do you want to create?")).toBeVisible({ timeout: 10000 });
  await page.getByRole("button", { name: "Add or create project agent" }).click();
  await expect(page).toHaveURL(/\/projects\/proj-1\/agents\/create$/);
  await expect(page.getByLabel("Name")).toBeVisible({ timeout: 10000 });
  await expect(page.getByText("New remote agent")).toBeVisible({ timeout: 10000 });
  const createButton = page.getByRole("button", { name: "Create & Add Agent" });
  await createButton.scrollIntoViewIfNeeded();
  await expect(createButton).toBeVisible({ timeout: 10000 });
  await page.getByRole("button", { name: "Back to project" }).click();
  await expect(page.getByPlaceholder("What do you want to create?")).toBeVisible({ timeout: 10000 });

  await page.getByRole("button", { name: "Add or create project agent" }).click();
  await expect(page).toHaveURL(/\/projects\/proj-1\/agents\/create$/);
  const moreOptionsButton = page.getByRole("button", { name: "More agent options" });
  if (await moreOptionsButton.isVisible().catch(() => false)) {
    await moreOptionsButton.click();
    await expect(page.getByText("More Agent Options")).toBeVisible({ timeout: 10000 });
  }
  const existingRouteButton = page.getByRole("button", { name: "Use existing remote agent" });
  if (await existingRouteButton.isVisible().catch(() => false)) {
    await existingRouteButton.click();
    await expect(page).toHaveURL(/\/projects\/proj-1\/agents\/attach$/);
    await expect(page.getByText("Available remote agents")).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole("button", { name: "Back to create" })).toBeVisible({ timeout: 10000 });
    await page.getByRole("button", { name: "Back to create" }).click();
    await expect(page).toHaveURL(/\/projects\/proj-1\/agents\/create$/);
  }
  await page.getByRole("button", { name: "Back to project" }).click();
  await expect(page.getByPlaceholder("What do you want to create?")).toBeVisible({ timeout: 10000 });

  await tapPrimaryNav(page, "Tasks");
  await expect(page).toHaveURL(/\/projects\/proj-1\/tasks$/);
  await expect(page.getByText("What needs attention")).toBeVisible({ timeout: 10000 });
  await expect(page.getByRole("tab", { name: /Ready/i })).toBeVisible({ timeout: 10000 });

  await tapPrimaryNav(page, "Execution");
  await expect(page).toHaveURL(/\/projects\/proj-1\/work$/);
  await expect(page.getByRole("main").getByText("Execution", { exact: true })).toBeVisible({ timeout: 10000 });
  await expect(page.getByText("Specs")).toBeVisible({ timeout: 10000 });
  await expect(page.getByRole("main").getByRole("button", { name: "Tasks" })).toHaveCount(0);

  await tapPrimaryNav(page, "Process");
  await expect(page).toHaveURL(/\/projects\/proj-1\/process$/);
  await expect(page.getByText("Project automations")).toBeVisible({ timeout: 10000 });

  await tapPrimaryNav(page, "Stats");
  await expect(page).toHaveURL(/\/projects\/proj-1\/stats$/);
  await expect(page.getByRole("main").getByText("Stats", { exact: true })).toBeVisible({ timeout: 10000 });
});

test("mobile project drawer opens project agent details", async ({ page }) => {
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
        machine_type: "remote",
        environment: "cloud",
        auth_source: "aura_managed",
        adapter_type: "codex_cli",
        workspace_path: "/tmp/demo-project",
        status: "idle",
        current_task_id: null,
        current_session_id: null,
        total_input_tokens: 0,
        total_output_tokens: 0,
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
  });

  await page.goto("/projects");
  await openProjectDrawer(page);
  await page
    .getByRole("tree", { name: "Project navigation" })
    .locator("button")
    .filter({ hasText: "Open agent" })
    .click();

  await expect(page).toHaveURL(/\/projects\/proj-1\/agents\/agent-inst-1\/details$/);
  await expect(page.getByText(/Agent Settings/i).first()).toBeVisible({ timeout: 10000 });
  await expect(page.getByText("github", { exact: true })).toBeVisible({ timeout: 10000 });
  await expect(page.getByRole("button", { name: "Add skills" })).toBeVisible({ timeout: 10000 });
  await page.getByRole("button", { name: "Add skills" }).click();
  await expect(page.getByText("playwright", { exact: true })).toBeVisible({ timeout: 10000 });
  await page.getByRole("button", { name: "Install playwright" }).click();
  await expect(page.getByText("github", { exact: true })).toBeVisible({ timeout: 10000 });
  const removePlaywright = page.getByRole("button", { name: "Remove playwright" });
  await removePlaywright.scrollIntoViewIfNeeded();
  await expect(removePlaywright).toBeVisible({ timeout: 10000 });
});

test("mobile project agent tab reflects the routed agent instance", async ({ page }) => {
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

  await expect(page.getByText("Start chatting with Builder Bot.")).toBeVisible();
  await expect(page.getByPlaceholder("What do you want to create?")).toBeVisible();

  await page.goto("/projects/proj-1/agents/agent-inst-2");
  await expect(page).toHaveURL(/\/projects\/proj-1\/agents\/agent-inst-2$/);
  await expect(page.getByText("Start chatting with Research Bot.")).toBeVisible();
});

test("mobile project agent tab can switch between attached project agents", async ({ page }) => {
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
        machine_type: "remote",
        environment: "cloud",
        auth_source: "aura_managed",
        adapter_type: "aura_harness",
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
        environment: "cloud",
        auth_source: "aura_managed",
        adapter_type: "aura_harness",
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

  await expect(page.getByRole("button", { name: "Switch active project agent from Builder Bot" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Skills" })).toBeVisible();

  await page.getByRole("button", { name: "Switch active project agent from Builder Bot" }).click();
  await expect(page.getByText("Choose who you want to talk to in this project")).toBeVisible({ timeout: 10000 });
  await expect(page.getByRole("button", { name: "Builder Bot, current agent" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Switch to Research Bot" })).toBeVisible();

  await page.getByRole("button", { name: "Switch to Research Bot" }).click();
  await expect(page).toHaveURL(/\/projects\/proj-1\/agents\/agent-inst-2$/);
  await expect(page.getByText("Start chatting with Research Bot.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Switch active project agent from Research Bot" })).toBeVisible();
});

test("mobile global app switcher opens feed and profile", async ({ page }) => {
  await mockAuthenticatedMobileApp(page);
  await page.goto("/projects");

  await openAppSwitcher(page);
  await expect(page.getByRole("button", { name: "Organization" })).toBeVisible();
  await expect(page.getByText("Test Org")).toBeVisible();
  await expect(page.getByRole("button", { name: "Return to project" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Agent library" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Feed" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Profile" })).toBeVisible();

  await page.getByRole("button", { name: "Agent library" }).click();
  await expect(page).toHaveURL(/\/agents$/);
  await expect(page.getByText("Builder Bot")).toBeVisible();
  await expect(page.getByText("Helpful")).toBeVisible();
  await expect(page.getByRole("button", { name: "Create Remote Agent" })).toBeVisible();
  await expect(page.getByPlaceholder("What do you want to create?")).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Primary mobile navigation" })).toHaveCount(0);

  await openAppSwitcher(page);
  await page.getByRole("button", { name: "Feed" }).click();
  await expect(page).toHaveURL(/\/feed$/);
  await expect(page.getByRole("button", { name: "My Agents" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Primary mobile navigation" })).toHaveCount(0);

  await openAppSwitcher(page);
  await page.getByRole("button", { name: "Profile" }).click();
  await expect(page).toHaveURL(/\/profile$/);
  await expect(page.getByRole("button", { name: "All activity" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Demo Project" })).toBeVisible();
});

test("mobile agent library opens a full-page details view and returns to the library", async ({ page }) => {
  await mockAuthenticatedMobileApp(page, {
    agents: [
      {
        agent_id: "agent-1",
        user_id: "user-1",
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
        name: "Research Bot",
        role: "Analyst",
        personality: "Curious",
        system_prompt: "Research carefully.",
        skills: [],
        icon: null,
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
  });
  await page.goto("/agents");

  await expect(page).toHaveURL(/\/agents$/);
  await expect(page.getByText("Builder Bot")).toBeVisible();
  await expect(page.getByRole("button", { name: "Create Remote Agent" })).toBeVisible();

  await page.getByRole("button", { name: /Builder Bot/i }).click();
  await expect(page).toHaveURL(/\/agents\/agent-1$/);
  await expect(page.getByText("Personality")).toBeVisible();
  await expect(page.getByText("Remote Runtime")).toBeVisible();
  await expect(page.getByText("Remote agent is running")).toBeVisible();
  await expect(page.getByText("Installed Skills")).toBeVisible();
  await expect(page.getByRole("button", { name: /github/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /slack/i })).toBeVisible();
  await expect(page.getByText("Build features carefully.")).toBeVisible();

  await page.getByRole("button", { name: "Back to agent library" }).click();
  await expect(page).toHaveURL(/\/agents$/);
  await expect(page.getByText("Personality")).toHaveCount(0);
});

test("mobile agent library opens the shared create agent flow", async ({ page }) => {
  await mockAuthenticatedMobileApp(page, {
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

  await page.goto("/projects");
  await openAppSwitcher(page);
  await page.getByRole("button", { name: "Agent library" }).click();

  await expect(page).toHaveURL(/\/agents$/);
  await expect(page.getByText("Builder Bot")).toBeVisible();
  await expect(page.getByRole("button", { name: "Create Remote Agent" })).toBeVisible();
  await page.getByRole("button", { name: "Create Remote Agent" }).click();

  await expect(page.getByLabel("Name")).toBeVisible();
  await expect(page.getByLabel("Name")).toBeVisible();
  await expect(page.getByLabel("Role")).toBeVisible();
});

test("mobile project create flow stays remote-first while exposing org integrations", async ({ page }) => {
  await mockAuthenticatedMobileApp(page, {
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

  await page.goto("/projects");
  await expect(page.getByPlaceholder("What do you want to create?")).toBeVisible();
  await page.getByRole("button", { name: "Add or create project agent" }).click();

  await expect(page.getByLabel("Name")).toBeVisible();
  await expect(page.getByText("New remote agent")).toBeVisible();
  await expect(page.getByText("Remote cloud", { exact: true })).toBeVisible();
  await expect(page.getByText("Managed by Aura", { exact: true })).toBeVisible();
  await expect(page.getByText("Organization integration")).toHaveCount(0);
});

test("mobile global surfaces use the app switcher to return to project mode", async ({ page }) => {
  await mockAuthenticatedMobileApp(page);
  await page.goto("/feed");

  await openAppSwitcher(page);
  await page.getByRole("button", { name: "Return to project" }).click();

  await expect(page).toHaveURL(/\/projects\/proj-1\/agents\/agent-inst-1$/);
  await expect(page.getByPlaceholder("What do you want to create?")).toBeVisible({ timeout: 10000 });
});

test("mobile files route redirects back to the project agent flow", async ({ page }) => {
  await mockAuthenticatedApp(page, {
    project: {
      project_id: "proj-1",
      org_id: "org-1",
      name: "Imported Project",
      description: "Imported workspace project",
      current_status: "active",
      created_at: "2026-03-17T01:00:00.000Z",
      updated_at: "2026-03-17T01:00:00.000Z",
    },
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
        workspace_path: "/home/aura/imported-project",
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

  await page.goto("/projects/proj-1/files");
  await expect(page).toHaveURL(/\/projects\/proj-1\/agents\/agent-inst-1$/);
  await expect(page.getByPlaceholder("What do you want to create?")).toBeVisible({ timeout: 10000 });
});

test("mobile drawer scales across current, recent, and other projects", async ({ page }) => {
  await mockAuthenticatedMobileApp(page, {
    projects: [
      {
        project_id: "proj-1",
        org_id: "org-1",
        name: "Project Atlas",
        description: "Current project",
        current_status: "active",
        created_at: "2026-03-17T01:00:00.000Z",
        updated_at: "2026-03-17T04:00:00.000Z",
      },
      {
        project_id: "proj-2",
        org_id: "org-1",
        name: "Design System",
        description: "Tokens and shell polish",
        current_status: "active",
        created_at: "2026-03-16T01:00:00.000Z",
        updated_at: "2026-03-17T03:00:00.000Z",
      },
      {
        project_id: "proj-3",
        org_id: "org-1",
        name: "Docs Refresh",
        description: "Onboarding copy",
        current_status: "active",
        created_at: "2026-03-15T01:00:00.000Z",
        updated_at: "2026-03-17T02:00:00.000Z",
      },
      {
        project_id: "proj-4",
        org_id: "org-1",
        name: "Orbit QA",
        description: "Repo workflows",
        current_status: "active",
        created_at: "2026-03-14T01:00:00.000Z",
        updated_at: "2026-03-16T23:00:00.000Z",
      },
    ],
  });

  await page.goto("/projects/proj-1/work");
  await openProjectDrawer(page, "Project Atlas");

  await expect(page.getByText("Current project", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Projects", { exact: true }).first()).toBeVisible();
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
  await expect(page.getByRole("button", { name: "Open Execution" })).toBeVisible();
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
  await expect(projectNavigation.getByText("Open agent", { exact: true })).toBeVisible();
  await expect(page.getByText("Agent & skills", { exact: true })).toBeVisible();
  await expect(projectNavigation.getByRole("button", { name: "Agent", exact: true })).toHaveCount(0);
  await expect(projectNavigation.getByRole("button", { name: "Tasks", exact: true })).toHaveCount(0);
  await expect(projectNavigation.getByRole("button", { name: "Execution", exact: true })).toHaveCount(0);
  await expect(projectNavigation.getByRole("button", { name: "Process", exact: true })).toHaveCount(0);
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
  await expect(page.getByText("Orbit repo")).toBeVisible();
  await expect(page.getByText(/orbit\//i)).toBeVisible();
  await expect(page.getByText("Project path")).toHaveCount(0);
  await expect(page.getByText("Environment")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Create Project", exact: true })).toBeDisabled();
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

test("mobile work view keeps the spec preview path while surfacing the latest task feed entry", async ({ page }) => {
  await mockAuthenticatedMobileApp(page);
  await page.goto("/projects/proj-1/work");

  await expect(page.getByRole("main").getByText("Execution", { exact: true })).toBeVisible({ timeout: 10000 });
  const specButton = page.getByRole("button", { name: "Open spec Mobile parity spec", exact: true });
  await expect(specButton).toBeVisible({ timeout: 10000 });
  await specButton.click();
  await expect(page.getByRole("heading", { name: "Mobile parity" })).toBeVisible();

  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Mobile parity" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Close", exact: true })).toHaveCount(0);
  const taskButton = page.getByRole("button", { name: "Patch auth flow", exact: true });
  await taskButton.scrollIntoViewIfNeeded();
  await expect(taskButton).toBeVisible({ timeout: 10000 });
});

test("mobile account sheet exposes team, host, and app settings", async ({ page }) => {
  await mockAuthenticatedMobileApp(page);
  await page.goto("/projects");

  await openAccountSheet(page);
  await expect(page.getByRole("region", { name: "Organization" })).toBeVisible();
  const orgList = page.getByRole("list", { name: "Organizations" });
  await expect(orgList).toBeVisible();
  await expect(orgList.getByRole("listitem").filter({ hasText: "Test Org" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Team settings" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Host settings" })).toBeVisible();
  await expect(page.getByRole("button", { name: "App settings" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Profile" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Leaderboard" })).toHaveCount(0);
});

test("mobile org switching recovers from a stale project route", async ({ page }) => {
  await mockAuthenticatedMobileApp(page, {
    orgs: [
      {
        org_id: "org-1",
        name: "Test Org",
        owner_user_id: "user-1",
        billing: null,
        github: null,
        created_at: "2026-03-17T01:00:00.000Z",
        updated_at: "2026-03-17T01:00:00.000Z",
      },
      {
        org_id: "org-2",
        name: "Second Org",
        owner_user_id: "user-1",
        billing: null,
        github: null,
        created_at: "2026-03-17T01:00:00.000Z",
        updated_at: "2026-03-17T01:00:00.000Z",
      },
    ],
    projectsByOrgId: {
      "org-1": [
        {
          project_id: "proj-1",
          org_id: "org-1",
          name: "Project Atlas",
          description: "Parity test project",
          current_status: "active",
          created_at: "2026-03-17T01:00:00.000Z",
          updated_at: "2026-03-17T01:00:00.000Z",
        },
      ],
      "org-2": [
        {
          project_id: "proj-2",
          org_id: "org-2",
          name: "Kripto",
          description: "Recovery target",
          current_status: "active",
          created_at: "2026-03-17T01:00:00.000Z",
          updated_at: "2026-03-17T02:00:00.000Z",
        },
      ],
    },
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
        machine_type: "local",
        workspace_path: "/tmp/demo-project",
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
        project_id: "proj-2",
        agent_id: "agent-2",
        name: "Kripto Bot",
        role: "Analyst",
        personality: "Focused",
        system_prompt: "Work carefully.",
        skills: [],
        icon: null,
        machine_type: "local",
        workspace_path: "/tmp/kripto",
        status: "idle",
        current_task_id: null,
        current_session_id: null,
        total_input_tokens: 0,
        total_output_tokens: 0,
        created_at: "2026-03-17T01:00:00.000Z",
        updated_at: "2026-03-17T01:00:00.000Z",
      },
    ],
  });
  await page.goto("/projects/proj-1/work");
  await expect(page).toHaveURL(/\/projects\/proj-1\/work$/);

  await openAppSwitcher(page);
  await page.getByRole("button", { name: "Organization" }).click();
  const orgList = page.getByRole("list", { name: "Organizations" });
  await orgList.getByRole("listitem").filter({ hasText: "Second Org" }).click();

  await expect(page).toHaveURL(/\/projects\/proj-2\/agents\/agent-inst-2$/);
  await expect(page.getByText("Start chatting with Kripto Bot.")).toBeVisible();
});

test("mobile team settings shows an unavailable state when org loading fails", async ({ page }) => {
  await mockAuthenticatedMobileApp(page, { orgsUnavailable: true });
  await page.goto("/projects");

  await openAccountSheet(page);
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
