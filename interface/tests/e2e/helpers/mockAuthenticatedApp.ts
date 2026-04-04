import type { Page } from "@playwright/test";

interface MockAuthenticatedAppOptions {
  project?: Record<string, unknown>;
  projects?: Record<string, unknown>[];
  agentInstances?: Record<string, unknown>[];
  agents?: Record<string, unknown>[];
  integrations?: Record<string, unknown>[];
  tasks?: Record<string, unknown>[];
  specs?: Record<string, unknown>[];
  orgsUnavailable?: boolean;
}

const mockProfile = {
  id: "profile-1",
  display_name: "Test User",
  avatar_url: null,
  bio: "Testing shared responsive flows.",
  location: "NYC",
  website: "https://example.com",
  profile_type: "user",
  entity_id: "user-1",
  created_at: "2026-03-17T01:00:00.000Z",
  updated_at: "2026-03-17T01:00:00.000Z",
};

const mockFeedEvents = [
  {
    id: "feed-1",
    profile_id: "profile-1",
    event_type: "commit_push",
    metadata: null,
    created_at: "2026-03-17T01:00:00.000Z",
  },
];

const mockProfilePosts = [
  {
    id: "profile-post-1",
    profile_id: "profile-1",
    event_type: "commit_push",
    post_type: "push",
    title: "Shipped responsive profile polish",
    summary: "Shared summary components now power desktop and mobile profile surfaces.",
    metadata: {
      author_name: "Test User",
      author_type: "user",
      repo: "cypher-asi/demo-project",
      branch: "main",
      commits: [
        { sha: "9f8e7d6", message: "Extract shared profile summary card" },
        { sha: "8e7d6c5", message: "Move comments into a mobile drawer flow" },
      ],
    },
    commit_ids: ["9f8e7d6", "8e7d6c5"],
    created_at: "2026-03-17T04:00:00.000Z",
  },
  {
    id: "profile-post-2",
    profile_id: "profile-1",
    event_type: "status_post",
    post_type: "post",
    title: "Profile polish checkpoint",
    summary: "Desktop-safe extraction is in place and mobile composition is next.",
    metadata: {
      author_name: "Test User",
      author_type: "user",
    },
    commit_ids: [],
    created_at: "2026-03-17T02:00:00.000Z",
  },
];

const initialProfileComments: Record<string, Array<Record<string, unknown>>> = {
  "profile-post-1": [
    {
      id: "profile-comment-1",
      activity_event_id: "profile-post-1",
      profile_id: "Teammate",
      content: "Nice breakdown of the shared pieces.",
      created_at: "2026-03-17T05:00:00.000Z",
    },
  ],
};

const mockLeaderboardEntries = [
  {
    profile_id: "profile-1",
    display_name: "Test User",
    avatar_url: null,
    tokens_used: 1200,
    rank: 1,
    profile_type: "user",
  },
];

