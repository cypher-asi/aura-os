#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const apiBaseUrl = requiredEnv("AURA_MCP_API_BASE_URL");
const projectId = requiredEnv("AURA_MCP_PROJECT_ID");
const jwt = requiredEnv("AURA_MCP_JWT");

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
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
  tools: [
    {
      name: "list_specs",
      description: "List persisted Aura specs for the currently attached project.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {},
      },
    },
    {
      name: "create_spec",
      description:
        "Create and persist a real Aura project spec for the currently attached project.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: {
            type: "string",
            description: "Short human-readable title for the spec.",
          },
          markdown_contents: {
            type: "string",
            description:
              "Full markdown body of the spec that should be saved into Aura OS.",
          },
        },
        required: ["title", "markdown_contents"],
      },
    },
    {
      name: "list_tasks",
      description: "List persisted Aura tasks for the currently attached project.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          spec_id: {
            type: "string",
            description: "Optional spec UUID to filter tasks to a single spec.",
          },
        },
      },
    },
    {
      name: "create_task",
      description: "Create and persist a real Aura task under an existing project spec.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          spec_id: {
            type: "string",
            description: "UUID of the parent spec from list_specs.",
          },
          title: {
            type: "string",
            description: "Short human-readable title for the task.",
          },
          description: {
            type: "string",
            description: "Full task description that should be saved into Aura OS.",
          },
          dependency_ids: {
            type: "array",
            items: { type: "string" },
            description: "Optional task UUIDs this task depends on.",
          },
        },
        required: ["spec_id", "title", "description"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    const result = await (async () => {
      switch (name) {
        case "list_specs":
          return listSpecs();
        case "create_spec":
          return createSpec(args ?? {});
        case "list_tasks":
          return listTasks(args ?? {});
        case "create_task":
          return createTask(args ?? {});
        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    })();
    return {
      content: [{ type: "text", text: JSON.stringify(result) }],
    };
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
