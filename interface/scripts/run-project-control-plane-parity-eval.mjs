import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const interfaceRoot = path.resolve(currentDir, "..");
const resultsDir = path.join(interfaceRoot, "test-results");

const apiBaseUrl = process.env.AURA_EVAL_API_BASE_URL?.trim()
  || process.env.AURA_EVAL_BASE_URL?.trim()
  || "http://127.0.0.1:3190";
const accessToken = process.env.AURA_EVAL_ACCESS_TOKEN?.trim() || "";
const keepEntities = process.env.AURA_EVAL_KEEP_ENTITIES === "1";
const orgName = process.env.AURA_EVAL_ORG_NAME ?? "Aura Evaluations";
const verbose = process.env.AURA_EVAL_VERBOSE === "1";
const chatTimeoutMs = Number.parseInt(process.env.AURA_PARITY_EVAL_CHAT_TIMEOUT_MS ?? "120000", 10);

if (!accessToken) {
  throw new Error("Set AURA_EVAL_ACCESS_TOKEN before running the project control-plane parity eval.");
}

function authHeaders(extra = {}) {
  return {
    Authorization: `Bearer ${accessToken}`,
    ...extra,
  };
}

function logStep(message, details) {
  if (!verbose) return;
  process.stderr.write(`[project-parity-eval] ${message}`);
  if (details !== undefined) {
    process.stderr.write(` ${JSON.stringify(details)}`);
  }
  process.stderr.write("\n");
}

function inferProvider(adapterType) {
  if (adapterType === "claude_code") return "anthropic";
  if (adapterType === "codex") return "openai";
  return "";
}

function adapterLabel(adapterType) {
  switch (adapterType) {
    case "aura_harness":
      return "Aura";
    case "claude_code":
      return "Claude Code";
    case "codex":
      return "Codex";
    default:
      return adapterType;
  }
}

function normalizeAdapterSelection(value) {
  const normalized = value.trim().toLowerCase();
  if (normalized === "aura") return "aura_harness";
  if (normalized === "claude" || normalized === "claude_code") return "claude_code";
  if (normalized === "codex") return "codex";
  return normalized;
}

function buildAdapterConfigs() {
  const requested = (process.env.AURA_PARITY_EVAL_ADAPTERS ?? "aura,codex,claude").split(",");
  const adapterTypes = requested.map(normalizeAdapterSelection);

  return adapterTypes.map((adapterType) => {
    const prefix = adapterType === "aura_harness"
      ? "AURA_PARITY_EVAL_AURA"
      : adapterType === "codex"
        ? "AURA_PARITY_EVAL_CODEX"
        : "AURA_PARITY_EVAL_CLAUDE";
    const authSource = process.env[`${prefix}_AUTH_SOURCE`]?.trim()
      || (() => {
        if (adapterType === "aura_harness") return "aura_managed";
        if (process.env[`${prefix}_API_KEY`]?.trim()) return "org_integration";
        return "local_cli_auth";
      })();
    const provider = process.env[`${prefix}_PROVIDER`]?.trim()
      || (authSource === "org_integration" ? inferProvider(adapterType) : "");
    const apiKey = process.env[`${prefix}_API_KEY`]?.trim() || "";
    if (authSource === "org_integration" && !apiKey) {
      throw new Error(
        `${prefix}_API_KEY is required when ${prefix}_AUTH_SOURCE=org_integration`,
      );
    }
    return {
      adapterType,
      label: adapterLabel(adapterType),
      environment: process.env[`${prefix}_ENVIRONMENT`]?.trim() || "local_host",
      authSource,
      provider,
      apiKey,
      defaultModel: process.env[`${prefix}_MODEL`]?.trim() || "",
    };
  });
}

