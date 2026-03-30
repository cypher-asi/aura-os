import type { Page } from "@playwright/test";

import type { WorkflowE2EScenario } from "./helpers";

type JsonRecord = Record<string, unknown>;

interface WorkflowStats {
  total_tasks: number;
  pending_tasks: number;
  ready_tasks: number;
  in_progress_tasks: number;
  blocked_tasks: number;
  done_tasks: number;
  failed_tasks: number;
  completion_percentage: number;
  total_tokens: number;
  total_events: number;
  total_agents: number;
  total_sessions: number;
  total_time_seconds: number;
  lines_changed: number;
  total_specs: number;
  contributors: number;
  estimated_cost_usd: number;
}

interface WorkflowState {
  orgs: JsonRecord[];
  agents: JsonRecord[];
  projects: JsonRecord[];
  agentInstances: JsonRecord[];
  specsByProject: Map<string, JsonRecord[]>;
  tasksByProject: Map<string, JsonRecord[]>;
  taskOutputs: Map<string, JsonRecord>;
  sessionsByAgentInstance: Map<string, JsonRecord[]>;
  statsByProject: Map<string, WorkflowStats>;
  loopStatusByProject: Map<string, JsonRecord>;
  projectFilesByProject: Map<string, Map<string, string>>;
}

function nowIso(): string {
  return new Date().toISOString();
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function parseBody(route: { request(): { postData(): string | null } }): JsonRecord {
  const raw = route.request().postData();
  if (!raw) return {};
  try {
    return JSON.parse(raw) as JsonRecord;
  } catch {
    return {};
  }
}

function createInitialStats(): WorkflowStats {
  return {
    total_tasks: 0,
    pending_tasks: 0,
    ready_tasks: 0,
    in_progress_tasks: 0,
    blocked_tasks: 0,
    done_tasks: 0,
    failed_tasks: 0,
    completion_percentage: 0,
    total_tokens: 0,
    total_events: 0,
    total_agents: 0,
    total_sessions: 0,
    total_time_seconds: 0,
    lines_changed: 0,
    total_specs: 0,
    contributors: 0,
    estimated_cost_usd: 0,
  };
}

function countTaskStatuses(tasks: JsonRecord[]) {
  const summary = {
    pending: 0,
    ready: 0,
    in_progress: 0,
    blocked: 0,
    done: 0,
    failed: 0,
  };

  for (const task of tasks) {
    const status = typeof task.status === "string" ? task.status : "pending";
    if (status in summary) {
      summary[status as keyof typeof summary] += 1;
    }
  }

  return summary;
}

function seedProjectFiles(files: unknown): Map<string, string> {
  const fileMap = new Map<string, string>();
  if (!Array.isArray(files)) return fileMap;
  for (const entry of files) {
    if (!entry || typeof entry !== "object") continue;
    const relativePath = typeof (entry as { relative_path?: unknown }).relative_path === "string"
      ? (entry as { relative_path: string }).relative_path
      : "";
    const encoded = typeof (entry as { contents_base64?: unknown }).contents_base64 === "string"
      ? (entry as { contents_base64: string }).contents_base64
      : "";
    if (!relativePath || !encoded) continue;
    fileMap.set(relativePath, Buffer.from(encoded, "base64").toString("utf8"));
  }
  return fileMap;
}

export async function installWorkflowMockApp(page: Page, scenario: WorkflowE2EScenario) {
  await page.unroute("**/api/auth/session");
  await page.unroute("**/api/auth/validate");

  const session = {
    user_id: "user-1",
    display_name: "Eval User",
    profile_image: "",
    primary_zid: "0://eval-user",
    zero_wallet: "0x123",
    wallets: ["0x123"],
    is_zero_pro: true,
    created_at: nowIso(),
    validated_at: nowIso(),
  };

  const mockProfile = {
    id: "profile-1",
    display_name: "Eval User",
    avatar_url: null,
    bio: "Workflow eval profile",
    location: "NYC",
    website: "https://example.com",
    profile_type: "user",
    entity_id: "user-1",
    created_at: nowIso(),
    updated_at: nowIso(),
  };

  let orgCounter = 1;
  let agentCounter = 1;
  let projectCounter = 1;
  let instanceCounter = 1;
  let specCounter = 1;
  let taskCounter = 1;
  let sessionCounter = 1;

  const state: WorkflowState = {
    orgs: [],
    agents: [],
    projects: [],
    agentInstances: [],
    specsByProject: new Map(),
    tasksByProject: new Map(),
    taskOutputs: new Map(),
    sessionsByAgentInstance: new Map(),
    statsByProject: new Map(),
    loopStatusByProject: new Map(),
    projectFilesByProject: new Map(),
  };

  const json = (route: Parameters<Page["route"]>[1] extends (route: infer T) => unknown ? T : never, body: unknown, status = 200) =>
    route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(body),
    });

  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    const pathname = url.pathname !== "/" ? url.pathname.replace(/\/+$/, "") : url.pathname;
    const search = url.searchParams;
    const body = parseBody(route);

    if (pathname === "/api/auth/session" || pathname === "/api/auth/validate") {
      return json(route, session);
    }

    if (pathname === "/api/update-status") {
      return json(route, { update: { status: "idle" }, channel: "stable", current_version: "0.0.0" });
    }

    if (pathname === "/api/users/me") {
      return json(route, {
        id: "user-1",
        zos_user_id: "user-1",
        display_name: "Eval User",
        avatar_url: null,
        bio: "Workflow eval profile",
        location: "NYC",
        website: "https://example.com",
        profile_id: "profile-1",
        created_at: nowIso(),
        updated_at: nowIso(),
      });
    }

    if (pathname === "/api/orgs" && method === "GET") {
      return json(route, state.orgs);
    }

    if (pathname === "/api/orgs" && method === "POST") {
      const orgName = typeof body.name === "string" ? body.name : `Workflow Org ${orgCounter}`;
      const org = {
        org_id: `org-${orgCounter++}`,
        name: orgName,
        owner_user_id: "user-1",
        billing: null,
        created_at: nowIso(),
        updated_at: nowIso(),
      };
      state.orgs.push(org);
      return json(route, org, 201);
    }

    const orgMatch = pathname.match(/^\/api\/orgs\/([^/]+)$/);
    if (orgMatch) {
      const org = state.orgs.find((entry) => entry.org_id === orgMatch[1]);
      return json(route, org ?? {});
    }

    const orgMembersMatch = pathname.match(/^\/api\/orgs\/([^/]+)\/members$/);
    if (orgMembersMatch) {
      return json(route, [{
        org_id: orgMembersMatch[1],
        user_id: "user-1",
        display_name: "Eval User",
        role: "owner",
        joined_at: nowIso(),
      }]);
    }

    const orgCreditsMatch = pathname.match(/^\/api\/orgs\/([^/]+)\/credits\/balance$/);
    if (orgCreditsMatch) {
      return json(route, { balance_cents: 25_000, plan: "pro", balance_formatted: "$250.00" });
    }

    const orgInvitesMatch = pathname.match(/^\/api\/orgs\/([^/]+)\/invites$/);
    if (orgInvitesMatch) return json(route, []);

    const orgBillingMatch = pathname.match(/^\/api\/orgs\/([^/]+)\/billing$/);
    if (orgBillingMatch) return json(route, { billing_email: "billing@example.com", plan: "pro" });

    const orgTransactionsMatch = pathname.match(/^\/api\/orgs\/([^/]+)\/credits\/transactions$/);
    if (orgTransactionsMatch) return json(route, { transactions: [], has_more: false });

    if (pathname === "/api/agents" && method === "GET") {
      return json(route, state.agents);
    }

    if (pathname === "/api/agents" && method === "POST") {
      const agent = {
        agent_id: `agent-${agentCounter++}`,
        user_id: "user-1",
        name: typeof body.name === "string" ? body.name : scenario.agentTemplate.name,
        role: typeof body.role === "string" ? body.role : scenario.agentTemplate.role,
        personality: typeof body.personality === "string" ? body.personality : scenario.agentTemplate.personality,
        system_prompt: typeof body.system_prompt === "string" ? body.system_prompt : scenario.agentTemplate.systemPrompt,
        skills: [],
        icon: null,
        machine_type: typeof body.machine_type === "string" ? body.machine_type : "local",
        created_at: nowIso(),
        updated_at: nowIso(),
      };
      state.agents.push(agent);
      return json(route, agent, 201);
    }

    const agentMatch = pathname.match(/^\/api\/agents\/([^/]+)$/);
    if (agentMatch) {
      const agent = state.agents.find((entry) => entry.agent_id === agentMatch[1]);
      return json(route, agent ?? {});
    }

    if (pathname === "/api/projects" && method === "GET") {
      const orgId = search.get("org_id");
      const projects = orgId
        ? state.projects.filter((project) => project.org_id === orgId)
        : state.projects;
      return json(route, projects);
    }

    const createProject = (imported: boolean) => {
      const projectId = `proj-${projectCounter++}`;
      const name = typeof body.name === "string" ? body.name : scenario.project.name;
      const project = {
        project_id: projectId,
        org_id: typeof body.org_id === "string" ? body.org_id : state.orgs[0]?.org_id ?? "org-1",
        name,
        description: typeof body.description === "string" ? body.description : scenario.project.description,
        linked_folder_path: `/tmp/${slugify(name) || projectId}`,
        workspace_source: imported ? "imported" : "local",
        workspace_display_path: imported ? "Imported project files" : undefined,
        current_status: "active",
        build_command: typeof body.build_command === "string" ? body.build_command : scenario.project.buildCommand,
        test_command: typeof body.test_command === "string" ? body.test_command : scenario.project.testCommand,
        created_at: nowIso(),
        updated_at: nowIso(),
      };
      state.projects.push(project);
      state.specsByProject.set(projectId, []);
      state.tasksByProject.set(projectId, []);
      state.statsByProject.set(projectId, createInitialStats());
      state.loopStatusByProject.set(projectId, {
        running: false,
        paused: false,
        project_id: projectId,
        active_agent_instances: [],
      });
      state.projectFilesByProject.set(projectId, seedProjectFiles(body.files));
      return project;
    };

    if (pathname === "/api/projects/import" && method === "POST") {
      return json(route, createProject(true), 201);
    }

    if (pathname === "/api/projects" && method === "POST") {
      return json(route, createProject(false), 201);
    }

    const projectMatch = pathname.match(/^\/api\/projects\/([^/]+)$/);
    if (projectMatch) {
      const project = state.projects.find((entry) => entry.project_id === projectMatch[1]);
      return json(route, project ?? {});
    }

    const projectAgentsMatch = pathname.match(/^\/api\/projects\/([^/]+)\/agents$/);
    if (projectAgentsMatch && method === "GET") {
      const [projectId] = projectAgentsMatch.slice(1);
      return json(route, state.agentInstances.filter((entry) => entry.project_id === projectId));
    }

    if (projectAgentsMatch && method === "POST") {
      const [projectId] = projectAgentsMatch.slice(1);
      const agentId = typeof body.agent_id === "string" ? body.agent_id : state.agents[0]?.agent_id;
      const template = state.agents.find((entry) => entry.agent_id === agentId);
      const instance = {
        agent_instance_id: `agent-inst-${instanceCounter++}`,
        project_id: projectId,
        agent_id: template?.agent_id ?? "agent-1",
        name: template?.name ?? scenario.agentTemplate.name,
        role: template?.role ?? scenario.agentTemplate.role,
        personality: template?.personality ?? scenario.agentTemplate.personality,
        system_prompt: template?.system_prompt ?? scenario.agentTemplate.systemPrompt,
        skills: [],
        icon: null,
        machine_type: template?.machine_type ?? "local",
        status: "idle",
        current_task_id: null,
        current_session_id: null,
        total_input_tokens: 0,
        total_output_tokens: 0,
        created_at: nowIso(),
        updated_at: nowIso(),
      };
      state.agentInstances.push(instance);
      const stats = state.statsByProject.get(projectId);
      if (stats) {
        stats.total_agents = state.agentInstances.filter((entry) => entry.project_id === projectId).length;
      }
      return json(route, instance, 201);
    }

    const agentInstanceMatch = pathname.match(/^\/api\/projects\/([^/]+)\/agents\/([^/]+)$/);
    if (agentInstanceMatch) {
      const [, projectId, agentInstanceId] = agentInstanceMatch;
      const agentInstance = state.agentInstances.find(
        (entry) => entry.project_id === projectId && entry.agent_instance_id === agentInstanceId,
      );
      return json(route, agentInstance ?? {});
    }

    const sessionsMatch = pathname.match(/^\/api\/projects\/([^/]+)\/agents\/([^/]+)\/sessions$/);
    if (sessionsMatch) {
      const [, , agentInstanceId] = sessionsMatch;
      return json(route, state.sessionsByAgentInstance.get(agentInstanceId) ?? []);
    }

    const specsMatch = pathname.match(/^\/api\/projects\/([^/]+)\/specs$/);
    if (specsMatch && method === "GET") {
      return json(route, state.specsByProject.get(specsMatch[1]) ?? []);
    }

    const generateSpecsMatch = pathname.match(/^\/api\/projects\/([^/]+)\/specs\/generate$/);
    if (generateSpecsMatch && method === "POST") {
      const [projectId] = generateSpecsMatch.slice(1);
      const specs = [{
        spec_id: `spec-${specCounter++}`,
        project_id: projectId,
        title: scenario.generatedSpec.title,
        markdown_contents: `# ${scenario.generatedSpec.title}\n\nCreate the requested benchmark app.`,
        order_index: 0,
        created_at: nowIso(),
        updated_at: nowIso(),
      }];
      state.specsByProject.set(projectId, specs);
      const stats = state.statsByProject.get(projectId);
      if (stats) stats.total_specs = specs.length;
      return json(route, specs);
    }

    const tasksMatch = pathname.match(/^\/api\/projects\/([^/]+)\/tasks$/);
    if (tasksMatch && method === "GET") {
      return json(route, state.tasksByProject.get(tasksMatch[1]) ?? []);
    }

    const extractTasksMatch = pathname.match(/^\/api\/projects\/([^/]+)\/tasks\/extract$/);
    if (extractTasksMatch && method === "POST") {
      const [projectId] = extractTasksMatch.slice(1);
      const firstSpec = state.specsByProject.get(projectId)?.[0];
      const tasks = scenario.extractedTasks.map((task, index) => ({
        task_id: `task-${taskCounter++}`,
        project_id: projectId,
        spec_id: typeof firstSpec?.spec_id === "string" ? firstSpec.spec_id : "spec-1",
        dependency_ids: [],
        parent_task_id: null,
        session_id: null,
        user_id: "user-1",
        assigned_agent_instance_id: state.agentInstances.find((entry) => entry.project_id === projectId)?.agent_instance_id ?? null,
        completed_by_agent_instance_id: null,
        title: task.title,
        description: task.description,
        status: "ready",
        execution_notes: "",
        files_changed: [],
        build_steps: [],
        test_steps: [],
        order_index: index,
        total_input_tokens: 0,
        total_output_tokens: 0,
        model: "gpt-5.4",
        live_output: "",
        created_at: nowIso(),
        updated_at: nowIso(),
      }));
      state.tasksByProject.set(projectId, tasks);
      const counts = countTaskStatuses(tasks);
      const stats = state.statsByProject.get(projectId);
      if (stats) {
        stats.total_tasks = tasks.length;
        stats.pending_tasks = counts.pending;
        stats.ready_tasks = counts.ready;
        stats.in_progress_tasks = counts.in_progress;
        stats.blocked_tasks = counts.blocked;
        stats.done_tasks = counts.done;
        stats.failed_tasks = counts.failed;
        stats.completion_percentage = 0;
      }
      return json(route, tasks);
    }

    const taskOutputMatch = pathname.match(/^\/api\/projects\/([^/]+)\/tasks\/([^/]+)\/output$/);
    if (taskOutputMatch) {
      const [, , taskId] = taskOutputMatch;
      return json(route, state.taskOutputs.get(taskId) ?? { output: "", build_steps: [], test_steps: [] });
    }

    const loopStatusMatch = pathname.match(/^\/api\/projects\/([^/]+)\/loop\/status$/);
    if (loopStatusMatch) {
      return json(route, state.loopStatusByProject.get(loopStatusMatch[1]) ?? {
        running: false,
        paused: false,
        project_id: loopStatusMatch[1],
        active_agent_instances: [],
      });
    }

    const loopStartMatch = pathname.match(/^\/api\/projects\/([^/]+)\/loop\/start$/);
    if (loopStartMatch && method === "POST") {
      const [projectId] = loopStartMatch.slice(1);
      const agentInstanceId = search.get("agent_instance_id")
        ?? state.agentInstances.find((entry) => entry.project_id === projectId)?.agent_instance_id
        ?? null;
      const tasks = state.tasksByProject.get(projectId) ?? [];
      const sessionId = `sess-${sessionCounter++}`;
      const updatedTasks = tasks.map((task, index) => {
        const buildSteps = index === 0
          ? [{ kind: "command", command: scenario.project.buildCommand, stdout: "Build completed successfully.", attempt: 1 }]
          : [];
        const testSteps = index === tasks.length - 1
          ? [{
              kind: "command",
              command: scenario.project.testCommand,
              stdout: "All tests passed.",
              attempt: 1,
              tests: [{ name: "fixture validation", status: "passed" }],
              summary: "1 passed",
            }]
          : [];
        state.taskOutputs.set(task.task_id as string, {
          output: [
            `Completed task: ${task.title as string}`,
            ...scenario.verification.taskOutputContains,
          ].join("\n"),
          build_steps: buildSteps,
          test_steps: testSteps,
        });
        return {
          ...task,
          status: "done",
          completed_by_agent_instance_id: agentInstanceId,
          session_id: sessionId,
          build_steps: buildSteps,
          test_steps: testSteps,
          total_input_tokens: 320 + index * 20,
          total_output_tokens: 180 + index * 15,
          live_output: "",
          updated_at: nowIso(),
        };
      });
      state.tasksByProject.set(projectId, updatedTasks);
      const stats = state.statsByProject.get(projectId);
      if (stats) {
        stats.total_tasks = updatedTasks.length;
        stats.pending_tasks = 0;
        stats.ready_tasks = 0;
        stats.in_progress_tasks = 0;
        stats.blocked_tasks = 0;
        stats.done_tasks = updatedTasks.length;
        stats.failed_tasks = 0;
        stats.completion_percentage = 100;
        stats.total_tokens = updatedTasks.reduce(
          (sum, task) => sum + Number(task.total_input_tokens) + Number(task.total_output_tokens),
          0,
        );
        stats.total_events = 12;
        stats.total_agents = state.agentInstances.filter((entry) => entry.project_id === projectId).length;
        stats.total_sessions = 1;
        stats.total_time_seconds = 42;
        stats.lines_changed = 24;
        stats.total_specs = state.specsByProject.get(projectId)?.length ?? 0;
        stats.contributors = 1;
        stats.estimated_cost_usd = 0.12;
      }
      if (agentInstanceId) {
        const agentInstance = state.agentInstances.find((entry) => entry.agent_instance_id === agentInstanceId);
        if (agentInstance) {
          agentInstance.status = "idle";
          agentInstance.current_session_id = sessionId;
          agentInstance.total_input_tokens = updatedTasks.reduce((sum, task) => sum + Number(task.total_input_tokens), 0);
          agentInstance.total_output_tokens = updatedTasks.reduce((sum, task) => sum + Number(task.total_output_tokens), 0);
          agentInstance.updated_at = nowIso();
        }
        state.sessionsByAgentInstance.set(agentInstanceId, [{
          session_id: sessionId,
          agent_instance_id: agentInstanceId,
          project_id: projectId,
          active_task_id: null,
          tasks_worked: updatedTasks.map((task) => task.task_id),
          context_usage_estimate: 0.21,
          total_input_tokens: updatedTasks.reduce((sum, task) => sum + Number(task.total_input_tokens), 0),
          total_output_tokens: updatedTasks.reduce((sum, task) => sum + Number(task.total_output_tokens), 0),
          summary_of_previous_context: "",
          status: "ended",
          started_at: nowIso(),
          ended_at: nowIso(),
        }]);
      }
      const nextLoopStatus = {
        running: false,
        paused: false,
        project_id: projectId,
        active_agent_instances: [],
      };
      state.loopStatusByProject.set(projectId, nextLoopStatus);
      return json(route, nextLoopStatus);
    }

    const loopPauseMatch = pathname.match(/^\/api\/projects\/([^/]+)\/loop\/pause$/);
    if (loopPauseMatch && method === "POST") {
      const paused = {
        running: false,
        paused: true,
        project_id: loopPauseMatch[1],
        active_agent_instances: [],
      };
      state.loopStatusByProject.set(loopPauseMatch[1], paused);
      return json(route, paused);
    }

    const loopStopMatch = pathname.match(/^\/api\/projects\/([^/]+)\/loop\/stop$/);
    if (loopStopMatch && method === "POST") {
      const stopped = {
        running: false,
        paused: false,
        project_id: loopStopMatch[1],
        active_agent_instances: [],
      };
      state.loopStatusByProject.set(loopStopMatch[1], stopped);
      return json(route, stopped);
    }

    const statsMatch = pathname.match(/^\/api\/projects\/([^/]+)\/stats$/);
    if (statsMatch) {
      return json(route, state.statsByProject.get(statsMatch[1]) ?? createInitialStats());
    }

    if (pathname === "/api/log-entries") return json(route, []);
    if (pathname === "/api/feed") return json(route, []);
    if (pathname === "/api/follows") return json(route, []);
    if (pathname.startsWith("/api/follows/check/")) return json(route, { following: false });
    if (pathname === "/api/leaderboard") return json(route, []);
    if (pathname === "/api/profiles/profile-1") return json(route, mockProfile);
    if (pathname === "/api/profiles/profile-1/posts") return json(route, []);

    if (pathname === "/api/list-directory") {
      const projectId = state.projects[0]?.project_id;
      const files = projectId ? state.projectFilesByProject.get(projectId) : null;
      const entries = files
        ? Array.from(files.keys()).map((relativePath) => ({
            path: `/tmp/${relativePath}`,
            name: relativePath.split("/").pop() ?? relativePath,
            is_dir: false,
          }))
        : [];
      return json(route, { ok: true, entries });
    }

    if (pathname === "/api/read-file") {
      const requestedPath = typeof body.path === "string" ? body.path : "";
      const projectFiles = state.projectFilesByProject.get(state.projects[0]?.project_id ?? "");
      const match = Array.from(projectFiles?.entries() ?? []).find(([relativePath]) => requestedPath.endsWith(relativePath));
      if (match) {
        return json(route, { ok: true, content: match[1], path: requestedPath });
      }
      return json(route, { ok: false, error: "Preview unavailable" });
    }

    return route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ error: `Unhandled route: ${pathname}` }),
    });
  });

  return {
    getStateSnapshot() {
      return {
        orgs: state.orgs,
        agents: state.agents,
        projects: state.projects,
        agentInstances: state.agentInstances,
        specsByProject: Object.fromEntries(state.specsByProject.entries()),
        tasksByProject: Object.fromEntries(state.tasksByProject.entries()),
        statsByProject: Object.fromEntries(state.statsByProject.entries()),
      };
    },
  };
}

export async function browserApiFetch<T>(
  page: Page,
  method: "GET" | "POST",
  url: string,
  body?: unknown,
): Promise<T> {
  return page.evaluate(
    async ({ method, url, body }) => {
      const response = await fetch(url, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const text = await response.text();
      if (!response.ok) {
        throw new Error(`${method} ${url} failed with ${response.status}: ${text}`);
      }
      return text ? JSON.parse(text) : null;
    },
    { method, url, body },
  ) as Promise<T>;
}