export async function mockAuthenticatedApp(page: Page, options: MockAuthenticatedAppOptions = {}) {
  await page.unroute("**/api/auth/session");
  await page.unroute("**/api/auth/validate");
  const profileComments = new Map(
    Object.entries(initialProfileComments).map(([eventId, comments]) => [eventId, [...comments]]),
  );
  const projectStats = {
    total_tasks: 12,
    pending_tasks: 2,
    ready_tasks: 3,
    in_progress_tasks: 2,
    blocked_tasks: 1,
    done_tasks: 3,
    failed_tasks: 1,
    completion_percentage: 58,
    total_tokens: 128_400,
    total_events: 42,
    total_agents: 2,
    total_sessions: 6,
    total_time_seconds: 4_380,
    lines_changed: 1_274,
    total_specs: 4,
    contributors: 3,
    estimated_cost_usd: 7.84,
  };

  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    const pathname = url.pathname !== "/" ? url.pathname.replace(/\/+$/, "") : url.pathname;
    const path = `${pathname}${url.search}`;

    if (pathname !== "/api" && !pathname.startsWith("/api/")) {
      return route.fallback();
    }

    const session = {
      user_id: "user-1",
      display_name: "Test User",
      profile_image: "",
      primary_zid: "0://test-user",
      zero_wallet: "0x123",
      wallets: ["0x123"],
      is_zero_pro: true,
      created_at: "2026-03-17T01:00:00.000Z",
      validated_at: "2026-03-17T01:00:00.000Z",
    };

    const project = {
      project_id: "proj-1",
      org_id: "org-1",
      name: "Demo Project",
      description: "Parity test project",
      current_status: "active",
      created_at: "2026-03-17T01:00:00.000Z",
      updated_at: "2026-03-17T01:00:00.000Z",
      ...options.project,
    };
    const projects = options.projects ?? [project];

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

    const integrations = options.integrations ?? [];

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
    if (pathname === "/api/users/me") {
      return json({
        id: "user-1",
        zos_user_id: "user-1",
        display_name: "Test User",
        avatar_url: null,
        bio: "Testing shared responsive flows.",
        location: "NYC",
        website: "https://example.com",
        profile_id: "profile-1",
        created_at: "2026-03-17T01:00:00.000Z",
        updated_at: "2026-03-17T01:00:00.000Z",
      });
    }
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
    if (path === "/api/orgs/org-1/credits/balance") return json({ balance_cents: 1200, plan: "free", balance_formatted: "$12.00" });
    if (path === "/api/orgs/org-1/invites") return json([]);
    if (path === "/api/orgs/org-1/billing") return json({ billing_email: "billing@example.com", plan: "free" });
    if (path === "/api/orgs/org-1/integrations/github") return json(null);
    if (path === "/api/orgs/org-1/integrations/github/app") return json([]);
    if (path === "/api/orgs/org-1/integrations") return json(integrations);
    if (path === "/api/orgs/org-1/credits/transactions") return json({ transactions: [], has_more: false });
    if (pathname === "/api/projects" && (!url.search || url.search === "?org_id=org-1")) return json(projects);

    const matchingProject = projects.find((candidate) => pathname === `/api/projects/${candidate.project_id}`);
    if (matchingProject) return json(matchingProject);

    const matchingProjectSpecs = projects.find((candidate) => pathname === `/api/projects/${candidate.project_id}/specs`);
    if (matchingProjectSpecs) {
      return json(specs.map((spec) => ({ ...spec, project_id: matchingProjectSpecs.project_id })));
    }

    const matchingProjectTasks = projects.find((candidate) => pathname === `/api/projects/${candidate.project_id}/tasks`);
    if (matchingProjectTasks) {
      return json(tasks.map((task) => ({ ...task, project_id: matchingProjectTasks.project_id })));
    }

    const matchingProjectAgents = projects.find((candidate) => pathname === `/api/projects/${candidate.project_id}/agents`);
    if (matchingProjectAgents) {
      return json(agentInstances.map((agent) => ({ ...agent, project_id: matchingProjectAgents.project_id })));
    }

    const matchingAgentInstance = agentInstances.find(
      (instance) => projects.some((candidate) => pathname === `/api/projects/${candidate.project_id}/agents/${instance.agent_instance_id}`),
    );
    if (matchingAgentInstance) return json(matchingAgentInstance);

    const matchingAgentInstanceMessages = agentInstances.find(
      (instance) => projects.some((candidate) => pathname === `/api/projects/${candidate.project_id}/agents/${instance.agent_instance_id}/messages`),
    );
    if (matchingAgentInstanceMessages) return json([]);

    const matchingAgentInstanceEvents = agentInstances.find(
      (instance) => projects.some((candidate) => pathname === `/api/projects/${candidate.project_id}/agents/${instance.agent_instance_id}/events`),
    );
    if (matchingAgentInstanceEvents) return json([]);

    const matchingAgentInstanceSessions = agentInstances.find(
      (instance) => projects.some((candidate) => pathname === `/api/projects/${candidate.project_id}/agents/${instance.agent_instance_id}/sessions`),
    );
    if (matchingAgentInstanceSessions) return json([]);

    const matchingLoopProject = projects.find((candidate) => pathname === `/api/projects/${candidate.project_id}/loop/status`);
    if (matchingLoopProject) {
      return json({ running: false, paused: false, project_id: "proj-1", active_agent_instances: [] });
    }
    const matchingProgressProject = projects.find((candidate) => pathname === `/api/projects/${candidate.project_id}/progress`);
    if (matchingProgressProject) {
      return json({
        project_id: matchingProgressProject.project_id,
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
    const matchingProjectStats = projects.find((candidate) => pathname === `/api/projects/${candidate.project_id}/stats`);
    if (matchingProjectStats) {
      return json(projectStats);
    }
    if (projects.some((candidate) => pathname === `/api/projects/${candidate.project_id}/start-loop`)) return json({ ok: true });
    if (projects.some((candidate) => pathname === `/api/projects/${candidate.project_id}/pause-loop`)) return json({ ok: true });
    if (projects.some((candidate) => pathname === `/api/projects/${candidate.project_id}/stop-loop`)) return json({ ok: true });
    if (pathname === "/api/log-entries") return json([]);
    if (pathname === "/api/list-directory") {
      const workspaceRoot = typeof agentInstances[0]?.workspace_path === "string" && agentInstances[0].workspace_path.length > 0
        ? agentInstances[0].workspace_path
        : "/tmp/demo-project";
      return json({
        ok: true,
        entries: [
          {
            path: `${workspaceRoot}/src`,
            name: "src",
            is_dir: true,
            children: [
              {
                path: `${workspaceRoot}/src/auth.ts`,
                name: "auth.ts",
                is_dir: false,
              },
            ],
          },
          {
            path: `${workspaceRoot}/README.md`,
            name: "README.md",
            is_dir: false,
          },
        ],
      });
    }
    if (pathname === "/api/read-file") {
      const body = JSON.parse(route.request().postData() || "{}");
      const pathArg = typeof body.path === "string" ? body.path : "";
      if (pathArg.endsWith("README.md")) {
        return json({ ok: true, content: "# Demo Project\n\nPreview the imported snapshot here on mobile.", path: pathArg });
      }
      if (pathArg.endsWith("auth.ts")) {
        return json({ ok: true, content: "export function signIn() {\n  return true;\n}\n", path: pathArg });
      }
      return json({ ok: false, error: "Preview unavailable" });
    }
    if (pathname === "/api/agents") return json(agents);
    if (pathname === "/api/feed") return json(mockFeedEvents);
    if (pathname.startsWith("/api/feed?")) return json(mockFeedEvents);
    if (pathname === "/api/follows") return json([]);
    if (pathname.startsWith("/api/follows/check/")) return json({ following: false });
    if (pathname === "/api/leaderboard" || pathname === "/api/leaderboard/") return json(mockLeaderboardEntries);
    if (pathname === "/api/profiles/profile-1") return json(mockProfile);
    if (pathname === "/api/profiles/profile-1/posts") return json(mockProfilePosts);
    if (pathname.startsWith("/api/posts/") && pathname.endsWith("/comments")) {
      const postId = pathname.split("/")[3] ?? "";
      const comments = profileComments.get(postId) ?? [];
      if (method === "POST") {
        const body = JSON.parse(route.request().postData() || "{}");
        const createdComment = {
          id: `profile-comment-${comments.length + 1}`,
          activity_event_id: postId,
          profile_id: "Test User",
          content: typeof body.content === "string" ? body.content : "",
          created_at: "2026-03-17T06:00:00.000Z",
        };
        profileComments.set(postId, [...comments, createdComment]);
        return json(createdComment);
      }
      return json(comments);
    }
    if (pathname.startsWith("/api/activity/") && pathname.endsWith("/comments")) return json([]);

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
