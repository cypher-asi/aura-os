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

  await expect(page.getByRole("tree", { name: "Projects" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Search" })).toBeVisible();
  await expect(page.getByPlaceholder("What do you want to create?")).toBeVisible();
  await expect(page.getByRole("button", { name: "Open navigation" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Open host settings" })).toBeVisible();
});

test("desktop direct mobile organization route redirects back to projects", async ({ page }) => {
  await mockAuthenticatedApp(page);

  await page.goto("/projects/organization");

  await expect(page).not.toHaveURL(/\/projects\/organization$/);
  await expect(page.getByRole("tree", { name: "Projects" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Pick Up Remote Work" })).toHaveCount(0);
});

test("desktop browser project execution keeps desktop chrome and hides workspace-only files tab", async ({ page }) => {
  await mockAuthenticatedApp(page);

  await page.goto("/projects/proj-1/work");

  await expect(page.getByText("Demo Project")).toBeVisible();
  await expect(page.getByRole("button", { name: "Chat" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Specs" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Tasks" }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Files" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Open navigation" })).toHaveCount(0);
});

test("desktop browser agents route keeps desktop layout without mobile switcher", async ({ page }) => {
  await mockAuthenticatedApp(page);

  await page.goto("/agents/agent-1");

  await expect(page.getByRole("textbox", { name: "Search" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Choose agent" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Builder Bot/i }).first()).toBeVisible();
  await expect(page.getByRole("paragraph").filter({ hasText: "Helpful" })).toBeVisible();
  await expect(page.getByPlaceholder("What do you want to create?")).toBeVisible();
  await expect(page.getByRole("button", { name: "Open navigation" })).toHaveCount(0);
});

test("desktop project agent chat does not render the mobile project-agent switcher", async ({ page }) => {
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

  await expect(page.getByRole("button", { name: "Switch active project agent from Builder Bot" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Skills" })).toHaveCount(0);
  await expect(page.getByText("Remote agent chat")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Open navigation" })).toHaveCount(0);
});

test("desktop browser tasks route keeps the desktop kanban layout", async ({ page }) => {
  await mockAuthenticatedApp(page);

  await page.goto("/tasks/proj-1/agents/agent-inst-1");

  await expect(page.getByText("Backlog")).toBeVisible();
  await expect(page.getByText("Ready")).toBeVisible();
  await expect(page.getByRole("button", { name: /Builder Bot Patch auth flow/i })).toBeVisible();
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
        workspace_path: null,
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

  await page.goto("/projects/proj-1/execution");

  await expect(page.getByRole("button", { name: "Files" })).toHaveCount(0);
});
