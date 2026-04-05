#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const apiBaseUrl = requiredEnv("AURA_MCP_API_BASE_URL");
const projectId = requiredEnv("AURA_MCP_PROJECT_ID");
const jwt = requiredEnv("AURA_MCP_JWT");
const orgId = optionalEnv("AURA_MCP_ORG_ID");
const integrationSecretsById = (() => {
  const raw = optionalEnv("AURA_MCP_INTEGRATION_SECRETS_JSON");
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
})();
const currentDir = path.dirname(fileURLToPath(import.meta.url));
const sharedProjectTools = JSON.parse(
  fs.readFileSync(path.resolve(currentDir, "../../infra/shared/project-control-plane-tools.json"), "utf8"),
);
const appProviderTools = JSON.parse(
  fs.readFileSync(path.resolve(currentDir, "../../infra/shared/org-integration-tools.json"), "utf8"),
);
const allSharedTools = [...sharedProjectTools, ...appProviderTools];
let orgIntegrationsPromise;
let dynamicMcpRegistryPromise;

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optionalEnv(name) {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

async function api(path, init = {}) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${jwt}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${text}`.trim());
  }

  return text ? JSON.parse(text) : null;
}

async function getOrgIntegrations() {
  if (!orgId) {
    return [];
  }
  if (!orgIntegrationsPromise) {
    orgIntegrationsPromise = api(`/api/orgs/${orgId}/integrations`);
  }
  const integrations = await orgIntegrationsPromise;
  return Array.isArray(integrations) ? integrations : [];
}

function configObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function expandTemplateString(value) {
  return String(value).replace(/\$\{([A-Z0-9_]+)\}/g, (match, name) => process.env[name] ?? match);
}

function expandConfigTemplates(value) {
  if (typeof value === "string") {
    return expandTemplateString(value);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => expandConfigTemplates(entry));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, expandConfigTemplates(entry)]),
    );
  }
  return value;
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "mcp";
}

function normalizeArgs(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item));
  }
  if (typeof value === "string" && value.trim()) {
    return value.trim().split(/\s+/);
  }
  return [];
}

function transportKind(config) {
  const transport = String(config.transport ?? "").trim().toLowerCase();
  if (transport === "http" || transport === "streamable_http") return "http";
  if (transport === "stdio") return "stdio";
  return null;
}

async function getDynamicMcpRegistry() {
  if (!orgId) {
    return { tools: [], toolEntries: new Map(), transports: [] };
  }
  if (!dynamicMcpRegistryPromise) {
    dynamicMcpRegistryPromise = buildDynamicMcpRegistry();
  }
  return dynamicMcpRegistryPromise;
}

async function listSavedMcpServers() {
  const integrations = await getOrgIntegrations();
  return integrations.filter((integration) => {
    if (integration?.kind !== "mcp_server") return false;
    const config = configObject(integration.provider_config);
    return transportKind(config) === "http"
      ? typeof config.url === "string" && config.url.trim().length > 0
      : transportKind(config) === "stdio"
        ? typeof config.command === "string" && config.command.trim().length > 0
        : false;
  });
}

async function connectDynamicMcpServer(integration) {
  const config = configObject(expandConfigTemplates(integration.provider_config));
  const transport = transportKind(config);
  if (!transport) {
    throw new Error(`Unsupported MCP transport for ${integration.name}`);
  }

  const client = new Client({
    name: "aura-control-plane-sidecar",
    version: "0.1.0",
  });

  let clientTransport;
  if (transport === "http") {
    const headers = {};
    const secret = integrationSecretsById[integration.integration_id];
    if (typeof secret === "string" && secret.trim()) {
      headers.Authorization = `Bearer ${secret.trim()}`;
    }
    clientTransport = new StreamableHTTPClientTransport(new URL(String(config.url)), {
      requestInit: Object.keys(headers).length > 0 ? { headers } : undefined,
    });
  } else {
    const env = configObject(config.env);
    const secret = integrationSecretsById[integration.integration_id];
    if (typeof secret === "string" && secret.trim() && typeof config.secretEnvVar === "string" && config.secretEnvVar.trim()) {
      env[config.secretEnvVar.trim()] = secret.trim();
    }
    clientTransport = new StdioClientTransport({
      command: String(config.command),
      args: normalizeArgs(config.args),
      cwd: typeof config.cwd === "string" && config.cwd.trim() ? config.cwd.trim() : undefined,
      env,
      stderr: "pipe",
    });
  }

  await client.connect(clientTransport);
  const result = await client.listTools();
  return { client, transport: clientTransport, tools: result.tools };
}

async function buildDynamicMcpRegistry() {
  const integrations = await listSavedMcpServers();
  const toolEntries = new Map();
  const tools = [];
  const clients = [];
  const transports = [];

  for (const integration of integrations) {
    try {
      const { client, transport, tools: discoveredTools } = await connectDynamicMcpServer(integration);
      clients.push(client);
      transports.push(transport);
      const prefix = `mcp_${slugify(integration.integration_id)}`;

      for (const tool of discoveredTools) {
        const namespacedName = `${prefix}__${tool.name}`;
        if (toolEntries.has(namespacedName)) continue;
        toolEntries.set(namespacedName, {
          client,
          originalName: tool.name,
          integrationId: integration.integration_id,
          integrationName: integration.name,
        });
        tools.push({
          name: namespacedName,
          description: `[${integration.name}] ${tool.description ?? tool.name}`,
          inputSchema: tool.inputSchema ?? { type: "object", additionalProperties: true },
          source: "mcp",
          integration_id: integration.integration_id,
        });
      }
    } catch (error) {
      process.stderr.write(
        `[aura-control-plane-mcp] Skipping MCP server ${integration.name}: ${error instanceof Error ? error.message : String(error)}\n`,
      );
    }
  }

  return { tools, toolEntries, clients, transports };
}

async function dynamicMcpTools() {
  const registry = await getDynamicMcpRegistry();
  return registry.tools;
}

async function callDynamicMcpTool(toolName, args = {}) {
  const registry = await getDynamicMcpRegistry();
  const entry = registry.toolEntries.get(toolName);
  if (!entry) {
    throw new Error(`Unknown dynamic MCP tool: ${toolName}`);
  }
  return entry.client.callTool({
    name: entry.originalName,
    arguments: args,
  });
}

async function availableAppProviderTools() {
  if (!orgId) {
    return [];
  }
  const integrations = await getOrgIntegrations();
  const availableProviders = new Set(
    integrations
      .filter((integration) => integration?.has_secret && integration?.kind === "workspace_integration")
      .map((integration) => integration.provider)
      .filter((provider) => typeof provider === "string" && provider),
  );
  return appProviderTools.filter((tool) => !tool.provider || availableProviders.has(tool.provider));
}

async function callAppProviderTool(toolName, args = {}) {
  if (!orgId) {
    throw new Error(`${toolName} requires AURA_MCP_ORG_ID to be set by the Aura OS server`);
  }
  return api(`/api/orgs/${orgId}/tool-actions/${toolName}`, {
    method: "POST",
    body: JSON.stringify(args),
  });
}

function normalizeMarkdownContents(args) {
  const markdownContents = args?.markdown_contents ?? args?.markdownContents;
  if (typeof markdownContents !== "string" || !markdownContents.trim()) {
    throw new Error("create_spec requires a non-empty markdownContents string");
  }
  return markdownContents.trim();
}

function normalizeTitle(args) {
  const title = args?.title;
  if (typeof title !== "string" || !title.trim()) {
    throw new Error("create_spec requires a non-empty title string");
  }
  return title.trim();
}

function optionalTrimmedString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

async function nextOrderIndex() {
  const specs = await api(`/api/projects/${projectId}/specs`);
  if (!Array.isArray(specs) || specs.length === 0) {
    return 0;
  }
  return Math.max(
    ...specs.map((spec) => (typeof spec?.order_index === "number" ? spec.order_index : 0)),
  ) + 1;
}

function normalizeSpecId(args) {
  const specId = args?.spec_id ?? args?.specId;
  if (typeof specId !== "string" || !specId.trim()) {
    throw new Error("tool requires a non-empty spec_id string");
  }
  return specId.trim();
}

function normalizeDescription(args) {
  const description = args?.description;
  if (typeof description !== "string" || !description.trim()) {
    throw new Error("create_task requires a non-empty description string");
  }
  return description.trim();
}

function normalizeDependencyIds(args) {
  const dependencyIds = args?.dependency_ids ?? args?.dependencyIds;
  if (dependencyIds == null) {
    return [];
  }
  if (!Array.isArray(dependencyIds) || dependencyIds.some((value) => typeof value !== "string")) {
    throw new Error("dependency_ids must be an array of strings");
  }
  return dependencyIds.map((value) => value.trim()).filter(Boolean);
}

function normalizeTaskId(args) {
  const taskId = args?.task_id ?? args?.taskId;
  if (typeof taskId !== "string" || !taskId.trim()) {
    throw new Error("tool requires a non-empty task_id string");
  }
  return taskId.trim();
}

function normalizeOptionalStatus(args) {
  const status = args?.status;
  if (status == null) {
    return undefined;
  }
  if (typeof status !== "string" || !status.trim()) {
    throw new Error("status must be a non-empty string when provided");
  }
  return status.trim();
}

function normalizeNewStatus(args) {
  const newStatus = args?.status ?? args?.new_status ?? args?.newStatus;
  if (typeof newStatus !== "string" || !newStatus.trim()) {
    throw new Error("transition_task requires a non-empty status string");
  }
  return newStatus.trim();
}

function requiredAgentInstanceId() {
  const agentInstanceId = process.env.AURA_MCP_AGENT_INSTANCE_ID?.trim();
  if (!agentInstanceId) {
    throw new Error(
      "run_task and loop control require AURA_MCP_AGENT_INSTANCE_ID to be set by the Aura OS server",
    );
  }
  return agentInstanceId;
}

function currentAgentLoopQuery() {
  const agentInstanceId = requiredAgentInstanceId();
  return `?agent_instance_id=${encodeURIComponent(agentInstanceId)}`;
}

async function listSpecs() {
  const specs = await api(`/api/projects/${projectId}/specs`);
  return {
    specs: Array.isArray(specs)
      ? specs.map((spec) => ({
        spec_id: spec.spec_id,
        title: spec.title,
        order: spec.order_index,
      }))
      : [],
  };
}

async function getSpec(args) {
  const specId = normalizeSpecId(args);
  const spec = await api(`/api/projects/${projectId}/specs/${specId}`);
  return { spec };
}

async function createSpec(args) {
  const title = normalizeTitle(args);
  const markdownContents = normalizeMarkdownContents(args);
  const orderIndex = await nextOrderIndex();
  const spec = await api(`/api/projects/${projectId}/specs`, {
    method: "POST",
    body: JSON.stringify({
      title,
      markdownContents,
      orderIndex,
    }),
  });
  return { spec };
}

async function updateSpec(args) {
  const specId = normalizeSpecId(args);
  const title = optionalTrimmedString(args?.title);
  const markdownContents = optionalTrimmedString(args?.markdown_contents ?? args?.markdownContents);
  if (!title && !markdownContents) {
    throw new Error("update_spec requires at least one of title or markdown_contents");
  }
  const spec = await api(`/api/projects/${projectId}/specs/${specId}`, {
    method: "PUT",
    body: JSON.stringify({
      ...(title ? { title } : {}),
      ...(markdownContents ? { markdownContents } : {}),
    }),
  });
  return { spec };
}

async function deleteSpec(args) {
  const specId = normalizeSpecId(args);
  await api(`/api/projects/${projectId}/specs/${specId}`, {
    method: "DELETE",
  });
  return { deleted: specId };
}

async function listTasks(args) {
  const specId = typeof (args?.spec_id ?? args?.specId) === "string"
    ? (args.spec_id ?? args.specId).trim()
    : null;
  const tasks = await api(`/api/projects/${projectId}/tasks`);
  return {
    tasks: Array.isArray(tasks)
      ? tasks
        .filter((task) => !specId || task.spec_id === specId)
        .map((task) => ({
          task_id: task.task_id,
          spec_id: task.spec_id,
          title: task.title,
          status: task.status,
        }))
      : [],
  };
}

async function getTask(args) {
  const taskId = normalizeTaskId(args);
  const task = await api(`/api/projects/${projectId}/tasks/${taskId}`);
  return { task };
}

async function nextTaskOrderIndex(specId) {
  const tasks = await api(`/api/projects/${projectId}/tasks`);
  const sameSpecTasks = Array.isArray(tasks)
    ? tasks.filter((task) => task.spec_id === specId)
    : [];
  if (sameSpecTasks.length === 0) {
    return 0;
  }
  return Math.max(
    ...sameSpecTasks.map((task) => (typeof task?.order_index === "number" ? task.order_index : 0)),
  ) + 1;
}

async function createTask(args) {
  const specId = normalizeSpecId(args);
  const title = normalizeTitle(args);
  const description = normalizeDescription(args);
  const dependencyIds = normalizeDependencyIds(args);
  const orderIndex = await nextTaskOrderIndex(specId);
  const task = await api(`/api/projects/${projectId}/tasks`, {
    method: "POST",
    body: JSON.stringify({
      spec_id: specId,
      title,
      description,
      order_index: orderIndex,
      dependency_ids: dependencyIds,
    }),
  });
  return { task };
}

async function updateTask(args) {
  const taskId = normalizeTaskId(args);
  const title = optionalTrimmedString(args?.title);
  const description = optionalTrimmedString(args?.description);
  const status = normalizeOptionalStatus(args);
  if (!title && !description && !status) {
    throw new Error("update_task requires at least one of title, description, or status");
  }
  const task = await api(`/api/projects/${projectId}/tasks/${taskId}`, {
    method: "PUT",
    body: JSON.stringify({
      ...(title ? { title } : {}),
      ...(description ? { description } : {}),
      ...(status ? { status } : {}),
    }),
  });
  return { task };
}

async function deleteTask(args) {
  const taskId = normalizeTaskId(args);
  const specId = normalizeSpecId(args);
  await api(`/api/projects/${projectId}/tasks/${taskId}`, {
    method: "DELETE",
  });
  return { deleted: taskId, spec_id: specId };
}

async function transitionTask(args) {
  const taskId = normalizeTaskId(args);
  const status = normalizeNewStatus(args);
  const task = await api(`/api/projects/${projectId}/tasks/${taskId}/transition`, {
    method: "POST",
    body: JSON.stringify({
      new_status: status,
    }),
  });
  return { task };
}

async function retryTask(args) {
  const taskId = normalizeTaskId(args);
  const task = await api(`/api/projects/${projectId}/tasks/${taskId}/retry`, {
    method: "POST",
  });
  return { task };
}

async function runTask(args) {
  const taskId = normalizeTaskId(args);
  const agentInstanceId = requiredAgentInstanceId();
  await api(
    `/api/projects/${projectId}/tasks/${taskId}/run?agent_instance_id=${encodeURIComponent(agentInstanceId)}`,
    { method: "POST" },
  );
  return {
    task_run: {
      task_id: taskId,
      agent_instance_id: agentInstanceId,
      status: "requested",
    },
  };
}

async function getProject() {
  const project = await api(`/api/projects/${projectId}`);
  return { project };
}

async function updateProject(args) {
  const name = optionalTrimmedString(args?.name);
  const description = optionalTrimmedString(args?.description);
  const buildCommand = optionalTrimmedString(args?.build_command ?? args?.buildCommand);
  const testCommand = optionalTrimmedString(args?.test_command ?? args?.testCommand);
  if (!name && !description && !buildCommand && !testCommand) {
    throw new Error(
      "update_project requires at least one of name, description, build_command, or test_command",
    );
  }
  const project = await api(`/api/projects/${projectId}`, {
    method: "PUT",
    body: JSON.stringify({
      ...(name ? { name } : {}),
      ...(description ? { description } : {}),
      ...(buildCommand ? { build_command: buildCommand } : {}),
      ...(testCommand ? { test_command: testCommand } : {}),
    }),
  });
  return { project };
}

async function getProjectStats() {
  const result = await api(`/api/projects/${projectId}/stats`);
  return { result };
}

async function startDevLoop() {
  const loopStatus = await api(`/api/projects/${projectId}/loop/start${currentAgentLoopQuery()}`, {
    method: "POST",
  });
  return { loop_status: loopStatus };
}

async function pauseDevLoop() {
  const loopStatus = await api(`/api/projects/${projectId}/loop/pause${currentAgentLoopQuery()}`, {
    method: "POST",
  });
  return { loop_status: loopStatus };
}

async function stopDevLoop() {
  const loopStatus = await api(`/api/projects/${projectId}/loop/stop${currentAgentLoopQuery()}`, {
    method: "POST",
  });
  return { loop_status: loopStatus };
}

async function getLoopStatus() {
  const loopStatus = await api(`/api/projects/${projectId}/loop/status${currentAgentLoopQuery()}`);
  return { loop_status: loopStatus };
}

async function listOrgIntegrations(args) {
  const provider = optionalTrimmedString(args?.provider);
  const integrations = await getOrgIntegrations();
  return {
    integrations: integrations
      .filter((integration) => !provider || integration.provider === provider)
      .map((integration) => ({
        integration_id: integration.integration_id,
        name: integration.name,
        provider: integration.provider,
        default_model: integration.default_model ?? null,
        has_secret: Boolean(integration.has_secret),
      })),
  };
}

async function githubListRepos(args) {
  return callAppProviderTool("github_list_repos", args);
}

async function githubCreateIssue(args) {
  return callAppProviderTool("github_create_issue", args);
}

async function linearListTeams(args) {
  return callAppProviderTool("linear_list_teams", args);
}

async function linearCreateIssue(args) {
  return callAppProviderTool("linear_create_issue", args);
}

async function slackListChannels(args) {
  return callAppProviderTool("slack_list_channels", args);
}

async function slackPostMessage(args) {
  return callAppProviderTool("slack_post_message", args);
}

async function notionSearchPages(args) {
  return callAppProviderTool("notion_search_pages", args);
}

async function notionCreatePage(args) {
  return callAppProviderTool("notion_create_page", args);
}

const toolHandlers = {
  list_specs: listSpecs,
  get_spec: getSpec,
  create_spec: createSpec,
  update_spec: updateSpec,
  delete_spec: deleteSpec,
  list_tasks: listTasks,
  get_task: getTask,
  create_task: createTask,
  update_task: updateTask,
  delete_task: deleteTask,
  transition_task: transitionTask,
  retry_task: retryTask,
  run_task: runTask,
  get_project: getProject,
  update_project: updateProject,
  get_project_stats: getProjectStats,
  start_dev_loop: startDevLoop,
  pause_dev_loop: pauseDevLoop,
  stop_dev_loop: stopDevLoop,
  get_loop_status: getLoopStatus,
  list_org_integrations: listOrgIntegrations,
  github_list_repos: githubListRepos,
  github_create_issue: githubCreateIssue,
  linear_list_teams: linearListTeams,
  linear_create_issue: linearCreateIssue,
  slack_list_channels: slackListChannels,
  slack_post_message: slackPostMessage,
  notion_search_pages: notionSearchPages,
  notion_create_page: notionCreatePage,
};

function validateSharedTools() {
  const manifestNames = new Set(allSharedTools.map((tool) => tool.name));
  const handlerNames = new Set(Object.keys(toolHandlers));

  for (const tool of allSharedTools) {
    if (typeof tool.name !== "string" || !tool.name) {
      throw new Error("Shared tool manifest contains a tool without a valid name");
    }
    if (typeof tool.description !== "string" || !tool.description) {
      throw new Error(`Shared tool '${tool.name}' is missing a description`);
    }
    if (!tool.inputSchema || typeof tool.inputSchema !== "object") {
      throw new Error(`Shared tool '${tool.name}' is missing a valid inputSchema`);
    }
    if (!toolHandlers[tool.name]) {
      throw new Error(`Shared tool '${tool.name}' has no MCP handler`);
    }
  }

  for (const name of handlerNames) {
    if (!manifestNames.has(name)) {
      throw new Error(`MCP handler '${name}' is not declared in the shared tool manifests`);
    }
  }
}

validateSharedTools();

const server = new Server(
  {
    name: "aura-control-plane",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [...sharedProjectTools, ...(await availableAppProviderTools()), ...(await dynamicMcpTools())].map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    const handler = toolHandlers[name];
    if (handler) {
      const result = await handler(args ?? {});
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
      };
    }
    const dynamicRegistry = await getDynamicMcpRegistry();
    if (dynamicRegistry.toolEntries.has(name)) {
      return await callDynamicMcpTool(name, args ?? {});
    }
    throw new Error(`Unknown tool: ${name}`);
  } catch (error) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: error instanceof Error ? error.message : String(error),
        },
      ],
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);

async function closeDynamicMcpRegistry() {
  if (!dynamicMcpRegistryPromise) return;
  try {
    const registry = await dynamicMcpRegistryPromise;
    await Promise.allSettled(registry.clients.map((client) => client.close()));
    await Promise.allSettled(
      registry.transports
        .filter((transport) => transport && typeof transport.close === "function")
        .map((transport) => transport.close()),
    );
  } catch {
    // ignore cleanup errors
  }
}

process.on("exit", () => {
  void closeDynamicMcpRegistry();
});
