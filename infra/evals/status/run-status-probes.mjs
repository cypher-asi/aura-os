#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CHECK_STATUS } from "./lib/status-policy.mjs";
import { validateCheckEvidence } from "./lib/check-expectations.mjs";
import { statusProbeAgentPermissions } from "./lib/status-probe-permissions.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..", "..");

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_REMOTE_TIMEOUT_MS = 180_000;
const DEFAULT_MODELS = [
  "aura-claude-sonnet-4-6",
  "aura-gpt-5-5",
];
const EXPECTED_RUNTIME_PHRASE = "hello from aura";
const DEFAULT_PUBLISHED_STATUS_JSON_URL = "https://cypher-asi.github.io/aura-os/observability/status.json";
const PUBLISHED_STATUS_MAX_AGE_MINUTES = 180;
const LIVE_STATUS_SNAPSHOT_SOURCES = new Set([
  "github-actions",
  "desktop-nightly-release",
  "desktop-stable-release",
]);

function parseArgs(argv) {
  const args = {
    baseUrl: process.env.AURA_STATUS_API_BASE_URL || "http://127.0.0.1:3190",
    publicBaseUrl: process.env.AURA_STATUS_PUBLIC_BASE_URL || "",
    publishedSnapshotUrl: process.env.AURA_STATUS_PUBLISHED_SNAPSHOT_URL || process.env.VITE_AURA_STATUS_SNAPSHOT_URL || DEFAULT_PUBLISHED_STATUS_JSON_URL,
    token: process.env.AURA_STATUS_ACCESS_TOKEN || process.env.AURA_EVAL_ACCESS_TOKEN || "",
    userEmail: process.env.AURA_STATUS_USER_EMAIL || "",
    userPassword: process.env.AURA_STATUS_USER_PASSWORD || "",
    outDir: process.env.AURA_STATUS_CHECKS_DIR || path.join(repoRoot, "infra/evals/reports/status/checks"),
    expectationsFile: process.env.AURA_STATUS_EXPECTATIONS_FILE || path.join(__dirname, "check-expectations.json"),
    expectations: null,
    environment: process.env.AURA_STATUS_ENVIRONMENT || "local",
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
    else if (arg === "--published-snapshot-url") args.publishedSnapshotUrl = next();
    else if (arg === "--token") args.token = next();
    else if (arg === "--user-email") args.userEmail = next();
    else if (arg === "--user-password") args.userPassword = next();
    else if (arg === "--out-dir") args.outDir = path.resolve(next());
    else if (arg === "--expectations") args.expectationsFile = path.resolve(next());
    else if (arg === "--environment") args.environment = next();
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
  args.publicBaseUrl = args.publicBaseUrl.replace(/\/+$/, "");
  if (args.models.length === 0) args.models = DEFAULT_MODELS;
  args.checks = args.checks.length > 0 ? new Set(args.checks) : null;
  return args;
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

async function apiSse(args, endpoint, body, timeoutMs = DEFAULT_TIMEOUT_MS) {
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
  return sseFramesFromText(text);
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

async function createAgent(args, track, machineType, model = null, orgId = null) {
  const environment = machineType === "remote" ? "swarm_microvm" : "local_host";
  const agent = await apiJson(args, "POST", "/api/agents", {
    org_id: orgId,
    name: `aura-status-${machineType}-${Date.now()}`,
    role: "status-probe",
    personality: "Small, deterministic health-check agent.",
    system_prompt: "You are an AURA status probe. Reply exactly as requested.",
    skills: [],
    icon: null,
    machine_type: machineType,
    adapter_type: "aura_harness",
    environment,
    auth_source: "aura_managed",
    default_model: model,
    permissions: statusProbeAgentPermissions(orgId),
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
            const runtime = await runRuntimeTest(args, agent.agent_id, 60_000);
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
      if (error) {
        return { status: CHECK_STATUS.FAIL, message: error.data?.message ?? "Image generation error", evidence: { frames } };
      }
      const imageUrl = completed?.data?.imageUrl ?? completed?.data?.image_url;
      return {
        status: imageUrl ? CHECK_STATUS.PASS : CHECK_STATUS.FAIL,
        message: imageUrl ? "" : "Image generation stream did not emit a completed image URL",
        evidence: { frameTypes: frames.map((frame) => frame.event), imageUrlPresent: Boolean(imageUrl) },
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
        message: hasAppShell ? "" : "Public observability page did not return the Aura app shell",
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
      const response = await fetchWithTimeout(`${base}/models`, {}, DEFAULT_TIMEOUT_MS);
      return {
        status: response.ok ? CHECK_STATUS.PASS : CHECK_STATUS.FAIL,
        message: response.ok ? "" : `HTTP ${response.status}`,
        evidence: { status: response.status },
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
        evidence: { files },
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
