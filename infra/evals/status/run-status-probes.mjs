#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CHECK_STATUS } from "./lib/status-policy.mjs";
import { validateCheckEvidence } from "./lib/check-expectations.mjs";
import {
  statusProbeAgentPermissions,
  statusProbeHarnessPermissions,
} from "./lib/status-probe-permissions.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..", "..");

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_REMOTE_TIMEOUT_MS = positiveIntegerEnv("AURA_STATUS_REMOTE_TIMEOUT_MS", 300_000);
const DEFAULT_MODELS = [
  "aura-claude-sonnet-4-6",
  "aura-gpt-5-5",
];
const EXPECTED_RUNTIME_PHRASE = "hello from aura";
const DEFAULT_PUBLISHED_STATUS_JSON_URL = "https://cypher-asi.github.io/aura-os/observability/status.json";
const PUBLISHED_STATUS_MAX_AGE_MINUTES = 300;
const PROJECT_CHAT_EXPECTED_PHRASE = "hello from aura";
const SKILL_INVOCATION_PHRASE = "AURA_SKILL_PROBE_OK";
const TOOL_FILE_NAME = "AURA_STATUS_TOOL_PROBE.txt";
const TOOL_FILE_MARKER = "AURA_TOOL_PROBE_OK";
const TOOL_SHELL_MARKER = "AURA_SHELL_PROBE_OK";
const TOOL_PASS_MARKER = "TOOL_PROBE_PASS";
const A2A_REPLY_MARKER = "AURA_A2A_PROBE_ACK";
const SUBAGENT_REPLY_MARKER = "SUBAGENT_PROBE_OK";
const HEADER_CHAT_PERSISTED = "x-aura-chat-persisted";
const HEADER_CHAT_PROJECT_ID = "x-aura-chat-project-id";
const HEADER_CHAT_SESSION_ID = "x-aura-chat-session-id";
const LIVE_STATUS_SNAPSHOT_SOURCES = new Set([
  "github-actions",
  "desktop-nightly-release",
  "desktop-stable-release",
]);

function positiveIntegerEnv(name, fallback) {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : fallback;
}

function parseArgs(argv) {
  const args = {
    baseUrl: process.env.AURA_STATUS_API_BASE_URL || "http://127.0.0.1:3190",
    publicBaseUrl: process.env.AURA_STATUS_PUBLIC_BASE_URL || "",
    publicApiBaseUrl: process.env.AURA_STATUS_PUBLIC_API_BASE_URL || "",
    publishedSnapshotUrl: process.env.AURA_STATUS_PUBLISHED_SNAPSHOT_URL || process.env.VITE_AURA_STATUS_SNAPSHOT_URL || DEFAULT_PUBLISHED_STATUS_JSON_URL,
    token: process.env.AURA_STATUS_ACCESS_TOKEN || process.env.AURA_EVAL_ACCESS_TOKEN || "",
    userEmail: process.env.AURA_STATUS_USER_EMAIL || "",
    userPassword: process.env.AURA_STATUS_USER_PASSWORD || "",
    outDir: process.env.AURA_STATUS_CHECKS_DIR || path.join(repoRoot, "infra/evals/reports/status/checks"),
    expectationsFile: process.env.AURA_STATUS_EXPECTATIONS_FILE || path.join(__dirname, "check-expectations.json"),
    expectations: null,
    environment: process.env.AURA_STATUS_ENVIRONMENT || "local",
    runtimeEnvironment: process.env.AURA_STATUS_RUNTIME_ENVIRONMENT || "",
    checks: (process.env.AURA_STATUS_CHECKS || "").split(",").map((v) => v.trim()).filter(Boolean),
    models: (process.env.AURA_STATUS_MODEL_IDS || "").split(",").map((v) => v.trim()).filter(Boolean),
    keepEntities: process.env.AURA_STATUS_KEEP_ENTITIES === "1",
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      i += 1;
      if (i >= argv.length) throw new Error(`Missing value for ${arg}`);
      return argv[i];
    };
    if (arg === "--base-url") args.baseUrl = next();
    else if (arg === "--public-base-url") args.publicBaseUrl = next();
    else if (arg === "--public-api-base-url") args.publicApiBaseUrl = next();
    else if (arg === "--published-snapshot-url") args.publishedSnapshotUrl = next();
    else if (arg === "--token") args.token = next();
    else if (arg === "--user-email") args.userEmail = next();
    else if (arg === "--user-password") args.userPassword = next();
    else if (arg === "--out-dir") args.outDir = path.resolve(next());
    else if (arg === "--expectations") args.expectationsFile = path.resolve(next());
    else if (arg === "--environment") args.environment = next();
    else if (arg === "--runtime-environment") args.runtimeEnvironment = next();
    else if (arg === "--checks") args.checks = next().split(",").map((v) => v.trim()).filter(Boolean);
    else if (arg === "--models") args.models = next().split(",").map((v) => v.trim()).filter(Boolean);
    else if (arg === "--keep-entities") args.keepEntities = true;
    else if (arg === "--help") {
      process.stdout.write("Usage: node infra/evals/status/run-status-probes.mjs [--base-url URL] [--public-base-url URL] [--published-snapshot-url URL] [--token TOKEN] [--checks a,b]\n");
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  args.baseUrl = args.baseUrl.replace(/\/+$/, "");
  args.runtimeEnvironment = normalizeRuntimeEnvironment(args.runtimeEnvironment || inferRuntimeEnvironment(args.environment));
  args.publicBaseUrl = args.publicBaseUrl.replace(/\/+$/, "");
  args.publicApiBaseUrl = args.publicApiBaseUrl.replace(/\/+$/, "");
  if (args.models.length === 0) args.models = DEFAULT_MODELS;
  args.checks = args.checks.length > 0 ? new Set(args.checks) : null;
  return args;
}

function normalizeRuntimeEnvironment(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function inferRuntimeEnvironment(environment) {
  const normalized = typeof environment === "string" ? environment.trim().toLowerCase() : "";
  if (normalized.startsWith("desktop-")) return "desktop-release";
  if (normalized === "production") return "production-api";
  if (normalized === "local") return "local-dev";
  return normalized || "";
}

function sseFramesFromText(text) {
  return text
    .split(/\r?\n\r?\n/)
    .map((frame) => {
      let event = "message";
      const data = [];
      for (const line of frame.split(/\r?\n/)) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
      }
      const raw = data.join("\n");
      let json = null;
      try {
        json = raw ? JSON.parse(raw) : null;
      } catch {
        json = raw;
      }
      return { event, data: json, raw };
    })
    .filter((frame) => frame.event || frame.raw);
}

async function fetchWithTimeout(url, init = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`request timed out after ${timeoutMs}ms`)), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function loginForAccessToken(args) {
  if (!args.userEmail || !args.userPassword) return "";
  const response = await fetchWithTimeout(
    `${args.baseUrl}/api/auth/login`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: args.userEmail,
        password: args.userPassword,
      }),
    },
    DEFAULT_TIMEOUT_MS,
  );
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`POST /api/auth/login failed with ${response.status}: ${text}`);
  }
  const payload = text ? JSON.parse(text) : null;
  if (typeof payload?.access_token !== "string" || payload.access_token.length === 0) {
    throw new Error("POST /api/auth/login did not return access_token");
  }
  return payload.access_token;
}

function authHeaders(args, extra = {}) {
  return args.token ? { Authorization: `Bearer ${args.token}`, ...extra } : { ...extra };
}