async function apiJson(method, endpoint, body) {
  const response = await fetch(`${apiBaseUrl}${endpoint}`, {
    method,
    headers: authHeaders(body == null ? {} : { "Content-Type": "application/json" }),
    body: body == null ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${method} ${endpoint} failed with ${response.status}: ${text}`);
  }
  return text ? JSON.parse(text) : null;
}

async function apiResponse(method, endpoint) {
  const response = await fetch(`${apiBaseUrl}${endpoint}`, {
    method,
    headers: authHeaders(),
  });
  const text = await response.text();
  return {
    ok: response.ok,
    status: response.status,
    text,
  };
}

async function ensureImportedAccessToken() {
  const response = await fetch(`${apiBaseUrl}/api/auth/import-access-token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ access_token: accessToken }),
  });
  if (response.ok || [403, 404, 405].includes(response.status)) return;
  const text = await response.text();
  throw new Error(`POST /api/auth/import-access-token failed with ${response.status}: ${text}`);
}

async function resolveEvalOrg() {
  const orgs = await apiJson("GET", "/api/orgs");
  const existing = orgs.find((org) => org.name === orgName);
  if (existing) return { ...existing, created: false };
  const created = await apiJson("POST", "/api/orgs", { name: orgName });
  return { ...created, created: true };
}

async function maybeCreateIntegration(orgId, config) {
  if (config.authSource !== "org_integration") return null;
  return apiJson("POST", `/api/orgs/${orgId}/integrations`, {
    name: `${config.adapterType}-${config.provider}-project-parity-eval`,
    provider: config.provider,
    default_model: config.defaultModel || null,
    api_key: config.apiKey || null,
  });
}

async function cleanupEntity(method, endpoint) {
  if (!endpoint) return null;
  const response = await apiResponse(method, endpoint);
  return {
    endpoint,
    ok: response.ok || response.status === 404,
    status: response.status,
    error: response.ok || response.status === 404 ? null : response.text,
  };
}

async function cleanupLaneEntities(lane) {
  return {
    agentInstance: lane.agentInstance
      ? await cleanupEntity(
        "DELETE",
        `/api/projects/${lane.project.project_id}/agents/${lane.agentInstance.agent_instance_id}`,
      )
      : null,
    project: lane.project
      ? await cleanupEntity("DELETE", `/api/projects/${lane.project.project_id}`)
      : null,
    agent: lane.agent ? await cleanupEntity("DELETE", `/api/agents/${lane.agent.agent_id}`) : null,
    integration: lane.integration
      ? await cleanupEntity(
        "DELETE",
        `/api/orgs/${lane.org.org_id}/integrations/${lane.integration.integration_id}`,
      )
      : null,
  };
}

function importedProjectFiles(label) {
  return [
    {
      relative_path: "README.md",
      contents_base64: Buffer.from(
        `# ${label} Project\n\nThis is a small project used to validate Aura OS project control-plane parity.\n`,
      ).toString("base64"),
    },
    {
      relative_path: "requirements.md",
      contents_base64: Buffer.from(
        [
          "# Project Goal",
          "",
          "We need a saved spec and task in Aura OS.",
          "",
          "Requirements:",
          "- create one spec called `Parity Spec`",
          "- create one task called `Build greeting page` under that spec",
          "- make sure the saved task ends in status `ready`",
        ].join("\n"),
      ).toString("base64"),
    },
  ];
}

async function readSse(response) {
  const decoder = new TextDecoder();
  const reader = response.body?.getReader();
  if (!reader) return { text: "", events: [] };

  let buffer = "";
  const events = [];
  let assembledText = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";

    for (const frame of frames) {
      const lines = frame.split("\n");
      const eventName = lines
        .find((line) => line.startsWith("event:"))
        ?.slice(6)
        .trim();
      const dataLines = lines
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .filter(Boolean);

      for (const line of dataLines) {
        try {
          const parsed = JSON.parse(line);
          events.push(eventName ? { event: eventName, ...parsed } : parsed);
          if (parsed.type === "text_delta" && typeof parsed.text === "string") {
            assembledText += parsed.text;
          }
        } catch {
          events.push(eventName ? { event: eventName, raw: line } : { raw: line });
        }
      }
    }
  }

  return { text: assembledText.trim(), events };
}

