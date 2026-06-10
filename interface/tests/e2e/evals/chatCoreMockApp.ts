import type { Page } from "@playwright/test";

import type { ChatCoreScenario } from "./helpers";

type JsonRecord = Record<string, unknown>;

export interface ChatCoreMockHarness {
  streamRequests: Array<{
    content?: unknown;
    action?: unknown;
    model?: unknown;
    attachments?: unknown;
    commands?: unknown;
    rawBody: JsonRecord;
  }>;
  agentAttachRequests: Array<{ agentId?: unknown; rawBody: JsonRecord }>;
  agentCreateRequests: Array<{ name?: unknown; machineType?: unknown; rawBody: JsonRecord }>;
  remoteAgentStateRequests: string[];
  unhandledApiRequests: string[];
  historyRequests: string[];
  streamEventTypes: string[];
  getHistorySnapshot: () => JsonRecord[];
  getAttachedAgentsSnapshot: () => JsonRecord[];
}

interface ChatCoreMockOptions {
  startWithAttachedAgent?: boolean;
}

function nowIso(): string {
  return new Date().toISOString();
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

function sseFrame(eventType: string, data: unknown): string {
  return `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
}

function withTimestamps<T extends JsonRecord>(event: T): T {
  return {
    created_at: nowIso(),
    ...event,
  };
}

export async function installChatCoreMockApp(
  page: Page,
  scenario: ChatCoreScenario,
  options: ChatCoreMockOptions = {},
): Promise<ChatCoreMockHarness> {
  await page.unroute("**/api/auth/session");
  await page.unroute("**/api/auth/validate");

  const authSession = {
    user_id: "user-1",
    network_user_id: "user-1",
    profile_id: "profile-1",
    display_name: "Eval User",
    profile_image: "",
    primary_zid: "0://eval-user",
    zero_wallet: "0x123",
    wallets: ["0x123"],
    is_zero_pro: true,
    created_at: nowIso(),
    validated_at: nowIso(),
    access_token: "eval-chat-core-token",
  };

  await page.addInitScript(({ seedSession, seedAgentId, seedAgentInstanceId, seedModel }) => {
    try {
      window.localStorage.setItem("aura-jwt", seedSession.access_token);
      window.localStorage.setItem("aura-session", JSON.stringify(seedSession));
      window.localStorage.setItem("aura-last-app", "projects");
      window.localStorage.setItem(`aura-selected-model:agent:${seedAgentId}`, seedModel);
      window.localStorage.setItem(`aura-selected-model:agent:${seedAgentInstanceId}`, seedModel);
      window.localStorage.setItem(
        "aura:onboarding:user-1",
        JSON.stringify({
          welcomeCompleted: false,
          welcomeSkipped: true,
          checklistDismissed: true,
          checklistTasks: {},
        }),
      );
    } catch {
      /* localStorage may be unavailable in restricted contexts */
    }
  }, {
    seedSession: authSession,
    seedAgentId: scenario.agent.agentId,
    seedAgentInstanceId: scenario.agent.agentInstanceId,
    seedModel: scenario.agent.defaultModel,
  });

  const project = {
    project_id: scenario.project.projectId,
    org_id: scenario.project.orgId,
    name: scenario.project.name,
    description: scenario.project.description,
    current_status: "active",
    build_command: "",
    test_command: "",
    created_at: nowIso(),
    updated_at: nowIso(),
  };
  const agent = {
    agent_id: scenario.agent.agentId,
    org_id: scenario.project.orgId,
    user_id: "user-1",
    name: scenario.agent.name,
    role: scenario.agent.role,
    personality: scenario.agent.personality,
    system_prompt: scenario.agent.systemPrompt,
    skills: [],
    icon: null,
    machine_type: scenario.agent.machineType,
    adapter_type: scenario.agent.adapterType,
    default_model: scenario.agent.defaultModel,
    created_at: nowIso(),
    updated_at: nowIso(),
  };
  const agentInstance = {
    agent_instance_id: scenario.agent.agentInstanceId,
    project_id: scenario.project.projectId,
    agent_id: scenario.agent.agentId,
    name: scenario.agent.name,
    role: scenario.agent.role,
    personality: scenario.agent.personality,
    system_prompt: scenario.agent.systemPrompt,
    skills: [],
    icon: null,
    machine_type: scenario.agent.machineType,
    adapter_type: scenario.agent.adapterType,
    default_model: scenario.agent.defaultModel,
    workspace_path: "/tmp/aura-chat-core-eval",
    status: "idle",
    current_task_id: null,
    current_session_id: "sess-chat-core-1",
    total_input_tokens: 0,
    total_output_tokens: 0,
    created_at: nowIso(),
    updated_at: nowIso(),
  };
  const chatSession = {
    session_id: "sess-chat-core-1",
    agent_instance_id: scenario.agent.agentInstanceId,
    project_id: scenario.project.projectId,
    active_task_id: null,
    tasks_worked: [],
    context_usage_estimate: scenario.verification.expectedContextUtilization,
    total_input_tokens: 96,
    total_output_tokens: 52,
    summary_of_previous_context: "",
    status: "ended",
    model: scenario.turn.expectedModel,
    started_at: nowIso(),
    ended_at: nowIso(),
  };

  let attachedAgentInstances: JsonRecord[] = options.startWithAttachedAgent === false ? [] : [agentInstance];
  let history = scenario.initialHistory.map(withTimestamps);
  const streamRequests: ChatCoreMockHarness["streamRequests"] = [];
  const agentAttachRequests: ChatCoreMockHarness["agentAttachRequests"] = [];
  const agentCreateRequests: ChatCoreMockHarness["agentCreateRequests"] = [];
  const remoteAgentStateRequests: string[] = [];
  const unhandledApiRequests: string[] = [];
  const historyRequests: string[] = [];
  const streamEventTypes: string[] = [];

  const json = (
    route: Parameters<Parameters<Page["route"]>[1]>[0],
    body: unknown,
    status = 200,
  ) =>
    route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(body),
    });

  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    const pathname = url.pathname !== "/" ? url.pathname.replace(/\/+$/, "") : url.pathname;

    if (pathname !== "/api" && !pathname.startsWith("/api/")) {
      return route.fallback();
    }

    if (pathname === "/api/auth/session" || pathname === "/api/auth/validate") return json(route, authSession);
    if (pathname === "/api/auth/ws-ticket" && method === "POST") {
      return json(route, { ticket: "eval-ws-ticket", expires_at: nowIso() });
    }
    if (pathname === "/api/update-status") {
      return json(route, { update: { status: "idle" }, channel: "stable", current_version: "0.0.0" });
    }
    if (pathname === "/api/system/info") {
      return json(route, { version: "0.0.0-eval", environment: "eval" });
    }
    if (pathname === "/api/system/workspace_defaults") {
      return json(route, { workspace_root: "/tmp/aura-chat-core-eval-workspaces" });
    }
    if (pathname === "/api/subscriptions/me") {
      return json(route, { status: "active", plan: "pro" });
    }
    if (pathname === "/api/terminal" && method === "POST") {
      return json(route, { id: "term-chat-core-1", shell: "zsh" }, 201);
    }
    if (pathname === "/api/follows" && method === "GET") {
      return json(route, []);
    }
    if (pathname === "/api/users/me") {
      return json(route, {
        id: "user-1",
        zos_user_id: "user-1",
        display_name: "Eval User",
        avatar_url: null,
        bio: "Chat core eval profile",
        location: "NYC",
        website: "https://example.com",
        profile_id: "profile-1",
        created_at: nowIso(),
        updated_at: nowIso(),
      });
    }
    if (pathname === "/api/users/me/usage") {
      return json(route, { usage: [], limits: {}, credits_remaining: 25_000 });
    }
    if (pathname === "/api/profiles/profile-1/posts") {
      return json(route, { posts: [], next_cursor: null });
    }
    if (pathname === "/api/orgs") {
      return json(route, [{
        org_id: scenario.project.orgId,
        name: "Chat Core Eval Org",
        owner_user_id: "user-1",
        billing: null,
        created_at: nowIso(),
        updated_at: nowIso(),
      }]);
    }
    if (pathname === `/api/orgs/${scenario.project.orgId}`) {
      return json(route, {
        org_id: scenario.project.orgId,
        name: "Chat Core Eval Org",
        owner_user_id: "user-1",
        billing: null,
        created_at: nowIso(),
        updated_at: nowIso(),
      });
    }
    if (pathname === `/api/orgs/${scenario.project.orgId}/members`) {
      return json(route, [{ org_id: scenario.project.orgId, user_id: "user-1", display_name: "Eval User", role: "owner" }]);
    }
    if (pathname === `/api/orgs/${scenario.project.orgId}/credits/balance`) {
      return json(route, { balance_cents: 25_000, plan: "pro", balance_formatted: "$250.00" });
    }
    if (
      pathname === `/api/orgs/${scenario.project.orgId}/invites` ||
      pathname === `/api/orgs/${scenario.project.orgId}/integrations`
    ) {
      return json(route, []);
    }
    if (pathname === `/api/orgs/${scenario.project.orgId}/billing`) {
      return json(route, { billing_email: "billing@example.com", plan: "pro" });
    }
    if (pathname === `/api/orgs/${scenario.project.orgId}/credits/transactions`) {
      return json(route, { transactions: [], has_more: false });
    }

    if (pathname === "/api/projects") return json(route, [project]);
    if (pathname === `/api/projects/${scenario.project.projectId}`) return json(route, project);
    if (pathname === `/api/projects/${scenario.project.projectId}/specs`) return json(route, []);
    if (pathname === `/api/projects/${scenario.project.projectId}/tasks`) return json(route, []);
    if (pathname === `/api/projects/${scenario.project.projectId}/sessions`) {
      return json(route, attachedAgentInstances.length > 0 ? [chatSession] : []);
    }
    if (pathname === `/api/projects/${scenario.project.projectId}/agents` && method === "GET") {
      return json(route, attachedAgentInstances);
    }
    if (pathname === `/api/projects/${scenario.project.projectId}/agents` && method === "POST") {
      const body = parseBody(route);
      agentAttachRequests.push({ agentId: body.agent_id, rawBody: body });
      if (body.agent_id !== scenario.agent.agentId) {
        return json(route, { error: "Unknown agent" }, 404);
      }
      if (!attachedAgentInstances.some((entry) => entry.agent_instance_id === scenario.agent.agentInstanceId)) {
        attachedAgentInstances = [agentInstance];
      }
      return json(route, agentInstance, 201);
    }
    if (pathname === `/api/projects/${scenario.project.projectId}/agents/${scenario.agent.agentInstanceId}`) {
      return json(route, agentInstance);
    }
    if (pathname === `/api/projects/${scenario.project.projectId}/agents/${scenario.agent.agentInstanceId}/sessions`) {
      return json(route, [chatSession]);
    }
    if (pathname === `/api/projects/${scenario.project.projectId}/agents/${scenario.agent.agentInstanceId}/context-usage`) {
      return json(route, {
        context_utilization: scenario.verification.expectedContextUtilization,
        estimated_context_tokens: 148,
      });
    }
    if (pathname === `/api/projects/${scenario.project.projectId}/loop/status`) {
      return json(route, {
        running: false,
        paused: false,
        project_id: scenario.project.projectId,
        active_agent_instances: [],
      });
    }
    if (pathname === "/api/agents" && method === "POST") {
      const body = parseBody(route);
      agentCreateRequests.push({
        name: body.name,
        machineType: body.machine_type,
        rawBody: body,
      });
      return json(route, {
        ...agent,
        name: typeof body.name === "string" ? body.name : agent.name,
        role: typeof body.role === "string" ? body.role : agent.role,
        personality: typeof body.personality === "string" ? body.personality : agent.personality,
        system_prompt: typeof body.system_prompt === "string" ? body.system_prompt : agent.system_prompt,
        machine_type: typeof body.machine_type === "string" ? body.machine_type : agent.machine_type,
        adapter_type: typeof body.adapter_type === "string" ? body.adapter_type : agent.adapter_type,
        environment: body.environment ?? "swarm_microvm",
        permissions: body.permissions ?? null,
      }, 201);
    }
    if (pathname === "/api/agents" && method === "GET") return json(route, [agent]);
    if (pathname === `/api/agents/${scenario.agent.agentId}`) return json(route, agent);
    if (pathname === `/api/agents/${scenario.agent.agentId}/events`) return json(route, []);
    if (pathname === `/api/agents/${scenario.agent.agentId}/projects`) {
      return json(route, [{
        project_agent_id: scenario.agent.agentInstanceId,
        project_id: scenario.project.projectId,
        project_name: scenario.project.name,
      }]);
    }
    if (pathname === `/api/agents/${scenario.agent.agentId}/remote_agent/files` && method === "POST") {
      return json(route, []);
    }
    if (pathname === "/api/agents/harness/setup" && method === "POST") {
      return json(route, { status: "ready", harness_id: "eval-harness" });
    }
    if (pathname === `/api/agents/${scenario.agent.agentId}/remote_agent/state`) {
      remoteAgentStateRequests.push(`${method} ${pathname}`);
      return json(route, {
        agent_id: scenario.agent.agentId,
        state: "running",
        uptime_seconds: 120,
        active_sessions: 0,
        error_message: null,
      });
    }
    if (pathname === "/api/harness/skills") return json(route, []);
    if (pathname === "/api/streams/active") return json(route, []);

    if (
      pathname === `/api/projects/${scenario.project.projectId}/agents/${scenario.agent.agentInstanceId}/events` ||
      pathname === `/api/projects/${scenario.project.projectId}/agents/${scenario.agent.agentInstanceId}/sessions/${chatSession.session_id}/events`
    ) {
      historyRequests.push(`${method} ${pathname}`);
      return json(route, history);
    }

    if (
      pathname === `/api/projects/${scenario.project.projectId}/agents/${scenario.agent.agentInstanceId}/events/stream` &&
      method === "POST"
    ) {
      const body = parseBody(route);
      streamRequests.push({
        content: body.content,
        action: body.action,
        model: body.model,
        attachments: body.attachments,
        commands: body.commands,
        rawBody: body,
      });
      streamEventTypes.push(...scenario.turn.streamEvents.map((entry) => entry.event));
      history = scenario.turn.persistedHistory.map(withTimestamps);
      const responseBody = scenario.turn.streamEvents
        .map((entry) => sseFrame(entry.event, entry.data))
        .join("");
      await new Promise((resolve) => setTimeout(resolve, 150));
      return route.fulfill({
        status: 200,
        contentType: "text/event-stream; charset=utf-8",
        headers: {
          "X-Aura-Session-Id": "sess-chat-core-1",
          "X-Aura-Project-Id": scenario.project.projectId,
        },
        body: responseBody,
      });
    }

    unhandledApiRequests.push(`${method} ${pathname}`);
    return route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ error: `Unhandled chat-core route: ${method} ${pathname}` }),
    });
  });

  return {
    streamRequests,
    agentAttachRequests,
    agentCreateRequests,
    remoteAgentStateRequests,
    unhandledApiRequests,
    historyRequests,
    streamEventTypes,
    getHistorySnapshot: () => history,
    getAttachedAgentsSnapshot: () => attachedAgentInstances,
  };
}
