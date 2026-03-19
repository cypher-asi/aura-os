import type { Page } from "@playwright/test";

interface MockAuthenticatedAppOptions {
  project?: Record<string, unknown>;
  agentInstances?: Record<string, unknown>[];
  agents?: Record<string, unknown>[];
  tasks?: Record<string, unknown>[];
  specs?: Record<string, unknown>[];
  orgsUnavailable?: boolean;
}

export async function mockAuthenticatedApp(page: Page, options: MockAuthenticatedAppOptions = {}) {
  await page.unroute("**/api/auth/session");
  await page.unroute("**/api/auth/validate");

  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const pathname = url.pathname !== "/" ? url.pathname.replace(/\/+$/, "") : url.pathname;
    const path = `${pathname}${url.search}`;

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
      ...options.project,
    };

    const defaultAgentInstance = {
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

    const agentInstances = options.agentInstances ?? [defaultAgentInstance];

    const tasks = options.tasks ?? [
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

    const specs = options.specs ?? [
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

    const agents = options.agents ?? [
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
    if (pathname === "/api/settings/api-key") return json({ has_key: false, source: null });
    if (pathname === "/api/settings/fee-schedule") return json([]);
    if (path === "/api/orgs") {
      if (options.orgsUnavailable) {
        return route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "aura-network is not configured", code: "service_unavailable", details: null }),
        });
      }
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
    if (pathname === "/api/orgs/org-1") {
      return json({
        org_id: "org-1",
        name: "Test Org",
        owner_user_id: "user-1",
        billing: null,
        github: null,
        created_at: "2026-03-17T01:00:00.000Z",
        updated_at: "2026-03-17T01:00:00.000Z",
      });
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
    if (pathname === "/api/projects" && (!url.search || url.search === "?org_id=org-1")) return json([project]);
    if (pathname === `/api/projects/${project.project_id}`) return json(project);
    if (pathname === `/api/projects/${project.project_id}/specs`) return json(specs);
    if (pathname === `/api/projects/${project.project_id}/tasks`) return json(tasks);
    if (pathname === `/api/projects/${project.project_id}/agents`) return json(agentInstances);

    const matchingAgentInstance = agentInstances.find(
      (instance) => pathname === `/api/projects/${project.project_id}/agents/${instance.agent_instance_id}`,
    );
    if (matchingAgentInstance) return json(matchingAgentInstance);

    const matchingAgentInstanceMessages = agentInstances.find(
      (instance) => pathname === `/api/projects/${project.project_id}/agents/${instance.agent_instance_id}/messages`,
    );
    if (matchingAgentInstanceMessages) return json([]);

    const matchingAgentInstanceSessions = agentInstances.find(
      (instance) => pathname === `/api/projects/${project.project_id}/agents/${instance.agent_instance_id}/sessions`,
    );
    if (matchingAgentInstanceSessions) return json([]);

    if (pathname === `/api/projects/${project.project_id}/loop/status`) {
      return json({ running: false, paused: false, project_id: "proj-1", active_agent_instances: [] });
    }
    if (pathname === `/api/projects/${project.project_id}/progress`) {
      return json({
        project_id: project.project_id,
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
    if (pathname === "/api/agents") return json(agents);

    const matchingAgent = agents.find((agent) => pathname === `/api/agents/${agent.agent_id}`);
    if (matchingAgent) return json(matchingAgent);

    const matchingAgentMessages = agents.find((agent) => pathname === `/api/agents/${agent.agent_id}/messages`);
    if (matchingAgentMessages) return json([]);

    return route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ error: `Unhandled route: ${path}` }),
    });
  });
}