async function streamLaneMessage(lane, content) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), chatTimeoutMs);

  const endpoint = lane.adapterType === "aura_harness"
    ? `/api/projects/${lane.project.project_id}/agents/${lane.agentInstance.agent_instance_id}/events/stream`
    : `/api/agents/${lane.agent.agent_id}/events/stream`;
  const body = lane.adapterType === "aura_harness"
    ? { content }
    : { content, project_id: lane.project.project_id };

  try {
    const response = await fetch(`${apiBaseUrl}${endpoint}`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) {
      const text = await response.text();
      return { ok: false, status: response.status, text: "", error: text, events: [] };
    }
    const sse = await readSse(response);
    const endEvent = [...sse.events].reverse().find((event) => event.type === "assistant_message_end");
    const errorEvent = [...sse.events].reverse().find((event) => event.type === "error");
    return {
      ok: Boolean(endEvent) && !errorEvent,
      status: response.status,
      text: sse.text,
      events: sse.events,
      error: errorEvent?.message ?? null,
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return {
        ok: false,
        status: 408,
        text: "",
        error: `chat stream timed out after ${chatTimeoutMs}ms`,
        events: [],
      };
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function listSpecs(projectId) {
  return apiJson("GET", `/api/projects/${projectId}/specs`);
}

async function listTasks(projectId) {
  return apiJson("GET", `/api/projects/${projectId}/tasks`);
}

function toolNames(events) {
  return events
    .filter((event) => event.type === "tool_use_start")
    .map((event) => event.name)
    .filter(Boolean);
}

function assertCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function expectAnyTool(events, allowedNames, context) {
  const seen = toolNames(events);
  assertCondition(
    allowedNames.some((name) => seen.includes(name)),
    `${context} expected one of [${allowedNames.join(", ")}] but saw [${seen.join(", ")}]`,
  );
  return seen;
}

async function runLane(config, org) {
  const lane = {
    label: config.label,
    adapterType: config.adapterType,
    environment: config.environment,
    authSource: config.authSource,
    provider: config.provider || null,
    org,
    integration: null,
    agent: null,
    project: null,
    agentInstance: null,
    steps: [],
  };

  lane.integration = await maybeCreateIntegration(org.org_id, config);
  lane.agent = await apiJson("POST", "/api/agents", {
    org_id: org.org_id,
    name: `${config.label} Project Parity Eval`,
    role: "Engineer",
    personality: "Reliable and precise.",
    system_prompt: "Use Aura OS control-plane tools when asked to persist project state. Stop after the requested change is saved.",
    machine_type: config.environment === "swarm_microvm" ? "remote" : "local",
    adapter_type: config.adapterType,
    environment: config.environment,
    auth_source: config.authSource,
    integration_id: config.authSource === "org_integration" ? (lane.integration?.integration_id ?? null) : null,
    default_model: config.defaultModel || null,
    skills: [],
    icon: null,
  });

  lane.project = await apiJson("POST", "/api/projects/import", {
    org_id: org.org_id,
    name: `${config.label} Project Control Plane Eval`,
    description: `Project parity eval for ${config.label}.`,
    files: importedProjectFiles(config.label),
    build_command: null,
    test_command: null,
  });

  lane.agentInstance = await apiJson("POST", `/api/projects/${lane.project.project_id}/agents`, {
    agent_id: lane.agent.agent_id,
  });

  const prompts = [
    {
      name: "create_spec",
      content:
        "Create exactly one persisted Aura OS spec titled `Parity Spec` with markdown contents `# Parity Spec\\n\\nThis spec proves project control-plane parity.` Stop after saving it. Do not create tasks yet.",
      verify: async () => {
        const specs = await listSpecs(lane.project.project_id);
        assertCondition(specs.length === 1, `${config.label} should have exactly one spec after create_spec`);
        assertCondition(specs[0].title === "Parity Spec", `${config.label} spec title mismatch`);
        return { specId: specs[0].spec_id, specTitle: specs[0].title };
      },
      acceptedTools: ["create_spec"],
    },
    {
      name: "create_task",
      content:
        "List the saved specs, find `Parity Spec`, then create exactly one Aura OS task titled `Build greeting page` with description `Implement the greeting page defined in the parity spec.` Stop after saving it.",
      verify: async () => {
        const tasks = await listTasks(lane.project.project_id);
        assertCondition(tasks.length === 1, `${config.label} should have exactly one task after create_task`);
        assertCondition(tasks[0].title === "Build greeting page", `${config.label} task title mismatch`);
        assertCondition(
          ["backlog", "todo", "pending", "ready"].includes(tasks[0].status),
          `${config.label} task should start in backlog/todo/pending/ready, got ${tasks[0].status}`,
        );
        return { taskId: tasks[0].task_id, taskTitle: tasks[0].title, taskStatus: tasks[0].status };
      },
      acceptedTools: ["create_task"],
    },
    {
      name: "transition_task_ready",
      content:
        "List the saved tasks, find `Build greeting page`, and make sure its final saved status is `ready`. If an intermediate transition is required first, perform it and stop once the task is saved as `ready`.",
      verify: async () => {
        const tasks = await listTasks(lane.project.project_id);
        assertCondition(tasks[0]?.status === "ready", `${config.label} task should be ready after transition`);
        return { taskId: tasks[0].task_id, taskStatus: tasks[0].status };
      },
      acceptedTools: ["transition_task", "update_task"],
    },
  ];

  for (const prompt of prompts) {
    logStep("lane step", { lane: config.label, step: prompt.name });
    const stream = await streamLaneMessage(lane, prompt.content);
    assertCondition(stream.ok, `${config.label} ${prompt.name} stream failed: ${stream.error ?? "missing assistant end"}`);
    const seenTools = expectAnyTool(stream.events, prompt.acceptedTools, `${config.label} ${prompt.name}`);
    const verification = await prompt.verify();
    lane.steps.push({
      name: prompt.name,
      ok: true,
      seenTools,
      verification,
      text: stream.text,
    });
  }

  return lane;
}

async function main() {
  const startedAt = Date.now();
  const artifact = {
    suite: "project-control-plane-parity-eval",
    startedAt: new Date(startedAt).toISOString(),
    apiBaseUrl,
    adapters: buildAdapterConfigs().map((config) => ({
      adapterType: config.adapterType,
      label: config.label,
      environment: config.environment,
      authSource: config.authSource,
      provider: config.provider || null,
      defaultModel: config.defaultModel || null,
    })),
  };

  let org = null;
  const lanes = [];

  try {
    await ensureImportedAccessToken();
    org = await resolveEvalOrg();
    artifact.org = org;

    for (const config of buildAdapterConfigs()) {
      lanes.push(await runLane(config, org));
    }

    const payload = {
      ...artifact,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      success: true,
      lanes,
    };

    await fs.mkdir(resultsDir, { recursive: true });
    const outputPath = path.join(resultsDir, "project-control-plane-parity-eval.json");

    if (!keepEntities) {
      payload.cleanup = await Promise.all(lanes.map((lane) => cleanupLaneEntities(lane)));
    }

    await fs.writeFile(outputPath, JSON.stringify(payload, null, 2), "utf8");
    process.stdout.write(`${outputPath}\n`);
  } catch (error) {
    const outputPath = path.join(resultsDir, "project-control-plane-parity-eval.json");
    const payload = {
      ...artifact,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      success: false,
      org,
      lanes,
      error: error instanceof Error ? error.message : String(error),
    };
    if (!keepEntities) {
      payload.cleanup = await Promise.all(lanes.map((lane) => cleanupLaneEntities(lane)));
    }
    await fs.mkdir(resultsDir, { recursive: true });
    await fs.writeFile(outputPath, JSON.stringify(payload, null, 2), "utf8");
    process.stdout.write(`${outputPath}\n`);
    process.exitCode = 1;
  }
}

await main();
