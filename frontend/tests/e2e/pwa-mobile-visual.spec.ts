import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";

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

async function mockAuthenticatedApp(page: import("@playwright/test").Page) {
  await page.unroute("**/api/auth/session");
  await page.unroute("**/api/auth/validate");

  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const path = `${url.pathname}${url.search}`;

    const session = {
      user_id: "user-1",
      display_name: "Test User",
      profile_image: "",
      primary_zid: "0://test-user",
      zero_wallet: "0x123",
      wallets: ["0x123"],
      created_at: "2026-03-17T01:00:00.000Z",
      validated_at: "2026-03-17T01:00:00.000Z",
    };

    const project = {
      project_id: "proj-1",
      org_id: "org-1",
      name: "Demo Project",
      description: "Parity test project",
      linked_folder_path: "/tmp/demo-project",
      current_status: "active",
      created_at: "2026-03-17T01:00:00.000Z",
      updated_at: "2026-03-17T01:00:00.000Z",
    };

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

    const json = (body: unknown) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(body),
      });

    if (path === "/api/auth/session") return json(session);
    if (path === "/api/auth/validate") return json(session);
    if (path === "/api/update-status") {
      return json({ update: { status: "idle" }, channel: "stable", current_version: "0.0.0" });
    }
    if (path === "/api/orgs") {
      return json([
        {
          org_id: "org-1",
          name: "Test Org",
          owner_user_id: "user-1",
          billing: null,
          github: null,
          created_at: "2026-03-17T01:00:00.000Z",
          updated_at: "2026-03-17T01:00:00.000Z",
        },
      ]);
    }
    if (path === "/api/orgs/org-1/members") {
      return json([
        {
          org_id: "org-1",
          user_id: "user-1",
          display_name: "Test User",
          role: "owner",
          joined_at: "2026-03-17T01:00:00.000Z",
        },
      ]);
    }
    if (path === "/api/orgs/org-1/credits/balance") return json({ total_credits: 1200, purchases: [] });
    if (path === "/api/orgs/org-1/invites") return json([]);
    if (path === "/api/orgs/org-1/billing") return json({ billing_email: "billing@example.com", plan: "free" });
    if (path === "/api/orgs/org-1/integrations/github") return json(null);
    if (path === "/api/orgs/org-1/integrations/github/app") return json([]);
    if (path === "/api/orgs/org-1/credits/tiers") return json([]);
    if (path === "/api/projects" || path === "/api/projects?org_id=org-1") return json([project]);
    if (path === "/api/projects/proj-1") return json(project);
    if (path === "/api/projects/proj-1/specs") return json([]);
    if (path === "/api/projects/proj-1/tasks") return json([]);
    if (path === "/api/projects/proj-1/agents") return json([agentInstance]);
    if (path === "/api/projects/proj-1/agents/agent-inst-1") return json(agentInstance);
    if (path === "/api/projects/proj-1/agents/agent-inst-1/messages") return json([]);
    if (path === "/api/projects/proj-1/agents/agent-inst-1/sessions") return json([]);
    if (path === "/api/projects/proj-1/loop/status") {
      return json({ running: false, paused: false, project_id: "proj-1", active_agent_instances: [] });
    }
    if (path === "/api/projects/proj-1/progress") {
      return json({
        project_id: "proj-1",
        total_tasks: 0,
        pending_tasks: 0,
        ready_tasks: 0,
        in_progress_tasks: 0,
        blocked_tasks: 0,
        done_tasks: 0,
        failed_tasks: 0,
        completion_percentage: 0,
        total_tokens: 0,
        total_cost: 0,
        lines_changed: 0,
        lines_of_code: 0,
        total_commits: 0,
        total_pull_requests: 0,
        total_messages: 0,
        total_agents: 1,
        total_sessions: 0,
        total_tests: 0,
      });
    }
    if (path === "/api/agents") return json(agents);
    if (path === "/api/agents/agent-1") return json(agents[0]);
    if (path === "/api/agents/agent-2") return json(agents[1]);
    if (path === "/api/agents/agent-1/messages") return json([]);
    if (path === "/api/agents/agent-2/messages") return json([]);

    return route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ error: `Unhandled route: ${path}` }),
    });
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

test("capture mobile projects polish screens", async ({ page, browserName }, testInfo) => {
  mkdirSync("test-artifacts/review-shots", { recursive: true });

  await mockAuthenticatedApp(page);

  const projectName = testInfo.project.name.replace(/\s+/g, "-");

  await page.goto("/projects");
  await expect(page.getByText("Pick up work without hunting through the app.")).toBeVisible();
  await page.screenshot({
    path: `test-artifacts/review-shots/${projectName}-${browserName}-projects-root-polished.png`,
    fullPage: true,
  });

  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(page.getByText("No linked projects yet")).toBeVisible({ timeout: 10000 });
  await page.screenshot({
    path: `test-artifacts/review-shots/${projectName}-${browserName}-projects-drawer-polished.png`,
    fullPage: true,
  });
});

test("capture mobile agents polish screen", async ({ page, browserName }, testInfo) => {
  mkdirSync("test-artifacts/review-shots", { recursive: true });

  await mockAuthenticatedApp(page);

  const projectName = testInfo.project.name.replace(/\s+/g, "-");

  await page.goto("/agents/agent-1");
  await expect(page.getByText("Chat with Builder Bot")).toBeVisible();
  await page.screenshot({
    path: `test-artifacts/review-shots/${projectName}-${browserName}-agents-polished.png`,
    fullPage: true,
  });
});