async function apiJson(args, method, endpoint, body, options = {}) {
  const response = await fetchWithTimeout(
    `${args.baseUrl}${endpoint}`,
    {
      method,
      headers: authHeaders(args, body == null ? {} : { "Content-Type": "application/json" }),
      body: body == null ? undefined : JSON.stringify(body),
    },
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${method} ${endpoint} failed with ${response.status}: ${text}`);
  }
  return text ? JSON.parse(text) : null;
}

async function publicJson(baseUrl, endpoint) {
  const response = await fetchWithTimeout(`${baseUrl}${endpoint}`, {}, DEFAULT_TIMEOUT_MS);
  const text = await response.text();
  if (!response.ok) throw new Error(`GET ${endpoint} failed with ${response.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

async function publicText(baseUrl, endpoint) {
  const response = await fetchWithTimeout(`${baseUrl}${endpoint}`, {}, DEFAULT_TIMEOUT_MS);
  const text = await response.text();
  if (!response.ok) throw new Error(`GET ${endpoint} failed with ${response.status}: ${text}`);
  return { status: response.status, text };
}

async function publicJsonUrl(url) {
  const response = await fetchWithTimeout(url, {}, DEFAULT_TIMEOUT_MS);
  const text = await response.text();
  if (!response.ok) throw new Error(`GET ${url} failed with ${response.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

function statusSnapshotEvidence(payload) {
  const features = Array.isArray(payload?.features)
    ? payload.features
    : Object.values(payload?.features ?? {});
  const generatedAtMs = Date.parse(payload?.generatedAt ?? "");
  const snapshotAgeMinutes = Number.isFinite(generatedAtMs)
    ? Math.round(Math.max(0, (Date.now() - generatedAtMs) / 60000))
    : null;
  const unknownFeatureCount = features.filter((feature) => feature?.status === "unknown").length;
  const featureCount = features.length;
  return {
    schemaVersion: payload?.schemaVersion ?? null,
    overall: payload?.overall,
    generatedAtPresent: typeof payload?.generatedAt === "string" && payload.generatedAt.length > 0,
    source: payload?.source ?? null,
    featureCount,
    totalsFeatures: payload?.totals?.features ?? null,
    unknownFeatureCount,
    snapshotAgeMinutes,
    hasLiveSource: LIVE_STATUS_SNAPSHOT_SOURCES.has(payload?.source),
    hasNonUnknownFeatureData: featureCount > 0 && unknownFeatureCount < featureCount,
  };
}

function collectionCount(payload, keys = []) {
  if (Array.isArray(payload)) return payload.length;
  for (const key of keys) {
    const value = payload?.[key];
    if (Array.isArray(value)) return value.length;
    if (Number.isFinite(Number(value))) return Number(value);
  }
  return null;
}

function collectionItems(payload, keys = []) {
  if (Array.isArray(payload)) return payload;
  for (const key of keys) {
    const value = payload?.[key];
    if (Array.isArray(value)) return value;
  }
  return [];
}

function idFrom(value, candidates = ["id"]) {
  const id = extractId(value, candidates);
  if (!id) throw new Error(`Response did not include any id field: ${candidates.join(", ")}`);
  return id;
}

function firstTruthyString(value, candidates = []) {
  for (const key of candidates) {
    const item = value?.[key];
    if (typeof item === "string" && item.length > 0) return item;
  }
  return null;
}

function sseTextSample(frames) {
  return frames
    .filter((frame) => frame.event === "text_delta")
    .map((frame) => {
      if (typeof frame.data === "string") return frame.data;
      return frame.data?.text ?? frame.data?.delta?.text ?? "";
    })
    .join("");
}

function summarizeSseFrames(frames) {
  return frames.map((frame) => summarizeSseFrame(frame));
}

function summarizeSseFrame(frame) {
  const summary = { event: frame.event };
  if (frame.data && typeof frame.data === "object" && !Array.isArray(frame.data)) {
    const data = {};
    for (const key of ["code", "message", "mode", "percent", "imageUrl", "image_url"]) {
      if (frame.data[key] !== undefined) data[key] = frame.data[key];
    }
    if (typeof frame.data.data === "string") data.dataBytes = Buffer.byteLength(frame.data.data);
    if (Object.keys(data).length > 0) summary.data = data;
  } else if (typeof frame.data === "string" && frame.data.length > 0) {
    summary.data = frame.data.slice(0, 256);
  }
  if (typeof frame.raw === "string" && frame.raw.length > 0) {
    summary.rawBytes = Buffer.byteLength(frame.raw);
  }
  return summary;
}

async function waitForValue(fn, timeoutMs = DEFAULT_TIMEOUT_MS, intervalMs = 1000) {
  const deadline = Date.now() + timeoutMs;
  let latestError = "";
  while (Date.now() < deadline) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (error) {
      latestError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(latestError || `Timed out after ${timeoutMs}ms waiting for expected value`);
}

async function apiSseWithMeta(args, endpoint, body, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const response = await fetchWithTimeout(
    `${args.baseUrl}${endpoint}`,
    {
      method: "POST",
      headers: authHeaders(args, {
        Accept: "text/event-stream",
        "Content-Type": "application/json",
      }),
      body: JSON.stringify(body),
    },
    timeoutMs,
  );
  const text = await response.text();
  if (!response.ok) throw new Error(`POST ${endpoint} failed with ${response.status}: ${text}`);
  return {
    frames: sseFramesFromText(text),
    headers: {
      persisted: response.headers.get(HEADER_CHAT_PERSISTED) === "true",
      projectId: response.headers.get(HEADER_CHAT_PROJECT_ID),
      sessionId: response.headers.get(HEADER_CHAT_SESSION_ID),
    },
  };
}

async function apiSse(args, endpoint, body, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const { frames } = await apiSseWithMeta(args, endpoint, body, timeoutMs);
  return frames;
}

async function publicSse(baseUrl, endpoint, body, token, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const response = await fetchWithTimeout(
    `${baseUrl}${endpoint}`,
    {
      method: "POST",
      headers: {
        Accept: "text/event-stream",
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    },
    timeoutMs,
  );
  const text = await response.text();
  if (!response.ok) throw new Error(`POST ${endpoint} failed with ${response.status}: ${text}`);
  return sseFramesFromText(text);
}

async function probe(checkId, featureId, label, args, fn) {
  const startedAt = new Date().toISOString();
  const started = Date.now();
  try {
    const evidence = await fn();
    const result = {
      checkId,
      featureId,
      label,
      status: evidence?.status ?? CHECK_STATUS.PASS,
      message: evidence?.message ?? "",
      startedAt,
      endedAt: new Date().toISOString(),
      latencyMs: Date.now() - started,
      environment: args.environment,
      runtimeEnvironment: args.runtimeEnvironment,
      evidence: evidence?.evidence ?? evidence ?? {},
    };
    const expectationError = validateCheckEvidence(checkId, result, args.expectations);
    if (expectationError) {
      return {
        ...result,
        status: CHECK_STATUS.FAIL,
        message: result.message ? `${result.message}; ${expectationError}` : expectationError,
      };
    }
    return result;
  } catch (error) {
    return {
      checkId,
      featureId,
      label,
      status: CHECK_STATUS.FAIL,
      message: error instanceof Error ? error.message : String(error),
      startedAt,
      endedAt: new Date().toISOString(),
      latencyMs: Date.now() - started,
      environment: args.environment,
      runtimeEnvironment: args.runtimeEnvironment,
      evidence: {},
    };
  }
}

async function loadExpectations(args) {
  try {
    return JSON.parse(await fs.readFile(args.expectationsFile, "utf8"));
  } catch (error) {
    throw new Error(`Unable to read check expectations ${args.expectationsFile}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function withCleanup(args, work) {
  const cleanup = [];
  const track = (resource, id, endpoint) => {
    if (id && endpoint) cleanup.push({ resource, id, endpoint });
  };
  try {
    return await work(track);
  } finally {
    if (args.keepEntities) return;
    for (const item of cleanup.reverse()) {
      try {
        await apiJson(args, "DELETE", item.endpoint);
      } catch {
        // Cleanup is best-effort; probe result already captured the important failure.
      }
    }
  }
}

function extractId(value, candidates) {
  for (const key of candidates) {
    const id = value?.[key];
    if (typeof id === "string" && id.length > 0) return id;
  }
  return null;
}

async function requireOrgId(args) {
  const orgs = await apiJson(args, "GET", "/api/orgs");
  const org = Array.isArray(orgs) ? orgs[0] : null;
  const orgId = extractId(org, ["id", "org_id"]);
  if (!orgId) throw new Error("No org membership available for org-scoped probe");
  return { orgId, orgCount: orgs.length };
}

async function createProject(args, track, orgId) {
  const project = await apiJson(args, "POST", "/api/projects", {
    org_id: orgId,
    name: `AURA Status Project ${Date.now()}`,
    description: "Temporary project created by AURA feature health probes.",
  });
  const projectId = extractId(project, ["project_id", "id"]);
  track("project", projectId, `/api/projects/${projectId}`);
  return { project, projectId };
}

async function createProjectAgentInstance(args, projectId, agentId) {
  const instance = await apiJson(args, "POST", `/api/projects/${projectId}/agents`, {
    agent_id: agentId,
    source: "status_probe",
  });
  const agentInstanceId = idFrom(instance, ["agent_instance_id", "project_agent_id", "id"]);
  return { instance, agentInstanceId };
}

async function createSpec(args, projectId, title = "Status Probe Spec") {
  const spec = await apiJson(args, "POST", `/api/projects/${projectId}/specs`, {
    title,
    markdown_contents: "## Goal\nVerify AURA status probe persistence.\n\n## Acceptance\nThe check can create and read a spec.\n",
    order_index: 0,
  });
  const specId = extractId(spec, ["spec_id", "id"]);
  if (!specId) throw new Error("Spec create response did not include spec_id");
  return { spec, specId };
}

async function createTask(args, projectId, specId) {
  const task = await apiJson(args, "POST", `/api/projects/${projectId}/tasks`, {
    title: "Status probe task",
    spec_id: specId,
    description: "Temporary task created by AURA feature health probes.",
    status: "backlog",
    order_index: 0,
    skip_auto_decompose: true,
  });
  const taskId = extractId(task, ["task_id", "id"]);
  if (!taskId) throw new Error("Task create response did not include task_id");
  return { task, taskId };
}

async function readOptionalJson(args, endpoint) {
  try {
    return { ok: true, payload: await apiJson(args, "GET", endpoint) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function artifactScan(globs) {
  const files = [];
  for (const relativePath of globs) {
    const file = path.join(repoRoot, relativePath);
    try {
      const stat = await fs.stat(file);
      files.push({ file: relativePath, exists: true, mtime: stat.mtime.toISOString(), size: stat.size });
    } catch {
      files.push({ file: relativePath, exists: false });
    }
  }
  return files;
}

async function createAgent(args, track, machineType, model = null, orgId = null, overrides = {}) {
  const environment = machineType === "remote" ? "swarm_microvm" : "local_host";
  const agent = await apiJson(args, "POST", "/api/agents", {
    org_id: orgId,
    name: overrides.name ?? `aura-status-${machineType}-${Date.now()}`,
    role: overrides.role ?? "status-probe",
    personality: overrides.personality ?? "Small, deterministic health-check agent.",
    system_prompt: overrides.systemPrompt ?? "You are an AURA status probe. Reply exactly as requested.",
    skills: overrides.skills ?? [],
    icon: null,
    machine_type: machineType,
    adapter_type: "aura_harness",
    environment,
    auth_source: "aura_managed",
    default_model: model,
    permissions: overrides.permissions ?? statusProbeAgentPermissions(orgId),
    tags: ["aura-status-probe"],
  }, { timeoutMs: machineType === "remote" ? DEFAULT_REMOTE_TIMEOUT_MS : DEFAULT_TIMEOUT_MS });
  track("agent", agent.agent_id, `/api/agents/${agent.agent_id}`);
  return agent;
}

function permissionEvidence(permissions, orgId) {
  const scope = permissions?.scope ?? {};
  const capabilities = Array.isArray(permissions?.capabilities) ? permissions.capabilities : [];
  const orgScope = Array.isArray(scope.orgs) ? scope.orgs : [];
  const projectScope = Array.isArray(scope.projects) ? scope.projects : [];
  const agentScope = Array.isArray(scope.agent_ids) ? scope.agent_ids : [];
  const capabilityTypes = capabilities
    .map((capability) => {
      if (typeof capability === "string") return capability;
      if (typeof capability?.type === "string") return capability.type;
      return null;
    })
    .filter(Boolean);

  return {
    permissionsPresent: permissions != null && typeof permissions === "object",
    orgScope,
    orgScoped: orgScope.length === 1 && orgScope[0] === orgId,
    projectScopeEmpty: projectScope.length === 0,
    agentScopeEmpty: agentScope.length === 0,
    capabilityCount: capabilities.length,
    capabilityTypes,
  };
}

async function runRuntimeTest(args, agentId, timeoutMs = DEFAULT_TIMEOUT_MS) {
  return apiJson(args, "POST", `/api/agents/${agentId}/runtime/test`, null, { timeoutMs });
}

async function runProjectChatTurn(args, track) {
  const { orgId } = await requireOrgId(args);
  const { projectId } = await createProject(args, track, orgId);
  const agent = await createAgent(args, track, "local", null, orgId);
  const { agentInstanceId } = await createProjectAgentInstance(args, projectId, agent.agent_id);
  track("agent-instance", agentInstanceId, `/api/projects/${projectId}/agents/${agentInstanceId}`);

  const frames = await apiSse(args, `/api/projects/${projectId}/agents/${agentInstanceId}/events/stream`, {
    content: `Reply with exactly: ${PROJECT_CHAT_EXPECTED_PHRASE}`,
    action: "chat",
    project_id: projectId,
    new_session: true,
  }, 120_000);
  const text = sseTextSample(frames);
  const error = frames.find((frame) => frame.event === "error");
  if (error) {
    return {
      status: CHECK_STATUS.FAIL,
      message: error.data?.message ?? "Project agent chat stream emitted an error",
      evidence: {
        orgId,
        projectId,
        agentId: agent.agent_id,
        agentInstanceId,
        frameTypes: frames.map((frame) => frame.event),
        textSample: text.slice(0, 120),
      },
    };
  }

  const sessions = await waitForValue(async () => {
    const payload = await apiJson(args, "GET", `/api/projects/${projectId}/agents/${agentInstanceId}/sessions`);
    const items = collectionItems(payload, ["sessions"]);
    return items.length > 0 ? items : null;
  }, 30_000, 1500);
  const latestSession = sessions[0];
  const sessionId = firstTruthyString(latestSession, ["session_id", "id"]);
  if (!sessionId) throw new Error("Project agent chat created no storage session id");

  const textMatches = text.toLowerCase().includes(PROJECT_CHAT_EXPECTED_PHRASE);
  return {
    status: textMatches ? CHECK_STATUS.PASS : CHECK_STATUS.FAIL,
    message: textMatches ? "" : "Project agent chat stream did not contain the expected phrase",
    evidence: {
      orgId,
      projectId,
      agentId: agent.agent_id,
      agentInstanceId,
      sessionId,
      frameTypes: frames.map((frame) => frame.event),
      textSample: text.slice(0, 120),
      sessionCount: sessions.length,
      expectedPhrase: PROJECT_CHAT_EXPECTED_PHRASE,
    },
  };
}

function frameTypes(frames) {
  return frames.map((frame) => frame.event);
}

function toolUseNames(frames) {
  return frames
    .filter((frame) => frame.event === "tool_use_start" || frame.event === "tool_call_snapshot")
    .map((frame) => frame.data?.name)
    .filter((name) => typeof name === "string" && name.length > 0);
}

function toolResults(frames) {
  return frames
    .filter((frame) => frame.event === "tool_result" && frame.data && typeof frame.data === "object")
    .map((frame) => ({
      name: frame.data.name ?? null,
      isError: Boolean(frame.data.is_error),
      result: typeof frame.data.result === "string" ? frame.data.result : JSON.stringify(frame.data.result ?? null),
    }));
}

function toolResult(results, name) {
  return results.find((result) => result.name === name) ?? null;
}

function parseJsonMaybe(value) {
  if (typeof value !== "string" || value.length === 0) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function assistantContextContents(frames) {
  for (let index = frames.length - 1; index >= 0; index -= 1) {
    const frame = frames[index];
    const contents = frame.data?.usage?.context_contents;
    if (contents && typeof contents === "object") return contents;
  }
  return null;
}

function contextBucketLabels(contents, bucket) {
  const items = contents?.[bucket];
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => item?.label)
    .filter((label) => typeof label === "string" && label.length > 0);
}

async function createHarnessProjectAgent(args, track, orgId, projectId, overrides = {}) {
  const agent = await createAgent(args, track, "local", overrides.model ?? null, orgId, {
    name: overrides.name,
    role: overrides.role ?? "status-probe",
    personality: overrides.personality,
    systemPrompt: overrides.systemPrompt,
    skills: overrides.skills,
    permissions: statusProbeHarnessPermissions(orgId),
  });
  const { agentInstanceId } = await createProjectAgentInstance(args, projectId, agent.agent_id);
  track("agent-instance", agentInstanceId, `/api/projects/${projectId}/agents/${agentInstanceId}`);
  return { agent, agentInstanceId };
}

async function fetchEvents(args, endpoint) {
  const payload = await apiJson(args, "GET", endpoint);
  const items = collectionItems(payload, ["events", "messages", "items", "data"]);
  return {
    payload,
    items,
    text: JSON.stringify(payload ?? null),
  };
}

async function waitForEventsContaining(args, endpoint, needle, timeoutMs = 90_000) {
  return waitForValue(async () => {
    const events = await fetchEvents(args, endpoint);
    return events.text.includes(needle) ? events : null;
  }, timeoutMs, 2000);
}

async function waitForEventsContainingOrEmpty(args, endpoint, needle, timeoutMs = 90_000) {
  try {
    return { ...(await waitForEventsContaining(args, endpoint, needle, timeoutMs)), error: null };
  } catch (error) {
    return {
      payload: null,
      items: [],
      text: "",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function waitForInstanceContext(args, projectId, agentInstanceId, timeoutMs = 45_000) {
  return waitForValue(async () => {
    const [usage, contents] = await Promise.all([
      apiJson(args, "GET", `/api/projects/${projectId}/agents/${agentInstanceId}/context-usage`),
      apiJson(args, "GET", `/api/projects/${projectId}/agents/${agentInstanceId}/context-contents`),
    ]);
    const utilization = Number(usage?.context_utilization ?? 0);
    const contextContents = contents?.context_contents ?? null;
    const hasContents = contextContents && Object.values(contextContents).some((value) => {
      if (Array.isArray(value)) return value.length > 0;
      return typeof value === "string" && value.length > 0;
    });
    return utilization > 0 && hasContents ? { usage, contents: contextContents } : null;
  }, timeoutMs, 2000);
}

async function waitForInstanceContextOrEmpty(args, projectId, agentInstanceId, timeoutMs = 45_000) {
  try {
    return { ...(await waitForInstanceContext(args, projectId, agentInstanceId, timeoutMs)), error: null };
  } catch (error) {
    return {
      usage: null,
      contents: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function childRunIdFrom(value) {
  return firstTruthyString(value, ["child_run_id", "childRunId", "run_id", "runId"]);
}

async function waitForSessionSubagentThread(args, projectId, agentInstanceId, sessionId, childRunId, timeoutMs = 45_000) {
  if (!sessionId) throw new Error("Parent chat stream did not return a session id");
  if (!childRunId) throw new Error("Parent chat stream did not emit a child run id");
  return waitForValue(async () => {
    const payload = await apiJson(
      args,
      "GET",
      `/api/projects/${projectId}/agents/${agentInstanceId}/sessions/${sessionId}/subagents`,
    );
    const items = collectionItems(payload, ["subagents", "items", "data"]);
    const match = items.find((item) => childRunIdFrom(item) === childRunId) ?? null;
    if (!match) return null;
    const state = String(match.state ?? "").toLowerCase();
    return state === "completed" ? { payload, items, match } : null;
  }, timeoutMs, 2000);
}

async function waitForSessionSubagentThreadOrEmpty(args, projectId, agentInstanceId, sessionId, childRunId, timeoutMs = 45_000) {
  try {
    return { ...(await waitForSessionSubagentThread(args, projectId, agentInstanceId, sessionId, childRunId, timeoutMs)), error: null };
  } catch (error) {
    return {
      payload: null,
      items: [],
      match: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function runSkillInvocationTurn(args, track) {
  const { orgId } = await requireOrgId(args);
  const { projectId } = await createProject(args, track, orgId);
  const skillName = `aura-status-skill-${Date.now()}`;
  let agentId = null;
  try {
    const { agent, agentInstanceId } = await createHarnessProjectAgent(args, track, orgId, projectId, {
      role: "SkillInvocationProbe",
      systemPrompt: "You are an AURA skill invocation probe. Follow installed skill instructions exactly.",
    });
    agentId = agent.agent_id;

    const created = await apiJson(args, "POST", "/api/harness/skills", {
      name: skillName,
      description: "Temporary skill proving installed skill instructions reach a real chat turn.",
      body: `When asked about AURA_SKILL_PROBE, answer exactly: ${SKILL_INVOCATION_PHRASE}. Do not add extra words.`,
      user_invocable: true,
      model_invocable: false,
      agent_id: agentId,
    });

    const frames = await apiSse(args, `/api/projects/${projectId}/agents/${agentInstanceId}/events/stream`, {
      content: "AURA_SKILL_PROBE",
      action: "chat",
      project_id: projectId,
      new_session: true,
    }, 120_000);
    const text = sseTextSample(frames).trim();
    const error = frames.find((frame) => frame.event === "error");
    const contextContents = assistantContextContents(frames);
    const skillLabels = contextBucketLabels(contextContents, "skills");
    const textMatches = text === SKILL_INVOCATION_PHRASE;
    const skillInContext = skillLabels.includes(skillName);
    const ok = !error && textMatches && skillInContext;

    return {
      status: ok ? CHECK_STATUS.PASS : CHECK_STATUS.FAIL,
      message: ok ? "" : "Installed skill was not invoked through a real project chat turn",
      evidence: {
        orgId,
        projectId,
        agentId,
        agentInstanceId,
        skillName,
        created: Boolean(created?.created ?? created?.ok ?? true),
        installedOnAgent: Boolean(created?.installed_on_agent ?? created?.installedOnAgent ?? true),
        frameTypes: frameTypes(frames),
        textSample: text.slice(0, 120),
        expectedPhrase: SKILL_INVOCATION_PHRASE,
        textMatches,
        skillLabels,
        skillInContext,
      },
    };
  } finally {
    if (agentId) {
      try {
        await apiJson(args, "DELETE", `/api/harness/agents/${agentId}/skills/${encodeURIComponent(skillName)}`);
      } catch {}
    }
    try {
      await apiJson(args, "DELETE", `/api/harness/skills/mine/${encodeURIComponent(skillName)}`);
    } catch {}
  }
}

async function runProjectToolRoundtrip(args, track) {
  const { orgId } = await requireOrgId(args);
  const { projectId } = await createProject(args, track, orgId);
  const { agent, agentInstanceId } = await createHarnessProjectAgent(args, track, orgId, projectId, {
    role: "ToolRoundtripProbe",
    systemPrompt: "You are an AURA tool roundtrip probe. Use the requested tools exactly and report exact failures.",
  });

  const frames = await apiSse(args, `/api/projects/${projectId}/agents/${agentInstanceId}/events/stream`, {
    content: [
      `Use write_file to create ${TOOL_FILE_NAME} with exactly: ${TOOL_FILE_MARKER}.`,
      `Then use read_file to read ${TOOL_FILE_NAME}.`,
      `Then use run_command with program "printf" and args ["${TOOL_SHELL_MARKER}\\n"].`,
      `After those tool results, reply with exactly: ${TOOL_PASS_MARKER}.`,
    ].join(" "),
    action: "chat",
    project_id: projectId,
    new_session: true,
  }, 180_000);

  const text = sseTextSample(frames).trim();
  const names = toolUseNames(frames);
  const results = toolResults(frames);
  const writeResult = toolResult(results, "write_file");
  const readResult = toolResult(results, "read_file");
  const commandResult = toolResult(results, "run_command");
  const commandJson = parseJsonMaybe(commandResult?.result);
  const writeOk = Boolean(writeResult && !writeResult.isError);
  const readBackOk = !readResult?.isError && String(readResult?.result ?? "").includes(TOOL_FILE_MARKER);
  const commandOk = !commandResult?.isError && (
    String(commandResult?.result ?? "").includes(TOOL_SHELL_MARKER) ||
    String(commandJson?.stdout ?? "").includes(TOOL_SHELL_MARKER)
  );
  const passMarkerPresent = text.includes(TOOL_PASS_MARKER);
  const requiredToolsUsed = ["write_file", "read_file", "run_command"].every((name) => names.includes(name));
  const error = frames.find((frame) => frame.event === "error");
  const ok = !error && requiredToolsUsed && writeOk && readBackOk && commandOk && passMarkerPresent;

  return {
    status: ok ? CHECK_STATUS.PASS : CHECK_STATUS.FAIL,
    message: ok ? "" : "Project agent did not complete file read/write and shell tool roundtrip",
    evidence: {
      orgId,
      projectId,
      agentId: agent.agent_id,
      agentInstanceId,
      frameTypes: frameTypes(frames),
      toolNames: [...new Set(names)],
      requiredToolsUsed,
      writeOk,
      readBackOk,
      commandOk,
      commandExitCode: commandJson?.exit_code ?? null,
      passMarkerPresent,
      textSample: text.slice(0, 120),
      expectedFileName: TOOL_FILE_NAME,
      expectedFileMarker: TOOL_FILE_MARKER,
      expectedShellMarker: TOOL_SHELL_MARKER,
    },
  };
}

async function runProjectAgentToAgentRoundtrip(args, track) {
  const { orgId } = await requireOrgId(args);
  const { projectId } = await createProject(args, track, orgId);
  const suffix = Date.now();
  const reviewerName = `aura-status-reviewer-${suffix}`;
  const planner = await createHarnessProjectAgent(args, track, orgId, projectId, {
    name: `aura-status-planner-${suffix}`,
    role: "AgentToAgentPlannerProbe",
    systemPrompt: "You are an AURA agent-to-agent probe. Use the requested tool exactly once, then stop.",
  });
  const reviewer = await createHarnessProjectAgent(args, track, orgId, projectId, {
    name: reviewerName,
    role: "AgentToAgentReviewerProbe",
    systemPrompt: `When another agent asks you to reply with ${A2A_REPLY_MARKER}, reply exactly: ${A2A_REPLY_MARKER}.`,
  });

  const listFrames = await apiSse(args, `/api/projects/${projectId}/agents/${planner.agentInstanceId}/events/stream`, {
    content: `Call list_agents exactly once and confirm whether it contains an agent named ${reviewerName}. Do not call send_to_agent in this turn.`,
    action: "chat",
    project_id: projectId,
    new_session: true,
  }, 180_000);

  const listResults = toolResults(listFrames);
  const listResult = toolResult(listResults, "list_agents");
  const listResultText = String(listResult?.result ?? "");
  const listResultContainsReviewer =
    listResultText.includes(reviewerName) || listResultText.includes(reviewer.agent.agent_id);

  const sendFrames = await apiSse(args, `/api/projects/${projectId}/agents/${planner.agentInstanceId}/events/stream`, {
    content: `Call send_to_agent exactly once with agent_id "${reviewer.agent.agent_id}" and message "Reply exactly: ${A2A_REPLY_MARKER}". Do not answer in text before the tool result. After the tool reports delivered, reply exactly: A2A_DELIVERED.`,
    action: "chat",
    project_id: projectId,
    new_session: true,
  }, 180_000);

  const frames = [...listFrames, ...sendFrames];
  const names = toolUseNames(frames);
  const results = toolResults(frames);
  const sendResult = toolResult(results, "send_to_agent");
  const sendJson = parseJsonMaybe(sendResult?.result);
  const sendResultText = String(sendResult?.result ?? "");
  const delivered = sendJson?.delivered === true || /"delivered"\s*:\s*true/.test(sendResultText);
  const targetAgentId = firstTruthyString(sendJson, ["target_agent_id", "targetAgentId", "agent_id", "agentId"]);
  const targetMatches = targetAgentId === reviewer.agent.agent_id;
  const [reviewerEvents, plannerEvents] = await Promise.all([
    waitForEventsContainingOrEmpty(args, `/api/agents/${reviewer.agent.agent_id}/events`, A2A_REPLY_MARKER, 120_000),
    waitForEventsContainingOrEmpty(args, `/api/agents/${planner.agent.agent_id}/events`, A2A_REPLY_MARKER, 120_000),
  ]);
  const listAgentsUsed = names.includes("list_agents");
  const sendToAgentUsed = names.includes("send_to_agent");
  const error = frames.find((frame) => frame.event === "error");
  const reviewerAckObserved = reviewerEvents.text.includes(A2A_REPLY_MARKER);
  const parentCallbackObserved = plannerEvents.text.includes(A2A_REPLY_MARKER);
  const ok =
    !error &&
    listAgentsUsed &&
    sendToAgentUsed &&
    delivered &&
    targetMatches &&
    reviewerAckObserved &&
    parentCallbackObserved;

  return {
    status: ok ? CHECK_STATUS.PASS : CHECK_STATUS.FAIL,
    message: ok ? "" : "Agent-to-agent send/callback roundtrip did not complete",
    evidence: {
      orgId,
      projectId,
      plannerAgentId: planner.agent.agent_id,
      plannerAgentInstanceId: planner.agentInstanceId,
      reviewerAgentId: reviewer.agent.agent_id,
      reviewerAgentInstanceId: reviewer.agentInstanceId,
      frameTypes: frameTypes(frames),
      toolNames: [...new Set(names)],
      listAgentsUsed,
      listResultContainsReviewer,
      sendToAgentUsed,
      delivered,
      targetMatches,
      targetAgentId,
      reviewerAckObserved,
      parentCallbackObserved,
      reviewerEventCount: reviewerEvents.items.length,
      plannerEventCount: plannerEvents.items.length,
      reviewerEventsError: reviewerEvents.error,
      plannerEventsError: plannerEvents.error,
      listTurnTextSample: sseTextSample(listFrames).slice(0, 160),
      sendTurnTextSample: sseTextSample(sendFrames).slice(0, 160),
      expectedReply: A2A_REPLY_MARKER,
    },
  };
}

async function runProjectSubagentRoundtrip(args, track) {
  const { orgId } = await requireOrgId(args);
  const { projectId } = await createProject(args, track, orgId);
  const { agent, agentInstanceId } = await createHarnessProjectAgent(args, track, orgId, projectId, {
    role: "SubagentRoundtripProbe",
    systemPrompt: "You are an AURA subagent probe. Use the task tool exactly when asked and report exact failures.",
  });

  const stream = await apiSseWithMeta(args, `/api/projects/${projectId}/agents/${agentInstanceId}/events/stream`, {
    content: `Use the task tool with subagent_type "explore" and spawn_mode "wait". Ask the subagent to list the project folder and return exactly: ${SUBAGENT_REPLY_MARKER}. Then relay ${SUBAGENT_REPLY_MARKER}.`,
    action: "chat",
    project_id: projectId,
    new_session: true,
  }, 180_000);
  const frames = stream.frames;

  const names = toolUseNames(frames);
  const results = toolResults(frames);
  const taskResult = toolResult(results, "task");
  const taskJson = parseJsonMaybe(taskResult?.result);
  const spawned = frames.find((frame) => frame.event === "subagent_spawned");
  const completed = frames.find((frame) => frame.event === "subagent_status" && frame.data?.state === "completed");
  const childRunId = childRunIdFrom(spawned?.data);
  const text = sseTextSample(frames);
  const subagentReturnedMarker =
    text.includes(SUBAGENT_REPLY_MARKER) ||
    String(taskResult?.result ?? "").includes(SUBAGENT_REPLY_MARKER) ||
    String(taskJson?.final_message ?? "").includes(SUBAGENT_REPLY_MARKER);
  const [context, sessionSubagents] = await Promise.all([
    waitForInstanceContextOrEmpty(args, projectId, agentInstanceId, 5_000),
    waitForSessionSubagentThreadOrEmpty(args, projectId, agentInstanceId, stream.headers.sessionId, childRunId),
  ]);
  const contextUtilization = Number(context.usage?.context_utilization ?? 0);
  const subagentContextLabels = contextBucketLabels(context.contents, "subagents");
  const toolsContextLabels = contextBucketLabels(context.contents, "tools");
  const sessionSubagentStates = sessionSubagents.items
    .map((item) => item?.state)
    .filter((state) => typeof state === "string" && state.length > 0);
  const sessionSubagentThreadMatchesChild = childRunIdFrom(sessionSubagents.match) === childRunId;
  const sessionSubagentCompleted = String(sessionSubagents.match?.state ?? "").toLowerCase() === "completed";
  const error = frames.find((frame) => frame.event === "error");
  const ok =
    !error &&
    names.includes("task") &&
    Boolean(spawned) &&
    Boolean(completed) &&
    !taskResult?.isError &&
    subagentReturnedMarker &&
    sessionSubagentThreadMatchesChild &&
    sessionSubagentCompleted;

  return {
    status: ok ? CHECK_STATUS.PASS : CHECK_STATUS.FAIL,
    message: ok ? "" : "Project agent subagent task did not complete with persisted child-thread evidence",
    evidence: {
      orgId,
      projectId,
      agentId: agent.agent_id,
      agentInstanceId,
      sessionId: stream.headers.sessionId,
      streamPersisted: stream.headers.persisted,
      frameTypes: frameTypes(frames),
      toolNames: [...new Set(names)],
      taskToolUsed: names.includes("task"),
      subagentSpawned: Boolean(spawned),
      subagentCompleted: Boolean(completed),
      subagentReturnedMarker,
      childRunId,
      sessionSubagentThreadCount: sessionSubagents.items.length,
      sessionSubagentThreadMatchesChild,
      sessionSubagentCompleted,
      sessionSubagentStates,
      sessionSubagentError: sessionSubagents.error,
      contextUtilization,
      subagentContextCount: subagentContextLabels.length,
      subagentContextLabels,
      toolsContextContainsTask: toolsContextLabels.includes("task"),
      contextError: context.error,
      expectedReply: SUBAGENT_REPLY_MARKER,
    },
  };
}

async function createRunnableProcessGraph(args, track, projectId, orgId) {
  const agent = await createAgent(args, track, "local", DEFAULT_MODELS[0], orgId);
  const process = await apiJson(args, "POST", "/api/processes", {
    name: `Status Probe Run ${Date.now()}`,
    description: "Temporary process run created by AURA feature health probes.",
    project_id: projectId,
    tags: ["aura-status-probe"],
  });
  const processId = idFrom(process, ["id", "process_id"]);
  track("process", processId, `/api/processes/${processId}`);

  const nodes = await apiJson(args, "GET", `/api/processes/${processId}/nodes`);
  const ignitionNode = collectionItems(nodes)
    .find((node) => String(node?.node_type ?? node?.nodeType ?? "").toLowerCase() === "ignition");
  const ignitionNodeId = firstTruthyString(ignitionNode, ["node_id", "nodeId", "id"]);
  if (!ignitionNodeId) throw new Error("Process create did not return an ignition node");

  const actionNode = await apiJson(args, "POST", `/api/processes/${processId}/nodes`, {
    node_type: "action",
    label: "Status probe action",
    agent_id: agent.agent_id,
    prompt: "Reply exactly: process probe ok",
    config: {},
    position_x: 520,
    position_y: 50,
  });
  const actionNodeId = idFrom(actionNode, ["node_id", "nodeId", "id"]);
  const connection = await apiJson(args, "POST", `/api/processes/${processId}/connections`, {
    source_node_id: ignitionNodeId,
    target_node_id: actionNodeId,
  });

  return {
    agent,
    processId,
    ignitionNodeId,
    actionNodeId,
    connectionId: firstTruthyString(connection, ["connection_id", "connectionId", "id"]),
  };
}

async function waitForRemoteReady(args, agentId) {
  const deadline = Date.now() + DEFAULT_REMOTE_TIMEOUT_MS;
  let latest = null;
  while (Date.now() < deadline) {
    latest = await apiJson(args, "GET", `/api/agents/${agentId}/remote_agent/state`, null, {
      timeoutMs: 20_000,
    });
    const state = String(latest.state ?? "").toLowerCase();
    if (["running", "idle", "ready"].includes(state)) return latest;
    if (state === "error") throw new Error(latest.error_message || "remote agent entered error state");
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  throw new Error(`remote agent did not become ready; last state=${latest?.state ?? "unknown"}`);
}

async function runChecks(args) {
  const checks = [];
  const selected = (id) => (args.checks ? args.checks.has(id) : true);

  if (selected("api-health")) {
    checks.push(await probe("api-health", "core-api", "API health endpoint", args, async () => {
      const response = await publicJson(args.baseUrl, "/health");
      return { status: response?.status === "ok" ? CHECK_STATUS.PASS : CHECK_STATUS.FAIL, evidence: response };
    }));
  }

  if (selected("auth-session")) {
    checks.push(await probe("auth-session", "core-api", "Authenticated session", args, async () => {
      if (!args.token) return { status: CHECK_STATUS.SKIP, message: "No access token configured" };
      const session = await apiJson(args, "GET", "/api/auth/session");
      return { evidence: { userPresent: Boolean(session?.user_id), keys: Object.keys(session ?? {}) } };
    }));
  }

  if (selected("auth-validate")) {
    checks.push(await probe("auth-validate", "identity-orgs", "Auth validation refresh", args, async () => {
      if (!args.token) return { status: CHECK_STATUS.SKIP, message: "No access token configured" };
      const session = await apiJson(args, "POST", "/api/auth/validate", {});
      return { evidence: { userIdPresent: Boolean(session?.user_id) } };
    }));
  }

  if (selected("system-info")) {
    checks.push(await probe("system-info", "core-api", "System info endpoint", args, async () => {
      if (!args.token) return { status: CHECK_STATUS.SKIP, message: "No access token configured" };
      const info = await apiJson(args, "GET", "/api/system/info");
      return { evidence: { keys: Object.keys(info ?? {}) } };
    }));
  }

  if (selected("workspace-defaults")) {
    checks.push(await probe("workspace-defaults", "desktop-runtime", "Workspace defaults endpoint", args, async () => {
      if (!args.token) return { status: CHECK_STATUS.SKIP, message: "No access token configured" };
      const defaults = await apiJson(args, "GET", "/api/system/workspace_defaults");
      return { evidence: { workspaceRootPresent: Boolean(defaults?.workspace_root) } };
    }));
  }

  if (selected("orgs-list")) {
    checks.push(await probe("orgs-list", "identity-orgs", "Organization membership list", args, async () => {
      if (!args.token) return { status: CHECK_STATUS.SKIP, message: "No access token configured" };
      const { orgId, orgCount } = await requireOrgId(args);
      return { evidence: { orgId, orgCount } };
    }));
  }

  if (selected("user-profile")) {
    checks.push(await probe("user-profile", "identity-orgs", "Current user profile", args, async () => {
      if (!args.token) return { status: CHECK_STATUS.SKIP, message: "No access token configured" };
      const me = await apiJson(args, "GET", "/api/users/me");
      return { evidence: { userIdPresent: Boolean(me?.user_id || me?.id), keys: Object.keys(me ?? {}) } };
    }));
  }

  if (selected("org-integrations-list")) {
    checks.push(await probe("org-integrations-list", "integrations-billing", "Org integrations list", args, async () => {
      if (!args.token) return { status: CHECK_STATUS.SKIP, message: "No access token configured" };
      const { orgId } = await requireOrgId(args);
      const integrations = await apiJson(args, "GET", `/api/orgs/${orgId}/integrations`);
      return { evidence: { orgId, count: Array.isArray(integrations) ? integrations.length : null } };
    }));
  }

  if (selected("org-tool-actions-list")) {
    checks.push(await probe("org-tool-actions-list", "integrations-billing", "Org tool action catalog", args, async () => {
      if (!args.token) return { status: CHECK_STATUS.SKIP, message: "No access token configured" };
      const { orgId } = await requireOrgId(args);
      const actions = await apiJson(args, "GET", `/api/orgs/${orgId}/tool-actions`);
      const tools = Array.isArray(actions) ? actions : actions?.tools;
      return { evidence: { orgId, count: Array.isArray(tools) ? tools.length : null } };
    }));
  }

  if (selected("org-tool-actions-contract")) {
    checks.push(await probe("org-tool-actions-contract", "integrations-billing", "Org tool action contract shape", args, async () => {
      if (!args.token) return { status: CHECK_STATUS.SKIP, message: "No access token configured" };
      const { orgId } = await requireOrgId(args);
      const catalog = await apiJson(args, "GET", `/api/orgs/${orgId}/tool-actions`);
      const tools = collectionItems(catalog, ["tools"]);
      const warnings = collectionItems(catalog, ["warnings"]);
      const malformedTools = tools.filter((tool) => !tool?.name || !tool?.inputSchema);
      return {
        status: malformedTools.length === 0 ? CHECK_STATUS.PASS : CHECK_STATUS.FAIL,
        message: malformedTools.length === 0 ? "" : "Tool catalog returned entries without name/inputSchema",
        evidence: {
          orgId,
          toolCount: tools.length,
          warningCount: warnings.length,
          malformedToolCount: malformedTools.length,
          sampleToolNames: tools.slice(0, 5).map((tool) => tool?.name).filter(Boolean),
        },
      };
    }));
  }

  if (selected("billing-status")) {
    checks.push(await probe("billing-status", "integrations-billing", "Subscription status", args, async () => {
      if (!args.token) return { status: CHECK_STATUS.SKIP, message: "No access token configured" };
      const subscription = await apiJson(args, "GET", "/api/subscriptions/me");
      return {
        evidence: {
          keys: Object.keys(subscription ?? {}),
          subscriptionKnown: typeof subscription?.is_subscribed === "boolean",
          plan: subscription?.plan ?? null,
        },
      };
    }));
  }

  if (selected("credits-balance")) {
    checks.push(await probe("credits-balance", "integrations-billing", "Credits balance", args, async () => {
      if (!args.token) return { status: CHECK_STATUS.SKIP, message: "No access token configured" };
      const { orgId } = await requireOrgId(args);
      const balance = await apiJson(args, "GET", `/api/orgs/${orgId}/credits/balance`);
      return { evidence: { orgId, keys: Object.keys(balance ?? {}) } };
    }));
  }

  if (selected("billing-account-transactions")) {
    checks.push(await probe("billing-account-transactions", "integrations-billing", "Billing account and transaction reads", args, async () => {
      if (!args.token) return { status: CHECK_STATUS.SKIP, message: "No access token configured" };
      const { orgId } = await requireOrgId(args);
      const [account, transactions] = await Promise.all([
        apiJson(args, "GET", `/api/orgs/${orgId}/account`),
        apiJson(args, "GET", `/api/orgs/${orgId}/credits/transactions`),
      ]);
      const transactionItems = collectionItems(transactions, ["transactions"]);
      return {
        evidence: {
          orgId,
          accountKeys: Object.keys(account ?? {}),
          accountIdPresent: Boolean(account?.id ?? account?.account_id ?? account?.user_id),
          transactionsKnown: Array.isArray(transactions?.transactions),
          transactionCount: transactionItems.length,
        },
      };
    }));
  }

  if (selected("project-crud")) {
    checks.push(await probe("project-crud", "projects-specs-tasks", "Project create/list/get/delete", args, async () => {
      if (!args.token) return { status: CHECK_STATUS.SKIP, message: "No access token configured" };
      return withCleanup(args, async (track) => {
        const { orgId } = await requireOrgId(args);
        const { projectId } = await createProject(args, track, orgId);
        const project = await apiJson(args, "GET", `/api/projects/${projectId}`);
        const projects = await apiJson(args, "GET", `/api/projects?org_id=${encodeURIComponent(orgId)}`);
        return { evidence: { orgId, projectId, listed: Array.isArray(projects), projectName: project?.name ?? null } };
      });
    }));
  }

  if (selected("spec-task-crud")) {
    checks.push(await probe("spec-task-crud", "projects-specs-tasks", "Spec and task CRUD", args, async () => {
      if (!args.token) return { status: CHECK_STATUS.SKIP, message: "No access token configured" };
      return withCleanup(args, async (track) => {
        const { orgId } = await requireOrgId(args);
        const { projectId } = await createProject(args, track, orgId);
        const { specId } = await createSpec(args, projectId);
        const fetchedSpec = await apiJson(args, "GET", `/api/projects/${projectId}/specs/${specId}`);
        const { taskId } = await createTask(args, projectId, specId);
        const tasks = await apiJson(args, "GET", `/api/projects/${projectId}/tasks`);
        await apiJson(args, "DELETE", `/api/projects/${projectId}/tasks/${taskId}`);
        await apiJson(args, "DELETE", `/api/projects/${projectId}/specs/${specId}`);
        return {
          evidence: {
            orgId,
            projectId,
            specId,
            taskId,
            specHashPresent: Boolean(fetchedSpec?.content_hash),
            taskCount: Array.isArray(tasks) ? tasks.length : null,
          },
        };
      });
    }));
  }

  if (selected("project-stats")) {
    checks.push(await probe("project-stats", "projects-specs-tasks", "Project stats endpoint", args, async () => {
      if (!args.token) return { status: CHECK_STATUS.SKIP, message: "No access token configured" };
      return withCleanup(args, async (track) => {
        const { orgId } = await requireOrgId(args);
        const { projectId } = await createProject(args, track, orgId);
        const stats = await apiJson(args, "GET", `/api/projects/${projectId}/stats`);
        return { evidence: { projectId, keys: Object.keys(stats ?? {}) } };
      });
    }));
  }

  if (selected("loop-status")) {
    checks.push(await probe("loop-status", "projects-specs-tasks", "Dev loop status endpoint", args, async () => {
      if (!args.token) return { status: CHECK_STATUS.SKIP, message: "No access token configured" };
      return withCleanup(args, async (track) => {
        const { orgId } = await requireOrgId(args);
        const { projectId } = await createProject(args, track, orgId);
        const status = await apiJson(args, "GET", `/api/projects/${projectId}/loop/status`);
        return { evidence: { projectId, status: status?.status ?? status?.state ?? null, keys: Object.keys(status ?? {}) } };
      });
    }));
  }

  if (selected("notes-crud")) {
    checks.push(await probe("notes-crud", "notes-knowledge", "Notes folder/note/comment CRUD", args, async () => {
      if (!args.token) return { status: CHECK_STATUS.SKIP, message: "No access token configured" };
      return withCleanup(args, async (track) => {
        const { orgId } = await requireOrgId(args);
        const { projectId } = await createProject(args, track, orgId);
        const folder = await apiJson(args, "POST", `/api/notes/projects/${projectId}/folders`, {
          name: `Status Probe Folder ${Date.now()}`,
          parentId: null,
          sortOrder: 0,
        });
        const folderId = idFrom(folder, ["id", "folder_id"]);
        const note = await apiJson(args, "POST", `/api/notes/projects/${projectId}/notes`, {
          title: "Status Probe Note",
          slug: `status-probe-${Date.now()}`,
          folderId,
        });
        const noteId = idFrom(note, ["id", "note_id"]);
        const fetched = await apiJson(args, "GET", `/api/notes/projects/${projectId}/notes/${noteId}`);
        const updated = await apiJson(args, "PUT", `/api/notes/projects/${projectId}/notes/${noteId}`, {
          title: "Status Probe Note Updated",
          folderId,
          wordCount: 7,
        });
        const transitioned = await apiJson(args, "POST", `/api/notes/projects/${projectId}/notes/${noteId}/transition`, {
          status: "draft",
        });
        const comment = await apiJson(args, "POST", `/api/notes/projects/${projectId}/notes/${noteId}/comments`, {
          body: "Status probe comment",
          authorName: "AURA Status",
        });
        const commentId = idFrom(comment, ["id", "comment_id"]);
        const comments = await apiJson(args, "GET", `/api/notes/projects/${projectId}/notes/${noteId}/comments`);
        const tree = await apiJson(args, "GET", `/api/notes/projects/${projectId}/tree`);

        await apiJson(args, "DELETE", `/api/notes/projects/${projectId}/notes/${noteId}/comments/${commentId}`);
        await apiJson(args, "DELETE", `/api/notes/projects/${projectId}/notes/${noteId}`);
        await apiJson(args, "DELETE", `/api/notes/projects/${projectId}/folders/${folderId}`);

        const linkedFolderId = fetched?.folderId ?? fetched?.folder_id ?? note?.folderId ?? note?.folder_id ?? null;
        const folderLinked = linkedFolderId === folderId;
        const titleUpdated = (updated?.title ?? "") === "Status Probe Note Updated";
        return {
          status: folderLinked && titleUpdated ? CHECK_STATUS.PASS : CHECK_STATUS.FAIL,
          message: folderLinked && titleUpdated ? "" : "Notes CRUD did not preserve folder linkage or note update fields",
          evidence: {
            orgId,
            projectId,
            folderId,
            noteId,
            commentId,
            folderLinked,
            titleUpdated,
            transitionStatus: transitioned?.status ?? null,
            commentCount: Array.isArray(comments) ? comments.length : null,
            treeFolderCount: Array.isArray(tree?.folders) ? tree.folders.length : null,
            treeNoteCount: Array.isArray(tree?.notes) ? tree.notes.length : null,
          },
        };
      });
    }));
  }

  if (selected("process-list")) {
    checks.push(await probe("process-list", "process-workflows", "Process and folder lists", args, async () => {
      if (!args.token) return { status: CHECK_STATUS.SKIP, message: "No access token configured" };
      const [processes, folders] = await Promise.all([
        apiJson(args, "GET", "/api/processes"),
        apiJson(args, "GET", "/api/process-folders"),
      ]);
      return { evidence: { processes: Array.isArray(processes) ? processes.length : null, folders: Array.isArray(folders) ? folders.length : null } };
    }));
  }

  if (selected("process-crud")) {
    checks.push(await probe("process-crud", "process-workflows", "Process create/nodes/delete", args, async () => {
      if (!args.token) return { status: CHECK_STATUS.SKIP, message: "No access token configured" };
      return withCleanup(args, async (track) => {
        const { orgId } = await requireOrgId(args);
        const { projectId } = await createProject(args, track, orgId);
        const process = await apiJson(args, "POST", "/api/processes", {
          name: `Status Probe Process ${Date.now()}`,
          description: "Temporary process created by AURA feature health probes.",
          project_id: projectId,
          tags: ["aura-status-probe"],
        });
        const processId = extractId(process, ["id", "process_id"]);
        track("process", processId, `/api/processes/${processId}`);
        const nodes = await apiJson(args, "GET", `/api/processes/${processId}/nodes`);
        return { evidence: { projectId, processId, nodeCount: Array.isArray(nodes) ? nodes.length : null } };
      });
    }));
  }

  if (selected("process-run-lifecycle")) {
    checks.push(await probe("process-run-lifecycle", "process-workflows", "Process trigger/run lifecycle", args, async () => {
      if (!args.token) return { status: CHECK_STATUS.SKIP, message: "No access token configured" };
      return withCleanup(args, async (track) => {
        const { orgId } = await requireOrgId(args);
        const { projectId } = await createProject(args, track, orgId);
        const {
          agent,
          processId,
          ignitionNodeId,
          actionNodeId,
          connectionId,
        } = await createRunnableProcessGraph(args, track, projectId, orgId);
        const run = await apiJson(args, "POST", `/api/processes/${processId}/trigger`, null, { timeoutMs: 60_000 });
        const runId = idFrom(run, ["id", "run_id", "process_run_id"]);
        const fetchedRun = await apiJson(args, "GET", `/api/processes/${processId}/runs/${runId}`);
        const runs = await apiJson(args, "GET", `/api/processes/${processId}/runs`);
        const events = await apiJson(args, "GET", `/api/processes/${processId}/runs/${runId}/events`);
        const artifacts = await apiJson(args, "GET", `/api/processes/${processId}/runs/${runId}/artifacts`);
        const runStatus = String(fetchedRun?.status ?? run?.status ?? "").toLowerCase();
        if (["pending", "queued", "running", "active", "in_progress"].includes(runStatus)) {
          try {
            await apiJson(args, "POST", `/api/processes/${processId}/runs/${runId}/cancel`, null);
          } catch {
            // A fast process can finish between fetch and cancel; the observed run already proves trigger wiring.
          }
        }
        return {
          evidence: {
            orgId,
            projectId,
            agentId: agent.agent_id,
            processId,
            ignitionNodeId,
            actionNodeId,
            connectionId,
            runId,
            runStatus: fetchedRun?.status ?? run?.status ?? null,
            runCount: Array.isArray(runs) ? runs.length : null,
            eventCount: Array.isArray(events) ? events.length : null,
            artifactCount: Array.isArray(artifacts) ? artifacts.length : null,
          },
        };
      });
    }));
  }

  if (selected("marketplace-agents")) {
    checks.push(await probe("marketplace-agents", "marketplace-bootstrap", "Marketplace agents catalog", args, async () => {
      if (!args.token) return { status: CHECK_STATUS.SKIP, message: "No access token configured" };
      const agents = await apiJson(args, "GET", "/api/marketplace/agents");
      return { evidence: { count: collectionCount(agents, ["total", "agents"]) } };
    }));
  }

  if (selected("harness-health")) {
    checks.push(await probe("harness-health", "marketplace-bootstrap", "Harness bootstrap health", args, async () => {
      if (!args.token) return { status: CHECK_STATUS.SKIP, message: "No access token configured" };
      const health = await apiJson(args, "GET", "/api/agents/harness/health");
      return { evidence: health };
    }));
  }

  if (selected("harness-memory-roundtrip")) {
    checks.push(await probe("harness-memory-roundtrip", "harness-memory-skills", "Harness memory roundtrip", args, async () => {
      if (!args.token) return { status: CHECK_STATUS.SKIP, message: "No access token configured" };
      return withCleanup(args, async (track) => {
        const { orgId } = await requireOrgId(args);
        const agent = await createAgent(args, track, "local", null, orgId);
        const key = `status_probe_${Date.now()}`;
        const fact = await apiJson(args, "POST", `/api/harness/agents/${agent.agent_id}/memory/facts`, {
          key,
          value: { status: "ok" },
          confidence: 0.99,
          importance: 0.2,
        });
        const factId = idFrom(fact, ["id", "fact_id"]);
        const fetchedFact = await apiJson(args, "GET", `/api/harness/agents/${agent.agent_id}/memory/facts/by-key/${encodeURIComponent(key)}`);
        const updatedFact = await apiJson(args, "PUT", `/api/harness/agents/${agent.agent_id}/memory/facts/${factId}`, {
          key,
          value: { status: "updated" },
          confidence: 0.95,
          importance: 0.2,
        });
        const event = await apiJson(args, "POST", `/api/harness/agents/${agent.agent_id}/memory/events`, {
          event_type: "status_probe",
          summary: "AURA status memory event",
          metadata: { key },
          importance: 0.2,
        });
        const eventId = idFrom(event, ["id", "event_id"]);
        const procedure = await apiJson(args, "POST", `/api/harness/agents/${agent.agent_id}/memory/procedures`, {
          name: "status_probe_procedure",
          trigger: "status probe",
          steps: ["write fact", "read fact"],
          skill_name: "status-probe",
          skill_relevance: 0.4,
        });
        const procedureId = idFrom(procedure, ["id", "procedure_id", "proc_id"]);
        const [facts, events, procedures, bySkill, snapshot, stats] = await Promise.all([
          apiJson(args, "GET", `/api/harness/agents/${agent.agent_id}/memory/facts`),
          apiJson(args, "GET", `/api/harness/agents/${agent.agent_id}/memory/events?limit=10&event_type=status_probe`),
          apiJson(args, "GET", `/api/harness/agents/${agent.agent_id}/memory/procedures`),
          apiJson(args, "GET", `/api/harness/agents/${agent.agent_id}/memory/procedures/by-skill/status-probe`),
          apiJson(args, "GET", `/api/harness/agents/${agent.agent_id}/memory`),
          apiJson(args, "GET", `/api/harness/agents/${agent.agent_id}/memory/stats`),
        ]);
        await apiJson(args, "DELETE", `/api/harness/agents/${agent.agent_id}/memory/procedures/${procedureId}`);
        await apiJson(args, "DELETE", `/api/harness/agents/${agent.agent_id}/memory/events/${eventId}`);
        await apiJson(args, "DELETE", `/api/harness/agents/${agent.agent_id}/memory/facts/${factId}`);
        return {
          evidence: {
            orgId,
            agentId: agent.agent_id,
            factId,
            eventId,
            procedureId,
            factKey: key,
            factByKeyMatches: firstTruthyString(fetchedFact, ["key"]) === key,
            updatedFactPresent: updatedFact != null,
            factCount: collectionCount(facts, ["facts"]),
            eventCount: collectionCount(events, ["events"]),
            procedureCount: collectionCount(procedures, ["procedures"]),
            bySkillCount: collectionCount(bySkill, ["procedures"]),
            snapshotKeys: Object.keys(snapshot ?? {}),
            statsKeys: Object.keys(stats ?? {}),
          },
        };
      });
    }));
  }

  if (selected("harness-skills-roundtrip")) {
    checks.push(await probe("harness-skills-roundtrip", "harness-memory-skills", "Harness skill create/install/list/delete", args, async () => {
      if (!args.token) return { status: CHECK_STATUS.SKIP, message: "No access token configured" };
      const skillName = `aura-status-${Date.now()}`;
      let agentId = null;
      try {
        return await withCleanup(args, async (track) => {
          const { orgId } = await requireOrgId(args);
          const agent = await createAgent(args, track, "local", null, orgId);
          agentId = agent.agent_id;
          const created = await apiJson(args, "POST", "/api/harness/skills", {
            name: skillName,
            description: "Temporary skill created by AURA feature health probes.",
            body: "Use this only to prove skill create/list/install/delete wiring.",
            user_invocable: true,
            model_invocable: false,
            agent_id: agentId,
          });
          const [catalog, mine, agentSkills] = await Promise.all([
            apiJson(args, "GET", "/api/harness/skills"),
            apiJson(args, "GET", "/api/harness/skills/mine"),
            apiJson(args, "GET", `/api/harness/agents/${agentId}/skills`),
          ]);
          const catalogItems = collectionItems(catalog, ["skills"]);
          const mySkillItems = collectionItems(mine, ["skills"]);
          const agentSkillItems = collectionItems(agentSkills, ["skills", "installations"]);
          const mineContainsSkill = mySkillItems.some((skill) => skill?.name === skillName);
          const agentContainsSkill = agentSkillItems.some((skill) => skill?.skill_name === skillName || skill?.name === skillName);
          await apiJson(args, "DELETE", `/api/harness/agents/${agentId}/skills/${encodeURIComponent(skillName)}`);
          const deleted = await apiJson(args, "DELETE", `/api/harness/skills/mine/${encodeURIComponent(skillName)}`);
          return {
            status: mineContainsSkill && agentContainsSkill ? CHECK_STATUS.PASS : CHECK_STATUS.FAIL,
            message: mineContainsSkill && agentContainsSkill ? "" : "Created skill was not visible in my skills and agent installations",
            evidence: {
              orgId,
              agentId,
              skillName,
              created: Boolean(created?.created ?? created?.ok ?? true),
              registered: Boolean(created?.registered ?? true),
              installedOnAgent: Boolean(created?.installed_on_agent ?? created?.installedOnAgent ?? agentContainsSkill),
              catalogCount: catalogItems.length,
              mySkillsCount: mySkillItems.length,
              agentSkillsCount: agentSkillItems.length,
              mineContainsSkill,
              agentContainsSkill,
              deleted: Boolean(deleted?.deleted ?? true),
            },
          };
        });
      } finally {
        if (agentId) {
          try {
            await apiJson(args, "DELETE", `/api/harness/agents/${agentId}/skills/${encodeURIComponent(skillName)}`);
          } catch {}
        }
        try {
          await apiJson(args, "DELETE", `/api/harness/skills/mine/${encodeURIComponent(skillName)}`);
        } catch {}
      }
    }));
  }

  if (selected("harness-skill-invocation")) {
    checks.push(await probe("harness-skill-invocation", "harness-memory-skills", "Harness skill real chat invocation", args, async () => {
      if (!args.token) return { status: CHECK_STATUS.SKIP, message: "No access token configured" };
      return withCleanup(args, async (track) => runSkillInvocationTurn(args, track));
    }));
  }

  if (selected("active-streams")) {
    checks.push(await probe("active-streams", "streams-debug", "Active stream registry", args, async () => {
      if (!args.token) return { status: CHECK_STATUS.SKIP, message: "No access token configured" };
      const streams = await apiJson(args, "GET", "/api/streams/active");
      return { evidence: { count: collectionCount(streams, ["streams"]) } };
    }));
  }

  if (selected("debug-projects")) {
    checks.push(await probe("debug-projects", "streams-debug", "Debug project index", args, async () => {
      if (!args.token) return { status: CHECK_STATUS.SKIP, message: "No access token configured" };
      const projects = await apiJson(args, "GET", "/api/debug/projects");
      return { evidence: { keys: Object.keys(projects ?? {}) } };
    }));
  }

  if (selected("terminal-list")) {
    checks.push(await probe("terminal-list", "desktop-runtime", "Terminal session list", args, async () => {
      if (!args.token) return { status: CHECK_STATUS.SKIP, message: "No access token configured" };
      const terminals = await apiJson(args, "GET", "/api/terminal");
      return { evidence: { count: Array.isArray(terminals) ? terminals.length : null } };
    }));
  }

  if (selected("desktop-update-runtime")) {
    checks.push(await probe("desktop-update-runtime", "desktop-runtime", "Desktop updater/runtime config", args, async () => {
      if (!args.token) return { status: CHECK_STATUS.SKIP, message: "No access token configured" };
      const [updateStatus, runtimeConfig, bundleInfo] = await Promise.all([
        apiJson(args, "GET", "/api/update-status"),
        apiJson(args, "GET", "/api/runtime-config"),
        apiJson(args, "GET", "/api/update-bundle-info"),
      ]);
      return {
        evidence: {
          currentVersionPresent: Boolean(updateStatus?.current_version),
          channel: updateStatus?.channel ?? null,
          updaterSupportedKnown: typeof updateStatus?.supported === "boolean",
          localHarnessUrlPresent: Boolean(runtimeConfig?.local_harness_url),
          harnessBinaryPresent: Boolean(runtimeConfig?.harness_binary),
          routerUrlPresent: Boolean(runtimeConfig?.aura_router_url),
          bundleOk: Boolean(bundleInfo?.ok),
          bundleSupportedKnown: typeof bundleInfo?.supported === "boolean",
        },
      };
    }));
  }

  if (selected("feedback-list")) {
    checks.push(await probe("feedback-list", "community-feedback", "Feedback list", args, async () => {
      if (!args.token) return { status: CHECK_STATUS.SKIP, message: "No access token configured" };
      const feedback = await apiJson(args, "GET", "/api/feedback");
      return { evidence: { count: Array.isArray(feedback) ? feedback.length : null } };
    }));
  }

  if (selected("bug-reports-mine")) {
    checks.push(await probe("bug-reports-mine", "community-feedback", "My bug reports list", args, async () => {
      if (!args.token) return { status: CHECK_STATUS.SKIP, message: "No access token configured" };
      const reports = await apiJson(args, "GET", "/api/bug-reports/mine");
      return { evidence: { count: Array.isArray(reports) ? reports.length : null } };
    }));
  }

  if (selected("feed-list")) {
    checks.push(await probe("feed-list", "community-feedback", "Feed list", args, async () => {
      if (!args.token) return { status: CHECK_STATUS.SKIP, message: "No access token configured" };
      const feed = await apiJson(args, "GET", "/api/feed");
      return { evidence: { count: Array.isArray(feed) ? feed.length : null } };
    }));
  }

  if (selected("leaderboard")) {
    checks.push(await probe("leaderboard", "community-feedback", "Leaderboard", args, async () => {
      if (!args.token) return { status: CHECK_STATUS.SKIP, message: "No access token configured" };
      const leaderboard = await apiJson(args, "GET", "/api/leaderboard?period=week&limit=10");
      return { evidence: { count: Array.isArray(leaderboard) ? leaderboard.length : null } };
    }));
  }

  if (selected("platform-stats")) {
    checks.push(await probe("platform-stats", "community-feedback", "Platform stats", args, async () => {
      if (!args.token) return { status: CHECK_STATUS.SKIP, message: "No access token configured" };
      const stats = await apiJson(args, "GET", "/api/stats");
      return { evidence: { present: stats != null, keys: Object.keys(stats ?? {}) } };
    }));
  }

  if (selected("local-agent-create")) {
    checks.push(await probe("local-agent-create", "local-agents", "Local agent creation", args, async () => {
      if (!args.token) return { status: CHECK_STATUS.SKIP, message: "No access token configured" };
      return withCleanup(args, async (track) => {
        const { orgId } = await requireOrgId(args);
        const agent = await createAgent(args, track, "local", null, orgId);
        return { evidence: { orgId, agentId: agent.agent_id, machineType: agent.machine_type, environment: agent.environment } };
      });
    }));
  }

  if (selected("local-agent-runtime")) {
    checks.push(await probe("local-agent-runtime", "local-agents", "Local agent runtime response", args, async () => {
      if (!args.token) return { status: CHECK_STATUS.SKIP, message: "No access token configured" };
      return withCleanup(args, async (track) => {
        const { orgId } = await requireOrgId(args);
        const agent = await createAgent(args, track, "local", null, orgId);
        const runtime = await runRuntimeTest(args, agent.agent_id, 60_000);
        const ok = String(runtime?.message ?? "").toLowerCase().includes(EXPECTED_RUNTIME_PHRASE);
        return {
          status: ok ? CHECK_STATUS.PASS : CHECK_STATUS.FAIL,
          message: ok ? "" : "Runtime response did not contain expected phrase",
          evidence: { orgId, agentId: agent.agent_id, model: runtime?.model, provider: runtime?.provider, message: runtime?.message },
        };
      });
    }));
  }

  if (selected("local-agent-permissions")) {
    checks.push(await probe("local-agent-permissions", "local-agents", "Local agent persisted permissions", args, async () => {
      if (!args.token) return { status: CHECK_STATUS.SKIP, message: "No access token configured" };
      return withCleanup(args, async (track) => {
        const { orgId } = await requireOrgId(args);
        const agent = await createAgent(args, track, "local", null, orgId);
        const fetched = await apiJson(args, "GET", `/api/agents/${agent.agent_id}`);
        const evidence = {
          orgId,
          agentId: agent.agent_id,
          ...permissionEvidence(fetched?.permissions ?? agent?.permissions, orgId),
        };
        const ok =
          evidence.permissionsPresent &&
          evidence.orgScoped &&
          evidence.projectScopeEmpty &&
          evidence.agentScopeEmpty &&
          evidence.capabilityCount === 0;
        return {
          status: ok ? CHECK_STATUS.PASS : CHECK_STATUS.FAIL,
          message: ok ? "" : "Local status probe agent permissions did not persist as org-scoped and capability-free",
          evidence,
        };
      });
    }));
  }

  if (selected("project-agent-chat-stream")) {
    checks.push(await probe("project-agent-chat-stream", "project-agent-workflows", "Project agent chat stream", args, async () => {
      if (!args.token) return { status: CHECK_STATUS.SKIP, message: "No access token configured" };
      return withCleanup(args, async (track) => runProjectChatTurn(args, track));
    }));
  }

  if (selected("project-agent-tool-roundtrip")) {
    checks.push(await probe("project-agent-tool-roundtrip", "project-agent-workflows", "Project agent tool roundtrip", args, async () => {
      if (!args.token) return { status: CHECK_STATUS.SKIP, message: "No access token configured" };
      return withCleanup(args, async (track) => runProjectToolRoundtrip(args, track));
    }));
  }

  if (selected("project-agent-a2a-roundtrip")) {
    checks.push(await probe("project-agent-a2a-roundtrip", "project-agent-workflows", "Project agent-to-agent roundtrip", args, async () => {
      if (!args.token) return { status: CHECK_STATUS.SKIP, message: "No access token configured" };
      return withCleanup(args, async (track) => runProjectAgentToAgentRoundtrip(args, track));
    }));
  }

  if (selected("project-agent-subagent-roundtrip")) {
    checks.push(await probe("project-agent-subagent-roundtrip", "project-agent-workflows", "Project agent subagent roundtrip", args, async () => {
      if (!args.token) return { status: CHECK_STATUS.SKIP, message: "No access token configured" };
      return withCleanup(args, async (track) => runProjectSubagentRoundtrip(args, track));
    }));
  }

  if (selected("session-share-public-read")) {
    checks.push(await probe("session-share-public-read", "project-agent-workflows", "Session share public read", args, async () => {
      if (!args.token) return { status: CHECK_STATUS.SKIP, message: "No access token configured" };
      return withCleanup(args, async (track) => {
        const chat = await runProjectChatTurn(args, track);
        if (chat.status === CHECK_STATUS.FAIL) return chat;
        const { projectId, agentInstanceId, sessionId } = chat.evidence;
        const share = await apiJson(args, "POST", `/api/projects/${projectId}/agents/${agentInstanceId}/sessions/${sessionId}/share`, null);
        const shareId = firstTruthyString(share, ["shareId", "share_id"]);
        if (!shareId) throw new Error("Session share response did not include shareId");
        const shareReadBaseUrl = args.publicApiBaseUrl || args.publicBaseUrl || args.baseUrl;
        const publicMessages = await waitForValue(async () => {
          try {
            const payload = await publicJson(shareReadBaseUrl, `/api/public/share/${encodeURIComponent(shareId)}`);
            return collectionItems(payload, ["messages", "events"]).length > 0 ? payload : null;
          } catch (error) {
            if (error instanceof Error && error.message.includes("failed with 404")) return null;
            throw error;
          }
        }, 30_000, 1500);
        return {
          evidence: {
            projectId,
            agentInstanceId,
            sessionId,
            shareIdPresent: Boolean(shareId),
            shareUrlPresent: Boolean(share?.url),
            shareReadBaseUrl,
            publicMessageCount: collectionCount(publicMessages, ["messages", "events"]),
            textSample: chat.evidence.textSample,
          },
        };
      });
    }));
  }

  if (selected("remote-agent-create")) {
    checks.push(await probe("remote-agent-create", "remote-agents", "Remote agent creation", args, async () => {
      if (!args.token) return { status: CHECK_STATUS.SKIP, message: "No access token configured" };
      return withCleanup(args, async (track) => {
        const { orgId } = await requireOrgId(args);
        const agent = await createAgent(args, track, "remote", null, orgId);
        const state = await waitForRemoteReady(args, agent.agent_id);
        return {
          evidence: {
            orgId,
            agentId: agent.agent_id,
            vmIdPresent: Boolean(agent.vm_id || state?.agent_id),
            remoteState: state.state,
            runtimeVersion: state.runtime_version ?? null,
          },
        };
      });
    }));
  }

  if (selected("remote-agent-state")) {
    checks.push(await probe("remote-agent-state", "remote-agents", "Remote agent state polling", args, async () => {
      if (!args.token) return { status: CHECK_STATUS.SKIP, message: "No access token configured" };
      return withCleanup(args, async (track) => {
        const { orgId } = await requireOrgId(args);
        const agent = await createAgent(args, track, "remote", null, orgId);
        const readyState = await waitForRemoteReady(args, agent.agent_id);
        const state = await apiJson(args, "GET", `/api/agents/${agent.agent_id}/remote_agent/state`);
        return { evidence: { orgId, agentId: agent.agent_id, readyState, state } };
      });
    }));
  }

  if (selected("remote-agent-runtime")) {
    checks.push(await probe("remote-agent-runtime", "remote-agents", "Remote agent runtime response", args, async () => {
      if (!args.token) return { status: CHECK_STATUS.SKIP, message: "No access token configured" };
      return withCleanup(args, async (track) => {
        const { orgId } = await requireOrgId(args);
        const agent = await createAgent(args, track, "remote", null, orgId);
        await waitForRemoteReady(args, agent.agent_id);
        const runtime = await runRuntimeTest(args, agent.agent_id, 90_000);
        const ok = String(runtime?.message ?? "").toLowerCase().includes(EXPECTED_RUNTIME_PHRASE);
        return {
          status: ok ? CHECK_STATUS.PASS : CHECK_STATUS.FAIL,
          message: ok ? "" : "Runtime response did not contain expected phrase",
          evidence: { orgId, agentId: agent.agent_id, model: runtime?.model, provider: runtime?.provider, message: runtime?.message },
        };
      });
    }));
  }

  if (selected("model-matrix")) {
    checks.push(await probe("model-matrix", "model-responses", "Model matrix runtime responses", args, async () => {
      if (!args.token) return { status: CHECK_STATUS.SKIP, message: "No access token configured" };
      const results = [];
      const { orgId } = await requireOrgId(args);
      for (const model of args.models) {
        try {
          const result = await withCleanup(args, async (track) => {
            const agent = await createAgent(args, track, "local", model, orgId);
            const runtime = await runRuntimeTest(args, agent.agent_id, 150_000);
            const message = String(runtime?.message ?? "");
            return {
              model,
              ok: message.toLowerCase().includes(EXPECTED_RUNTIME_PHRASE),
              provider: runtime?.provider ?? null,
              resolvedModel: runtime?.model ?? null,
              messageSample: message.slice(0, 120),
            };
          });
          results.push(result);
        } catch (error) {
          results.push({
            model,
            ok: false,
            provider: null,
            resolvedModel: null,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      const passed = results.filter((result) => result.ok).length;
      const failedModels = results.filter((result) => !result.ok).map((result) => result.model);
      const allPassed = passed === results.length;
      return {
        status: allPassed ? CHECK_STATUS.PASS : CHECK_STATUS.FAIL,
        message: `${passed}/${results.length} models returned the expected response`,
        evidence: {
          orgId,
          passed,
          total: results.length,
          allPassed,
          failedModelCount: failedModels.length,
          failedModels,
          expectedPhrase: EXPECTED_RUNTIME_PHRASE,
          results,
        },
      };
    }));
  }

  if (selected("image-generation-stream")) {
    checks.push(await probe("image-generation-stream", "media-generation", "Image generation stream", args, async () => {
      if (!args.token) return { status: CHECK_STATUS.SKIP, message: "No access token configured" };
      const frames = await apiSse(args, "/api/generate/image/stream", {
        prompt: "A minimal black AURA status check glyph on a white background",
        model: process.env.AURA_STATUS_IMAGE_MODEL || "gpt-image-2",
        size: "1024x1024",
      }, 360_000);
      const completed = frames.find((frame) => frame.event === "generation_completed");
      const error = frames.find((frame) => frame.event === "generation_error");
      const imageUrl = completed?.data?.imageUrl ?? completed?.data?.image_url;
      const frameTypes = frames.map((frame) => frame.event);
      if (error) {
        return {
          status: CHECK_STATUS.FAIL,
          message: error.data?.message ?? "Image generation error",
          evidence: {
            frameTypes,
            imageUrlPresent: Boolean(imageUrl),
            frames: summarizeSseFrames(frames),
          },
        };
      }
      return {
        status: imageUrl ? CHECK_STATUS.PASS : CHECK_STATUS.FAIL,
        message: imageUrl ? "" : "Image generation stream did not emit a completed image URL",
        evidence: { frameTypes, imageUrlPresent: Boolean(imageUrl) },
      };
    }));
  }

  if (selected("public-setup")) {
    checks.push(await probe("public-setup", "public-experience", "Public guest session setup", args, async () => {
      const setup = await apiJson(args, "POST", "/api/public/setup", {});
      return { evidence: { tokenPresent: Boolean(setup?.token), turnCount: setup?.turn_count ?? null, limit: setup?.limit ?? null } };
    }));
  }

  if (selected("public-chat-stream")) {
    checks.push(await probe("public-chat-stream", "public-experience", "Public chat stream", args, async () => {
      const setup = await apiJson(args, "POST", "/api/public/setup", {});
      const frames = await publicSse(args.baseUrl, "/api/public/chat/stream", {
        session_id: `status-${Date.now()}`,
        history: [],
        message: "Reply with exactly: aura public ok",
        mode: "plan",
      }, setup?.token, 120_000);
      const text = frames
        .filter((frame) => frame.event === "text_delta")
        .map((frame) => frame.data?.text ?? "")
        .join("");
      const error = frames.find((frame) => frame.event === "error");
      if (error) return { status: CHECK_STATUS.FAIL, message: error.data?.message ?? "Public chat error", evidence: { frames } };
      return {
        status: text.length > 0 ? CHECK_STATUS.PASS : CHECK_STATUS.FAIL,
        message: text.length > 0 ? "" : "Public chat stream emitted no text",
        evidence: { frameTypes: frames.map((frame) => frame.event), textSample: text.slice(0, 80) },
      };
    }));
  }

  if (selected("public-feedback-api")) {
    checks.push(await probe("public-feedback-api", "public-experience", "Public feedback API", args, async () => {
      const feedback = await publicJson(args.baseUrl, "/api/public/feedback");
      return { evidence: { count: Array.isArray(feedback) ? feedback.length : null } };
    }));
  }

  if (selected("public-blog-api")) {
    checks.push(await probe("public-blog-api", "public-experience", "Public blog API", args, async () => {
      const posts = await publicJson(args.baseUrl, "/api/public/blog");
      return { evidence: { count: Array.isArray(posts) ? posts.length : null } };
    }));
  }

  if (selected("public-content-details")) {
    checks.push(await probe("public-content-details", "public-experience", "Public content detail APIs", args, async () => {
      const [blog, os, docs, models] = await Promise.all([
        publicJson(args.baseUrl, "/api/public/blog"),
        publicJson(args.baseUrl, "/api/public/os"),
        publicJson(args.baseUrl, "/api/public/docs"),
        publicJson(args.baseUrl, "/api/public/models"),
      ]);
      async function detailEvidence(kind, list) {
        const items = Array.isArray(list) ? list : [];
        const slug = items.find((item) => typeof item?.slug === "string" && item.slug.length > 0)?.slug ?? null;
        if (!slug) return { [`${kind}Count`]: items.length, [`${kind}DetailChecked`]: false, [`${kind}SlugPresent`]: false };
        const detail = await publicJson(args.baseUrl, `/api/public/${kind}/${encodeURIComponent(slug)}`);
        return {
          [`${kind}Count`]: items.length,
          [`${kind}DetailChecked`]: true,
          [`${kind}SlugPresent`]: true,
          [`${kind}DetailIdPresent`]: Boolean(detail?.id),
        };
      }
      const evidence = {
        ...(await detailEvidence("blog", blog)),
        ...(await detailEvidence("os", os)),
        ...(await detailEvidence("docs", docs)),
        publicModelCount: collectionCount(models, ["models", "data"]) ?? 0,
      };
      const ok =
        evidence.blogDetailChecked &&
        evidence.osDetailChecked &&
        evidence.docsDetailChecked &&
        evidence.blogDetailIdPresent &&
        evidence.osDetailIdPresent &&
        evidence.docsDetailIdPresent;
      return {
        status: ok ? CHECK_STATUS.PASS : CHECK_STATUS.FAIL,
        message: ok ? "" : "One or more public content lists did not provide a readable detail slug",
        evidence,
      };
    }));
  }

  if (selected("public-x402-models")) {
    checks.push(await probe("public-x402-models", "public-experience", "Public x402 model discovery", args, async () => {
      const payload = await publicJson(args.baseUrl, "/api/public/x402/v1/models");
      const models = Array.isArray(payload?.data) ? payload.data : [];
      const ok = payload?.object === "list" && models.length > 0;
      return {
        status: ok ? CHECK_STATUS.PASS : CHECK_STATUS.FAIL,
        message: ok ? "" : "Public x402 model discovery did not return a non-empty OpenAI-shaped list",
        evidence: { object: payload?.object ?? null, modelCount: models.length },
      };
    }));
  }

  if (selected("public-x402-payment-challenge")) {
    checks.push(await probe("public-x402-payment-challenge", "public-experience", "Public x402 payment challenge", args, async () => {
      const response = await fetchWithTimeout(`${args.baseUrl}/api/public/x402/v1/chat/completions`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages: [{ role: "user", content: "Reply with exactly: aura x402 ok" }],
          max_tokens: 8,
        }),
      }, DEFAULT_TIMEOUT_MS);
      const text = await response.text();
      let payload = null;
      try {
        payload = text ? JSON.parse(text) : null;
      } catch {
        payload = null;
      }
      const requirement = Array.isArray(payload?.accepts) ? payload.accepts[0] : null;
      const payToPresent = typeof requirement?.payTo === "string" && requirement.payTo.length > 0;
      const amountPresent = typeof requirement?.amount === "string" && requirement.amount.length > 0;
      const paymentRequiredHeaderPresent = response.headers.has("payment-required");
      const ok = response.status === 402 && payToPresent && amountPresent && requirement?.network && requirement?.asset && paymentRequiredHeaderPresent;
      return {
        status: ok ? CHECK_STATUS.PASS : CHECK_STATUS.FAIL,
        message: ok ? "" : `Public x402 challenge returned HTTP ${response.status}`,
        evidence: {
          status: response.status,
          payToPresent,
          network: requirement?.network ?? null,
          asset: requirement?.asset ?? null,
          amount: requirement?.amount ?? null,
          acceptsCount: Array.isArray(payload?.accepts) ? payload.accepts.length : 0,
          paymentRequiredHeaderPresent,
        },
      };
    }));
  }

  if (selected("public-observability-page")) {
    checks.push(await probe("public-observability-page", "public-website", "Public observability page", args, async () => {
      const base = args.publicBaseUrl || args.baseUrl;
      const result = await publicText(base, "/observability");
      const hasAppShell = result.text.includes("root") || result.text.includes("AURA");
      return {
        status: hasAppShell ? CHECK_STATUS.PASS : CHECK_STATUS.FAIL,
        message: hasAppShell ? "" : "Public observability page did not return the AURA app shell",
        evidence: {
          status: result.status,
          hasAppShell,
          bodyLength: result.text.length,
        },
      };
    }));
  }

  if (selected("published-observability-snapshot")) {
    checks.push(await probe("published-observability-snapshot", "public-website", "Published observability snapshot", args, async () => {
      const payload = await publicJsonUrl(args.publishedSnapshotUrl);
      const evidence = {
        ...statusSnapshotEvidence(payload),
        snapshotUrl: args.publishedSnapshotUrl,
        maxAgeMinutes: PUBLISHED_STATUS_MAX_AGE_MINUTES,
      };
      const ok =
        evidence.schemaVersion === 1 &&
        evidence.hasLiveSource &&
        evidence.hasNonUnknownFeatureData &&
        evidence.snapshotAgeMinutes != null &&
        evidence.snapshotAgeMinutes <= PUBLISHED_STATUS_MAX_AGE_MINUTES;
      return {
        status: ok ? CHECK_STATUS.PASS : CHECK_STATUS.FAIL,
        message: ok ? "" : "Published observability snapshot is missing live workflow data or is stale",
        evidence,
      };
    }));
  }

  if (selected("public-models-page")) {
    checks.push(await probe("public-models-page", "public-website", "Public models page", args, async () => {
      const base = args.publicBaseUrl || args.baseUrl;
      const result = await publicText(base, "/models");
      const hasAppShell = result.text.includes("root") || result.text.includes("AURA");
      return {
        status: hasAppShell ? CHECK_STATUS.PASS : CHECK_STATUS.FAIL,
        message: hasAppShell ? "" : "Public models page did not return the AURA app shell",
        evidence: {
          status: result.status,
          hasAppShell,
          bodyLength: result.text.length,
        },
      };
    }));
  }

  if (selected("public-marketing-pages")) {
    checks.push(await probe("public-marketing-pages", "public-website", "Public marketing routes", args, async () => {
      const base = args.publicBaseUrl || args.baseUrl;
      const routes = ["/agents", "/code", "/pricing", "/models", "/feedback", "/blog", "/download", "/observability"];
      const results = [];
      for (const route of routes) {
        const result = await publicText(base, route);
        results.push({ route, status: result.status, hasRoot: result.text.includes("root") || result.text.includes("AURA") });
      }
      const ok = results.every((result) => result.status >= 200 && result.status < 400);
      const failedRoutes = results.filter((result) => result.status < 200 || result.status >= 400).map((result) => result.route);
      return {
        status: ok ? CHECK_STATUS.PASS : CHECK_STATUS.FAIL,
        evidence: {
          allRoutesOk: ok,
          routeCount: results.length,
          failedRoutes,
          failedRouteCount: failedRoutes.length,
          results,
        },
      };
    }));
  }

  if (selected("eval-summary-artifacts")) {
    checks.push(await probe("eval-summary-artifacts", "eval-artifacts", "Existing eval summary artifacts", args, async () => {
      const files = await artifactScan([
        "interface/test-results/aura-evals-summary.json",
        "infra/evals/reports/baselines/smoke-summary.json",
        "infra/evals/reports/baselines/chat-core-summary.json",
        "infra/evals/reports/baselines/workflow-summary.json",
      ]);
      const existing = files.filter((file) => file.exists).length;
      return {
        status: existing > 0 ? CHECK_STATUS.PASS : CHECK_STATUS.WARN,
        message: `${existing}/${files.length} eval summary artifacts found`,
        evidence: { files, existingCount: existing, expectedCount: files.length },
      };
    }));
  }

  if (selected("analytics-contract-artifacts")) {
    checks.push(await probe("analytics-contract-artifacts", "eval-artifacts", "Analytics contract artifacts", args, async () => {
      const registryPath = path.join(repoRoot, "interface/src/lib/analytics-registry.ts");
      const workflowPath = path.join(repoRoot, ".github/workflows/analytics-contract.yml");
      const releaseValidatorPath = path.join(repoRoot, "infra/scripts/release/desktop-frontend-assets-validate.mjs");
      const [registryText, workflowText, releaseValidatorText] = await Promise.all([
        fs.readFile(registryPath, "utf8"),
        fs.readFile(workflowPath, "utf8"),
        fs.readFile(releaseValidatorPath, "utf8"),
      ]);
      const eventNames = Array.from(
        registryText.matchAll(/^\s{2}([a-zA-Z0-9_]+):\s*\{/gm),
        (match) => match[1],
      );
      const engagedBundleMatch = registryText.match(/export const ENGAGED_BUNDLE = \[([\s\S]*?)\] as const/);
      const serverEventsMatch = registryText.match(/export const SERVER_EVENTS = \[([\s\S]*?)\] as const/);
      const quotedItems = (text) => Array.from((text ?? "").matchAll(/"([^"]+)"/g), (match) => match[1]);
      const engagedEvents = quotedItems(engagedBundleMatch?.[1]);
      const serverEvents = quotedItems(serverEventsMatch?.[1]);
      const requiredClientEvents = [
        "chat_message_sent",
        "project_created",
        "agent_created",
        "process_triggered",
        "note_created",
        "aura3d_image_generated",
      ];
      const missingClientEvents = requiredClientEvents.filter((event) => !eventNames.includes(event));
      const missingServerEvents = ["session_active", "share_link_generated", "share_link_opened"]
        .filter((event) => !serverEvents.includes(event));
      const releaseRequiresAnalytics = releaseValidatorText.includes("validateAnalyticsBakedIn")
        && releaseValidatorText.includes("VITE_MIXPANEL_TOKEN is empty");
      const workflowRunsContracts = workflowText.includes("analytics-contract.test.ts")
        && workflowText.includes("analytics.test.ts")
        && workflowText.includes("cargo test -p aura-os-server mixpanel");
      const ok =
        eventNames.length >= 40 &&
        engagedEvents.length >= 8 &&
        missingClientEvents.length === 0 &&
        missingServerEvents.length === 0 &&
        releaseRequiresAnalytics &&
        workflowRunsContracts;
      return {
        status: ok ? CHECK_STATUS.PASS : CHECK_STATUS.FAIL,
        message: ok ? "" : "Analytics registry/workflow/release validation artifacts are incomplete",
        evidence: {
          registryPresent: registryText.length > 0,
          eventCount: eventNames.length,
          engagedEventCount: engagedEvents.length,
          serverEventCount: serverEvents.length,
          missingClientEvents,
          missingClientEventCount: missingClientEvents.length,
          missingServerEvents,
          missingServerEventCount: missingServerEvents.length,
          releaseRequiresAnalytics,
          workflowRunsContracts,
        },
      };
    }));
  }

  return checks;
}

async function writeRun(args, checks) {
  const runId = `status-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const outPath = path.join(args.outDir, `${runId}.json`);
  const payload = {
    schemaVersion: 1,
    runId,
    generatedAt: new Date().toISOString(),
    environment: args.environment,
    runtimeEnvironment: args.runtimeEnvironment,
    baseUrl: args.baseUrl,
    checks,
  };
  await fs.mkdir(args.outDir, { recursive: true });
  await fs.writeFile(outPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return outPath;
}

const args = parseArgs(process.argv.slice(2));
args.expectations = await loadExpectations(args);
if (!args.token && args.userEmail && args.userPassword) {
  args.token = await loginForAccessToken(args);
  process.stdout.write("resolved access token via /api/auth/login\n");
}
const checks = await runChecks(args);
const outPath = await writeRun(args, checks);
for (const check of checks) {
  process.stdout.write(`${check.status.padEnd(4)} ${check.checkId} ${check.latencyMs}ms ${check.message}\n`);
}
process.stdout.write(`${path.relative(repoRoot, outPath)}\n`);

if (checks.some((check) => check.status === CHECK_STATUS.FAIL)) {
  process.exitCode = 1;
}
