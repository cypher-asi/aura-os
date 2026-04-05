#!/usr/bin/env node

/**
 * aura-storage API Integration Test Suite
 *
 * Tests every endpoint aura-app needs from aura-storage to verify
 * 1:1 feature parity before wiring up the StorageClient.
 *
 * Usage:
 *   node scripts/test-aura-storage.mjs
 *
 * Required env (reads from .env automatically):
 *   AURA_STORAGE_URL          - e.g. https://your-storage-host.example.com
 *   AURA_NETWORK_AUTH_TOKEN   - JWT from zOS login (shared with aura-network)
 *   AURA_NETWORK_URL          - for test setup (create project + agent)
 *
 * Optional:
 *   AURA_STORAGE_AUTH_TOKEN   - override JWT for aura-storage (defaults to AURA_NETWORK_AUTH_TOKEN)
 */

import { readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

// ── Env Loading ──────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = resolve(__dirname, "..", ".env");

function loadEnv() {
  try {
    const lines = readFileSync(ENV_PATH, "utf-8").split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim();
      if (!process.env[key]) process.env[key] = val;
    }
  } catch {
    // .env not found, rely on process env
  }
}

function prompt(question) {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((res) => rl.question(question, (answer) => { rl.close(); res(answer.trim()); }));
}

function saveTokenToEnv(token) {
  try {
    let content = readFileSync(ENV_PATH, "utf-8");
    if (content.includes("AURA_NETWORK_AUTH_TOKEN=")) {
      content = content.replace(/AURA_NETWORK_AUTH_TOKEN=.*/, `AURA_NETWORK_AUTH_TOKEN=${token}`);
    } else {
      content += `\nAURA_NETWORK_AUTH_TOKEN=${token}\n`;
    }
    writeFileSync(ENV_PATH, content, "utf-8");
    return true;
  } catch {
    return false;
  }
}

loadEnv();

const STORAGE_BASE = process.env.AURA_STORAGE_URL?.replace(/\/$/, "");
const NETWORK_BASE = process.env.AURA_NETWORK_URL?.replace(/\/$/, "");
let JWT = process.env.AURA_STORAGE_AUTH_TOKEN || process.env.AURA_NETWORK_AUTH_TOKEN;

if (!STORAGE_BASE) {
  console.error("ERROR: AURA_STORAGE_URL is not set. Add it to .env or export it.");
  process.exit(1);
}

const LOCAL_APP_URL = "http://localhost:3100";
const ZOS_LOGIN_URL = "https://zosapi.zero.tech/api/v2/accounts/login";
const LOCAL_AURA_DATA_DIR = process.env.AURA_DATA_DIR || `${process.env.HOME}/Library/Application Support/aura`;

async function fetchTokenFromLocalApp() {
  try {
    const { execFileSync } = await import("node:child_process");
    return execFileSync(
      "cargo",
      ["run", "-q", "-p", "aura-os-server", "--bin", "print-auth-token", "--", LOCAL_AURA_DATA_DIR],
      { encoding: "utf8" },
    ).trim() || null;
  } catch {
    return null;
  }
}

async function loginToZos(email, password) {
  const res = await fetch(ZOS_LOGIN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`zOS login failed (${res.status}): ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.accessToken || null;
}

async function acquireToken() {
  if (JWT) return JWT;

  console.log("\n  No auth token in .env (AURA_STORAGE_AUTH_TOKEN / AURA_NETWORK_AUTH_TOKEN).");
  console.log("  Checking running aura-app (localhost:3100)...");
  const localToken = await fetchTokenFromLocalApp();
  if (localToken) {
    console.log("  Got JWT from local app.\n");
    return localToken;
  }
  console.log("  App not running.\n");

  console.log("  Log in with your zOS credentials to get a JWT:\n");
  const email = await prompt("  Email: ");
  const password = await prompt("  Password: ");
  if (!email || !password) {
    console.error("\n  Missing credentials. Exiting.");
    process.exit(1);
  }
  console.log("  Logging in to zOS...");
  try {
    const token = await loginToZos(email, password);
    if (!token) throw new Error("No accessToken in response");
    console.log("  Login successful.\n");
    return token;
  } catch (err) {
    console.error(`\n  ${err.message}`);
    process.exit(1);
  }
}

const hadToken = !!JWT;
JWT = await acquireToken();

if (!hadToken) {
  const saveIt = await prompt("  Save token to .env for future runs? (y/n): ");
  if (saveIt.toLowerCase() === "y") {
    if (saveTokenToEnv(JWT)) {
      console.log("  Token saved to .env\n");
    } else {
      console.log("  Could not write to .env — continuing anyway\n");
    }
  }
}

// ── Test Runner ──────────────────────────────────────────────────────

const results = [];
let currentGroup = "";

const PASS = "\x1b[32m✓\x1b[0m";
const FAIL = "\x1b[31m✗\x1b[0m";
const SKIP = "\x1b[33m○\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

function group(name) {
  currentGroup = name;
  console.log(`\n${BOLD}── ${name} ──${RESET}`);
}

function record(name, passed, detail = "", skipped = false) {
  results.push({ group: currentGroup, name, passed, detail, skipped });
  if (skipped) {
    console.log(`  ${SKIP} ${name} ${DIM}(skipped: ${detail})${RESET}`);
  } else if (passed) {
    console.log(`  ${PASS} ${name} ${DIM}${detail}${RESET}`);
  } else {
    console.log(`  ${FAIL} ${name} ${DIM}${detail}${RESET}`);
  }
}

// ── HTTP helpers ─────────────────────────────────────────────────────

async function request(method, path, { body, auth = "jwt", query, base } = {}) {
  const url = new URL(path, base || STORAGE_BASE);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }

  const headers = { "Content-Type": "application/json" };
  if (auth === "jwt") headers["Authorization"] = `Bearer ${JWT}`;
  // auth === "none" → no auth header

  const opts = { method, headers };
  if (body !== undefined) opts.body = JSON.stringify(body);

  const res = await fetch(url.toString(), opts);
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // not JSON
  }

  return { status: res.status, ok: res.ok, json, text, headers: res.headers };
}

async function test(name, fn) {
  try {
    const result = await fn();
    if (result?.skip) {
      record(name, false, result.skip, true);
      return result.value;
    }
    record(name, true, result?.detail || "");
    return result?.value;
  } catch (err) {
    const msg = err?.message || String(err);
    record(name, false, msg.slice(0, 200));
    return undefined;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertStatus(res, ...expected) {
  assert(
    expected.includes(res.status),
    `Expected ${expected.join("|")}, got ${res.status}: ${res.text?.slice(0, 200)}`
  );
}

function assertField(obj, field, label) {
  assert(obj && obj[field] !== undefined, `${label || "Response"} missing field '${field}'`);
}

function assertFields(obj, fields, label) {
  for (const f of fields) assertField(obj, f, label);
}

// ── State (resources created during tests, cleaned up at end) ────────

const state = {};

// ══════════════════════════════════════════════════════════════════════
//  TEST SUITE
// ══════════════════════════════════════════════════════════════════════

async function run() {
  console.log(`${BOLD}aura-storage Integration Test Suite${RESET}`);
  console.log(`Target:  ${STORAGE_BASE}`);
  console.log(`Network: ${NETWORK_BASE || "(not set)"}`);
  console.log(`JWT:     ${JWT.slice(0, 20)}...`);

  // ── Setup (aura-network) ─────────────────────────────────────────
  // Create a real project + agent in aura-network so we have valid
  // foreign-key IDs for aura-storage tests.

  group("Setup (aura-network)");

  if (!NETWORK_BASE) {
    record("aura-network available", false, "AURA_NETWORK_URL not set — using generated UUIDs", true);
    state.projectId = randomUUID();
    state.agentId = randomUUID();
    console.log(`  Using generated projectId: ${state.projectId}`);
    console.log(`  Using generated agentId:   ${state.agentId}`);
  } else {
    state.networkOrg = await test("Create test org", async () => {
      const name = `storage-test-${Date.now()}`;
      const res = await request("POST", "/api/orgs", { body: { name }, base: NETWORK_BASE });
      assertStatus(res, 200, 201);
      assertFields(res.json, ["id", "name"]);
      return { value: res.json, detail: `id=${res.json.id}` };
    });

    state.networkProject = await test("Create test project", async () => {
      if (!state.networkOrg?.id) return { skip: "no org" };
      const res = await request("POST", "/api/projects", {
        body: {
          name: `storage-test-project-${Date.now()}`,
          orgId: state.networkOrg.id,
          folder: "/tmp/storage-test",
        },
        base: NETWORK_BASE,
      });
      assertStatus(res, 200, 201);
      assertFields(res.json, ["id", "name"]);
      return { value: res.json, detail: `id=${res.json.id}` };
    });

    state.networkAgent = await test("Create test agent", async () => {
      const res = await request("POST", "/api/agents", {
        body: {
          name: `storage-test-agent-${Date.now()}`,
          role: "developer",
          personality: "thorough and methodical",
          systemPrompt: "You are a test agent for aura-storage integration tests.",
          skills: ["testing"],
          icon: "bot",
        },
        base: NETWORK_BASE,
      });
      assertStatus(res, 200, 201);
      assertFields(res.json, ["id", "name"]);
      return { value: res.json, detail: `id=${res.json.id}` };
    });

    state.projectId = state.networkProject?.id;
    state.agentId = state.networkAgent?.id;

    if (!state.projectId || !state.agentId) {
      console.log(`\n  Falling back to generated UUIDs for missing IDs`);
      state.projectId = state.projectId || randomUUID();
      state.agentId = state.agentId || randomUUID();
    }
  }

  // ── Health ───────────────────────────────────────────────────────

  group("Health");

  await test("GET /health", async () => {
    const res = await request("GET", "/health", { auth: "none" });
    assertStatus(res, 200);
    return { detail: `${res.status} OK` };
  });

  // ── Project Agents ───────────────────────────────────────────────

  group("Project Agents");

  state.projectAgent = await test("POST /api/projects/:pid/agents (create)", async () => {
    const res = await request("POST", `/api/projects/${state.projectId}/agents`, {
      body: {
        agentId: state.agentId,
        name: "Test Project Agent",
        role: "developer",
        personality: "helpful and thorough",
        systemPrompt: "You are a test project agent.",
        skills: ["typescript", "testing"],
        icon: "bot",
      },
    });
    assertStatus(res, 200, 201);
    assertField(res.json, "id", "ProjectAgent");
    return { value: res.json, detail: `status=${res.status} id=${res.json.id}` };
  });

  await test("GET /api/projects/:pid/agents (list)", async () => {
    const res = await request("GET", `/api/projects/${state.projectId}/agents`);
    assertStatus(res, 200);
    assert(Array.isArray(res.json), "Expected array");
    assert(res.json.length >= 1, "Expected at least 1 project agent");
    return { detail: `${res.json.length} project agents` };
  });

  await test("GET /api/project-agents/:id", async () => {
    if (!state.projectAgent?.id) return { skip: "no project agent" };
    const res = await request("GET", `/api/project-agents/${state.projectAgent.id}`);
    assertStatus(res, 200);
    assertField(res.json, "id", "ProjectAgent");
    return { detail: `id=${res.json.id}` };
  });

  await test("PUT /api/project-agents/:id (update status)", async () => {
    if (!state.projectAgent?.id) return { skip: "no project agent" };
    const res = await request("PUT", `/api/project-agents/${state.projectAgent.id}`, {
      body: { status: "working" },
    });
    assertStatus(res, 200);
    return { detail: "status → working" };
  });

  await test("PUT /api/project-agents/:id (back to idle)", async () => {
    if (!state.projectAgent?.id) return { skip: "no project agent" };
    const res = await request("PUT", `/api/project-agents/${state.projectAgent.id}`, {
      body: { status: "idle" },
    });
    assertStatus(res, 200);
    return { detail: "status → idle" };
  });

  // ── Specs ────────────────────────────────────────────────────────

  group("Specs");

  state.spec = await test("POST /api/projects/:pid/specs (create)", async () => {
    const res = await request("POST", `/api/projects/${state.projectId}/specs`, {
      body: {
        title: "Test Spec",
        orderIndex: 0,
        markdownContents: "# Test Spec\n\nThis is a test specification for integration testing.",
      },
    });
    assertStatus(res, 200, 201);
    assertField(res.json, "id", "Spec");
    return { value: res.json, detail: `status=${res.status} id=${res.json.id}` };
  });

  await test("GET /api/projects/:pid/specs (list)", async () => {
    const res = await request("GET", `/api/projects/${state.projectId}/specs`);
    assertStatus(res, 200);
    assert(Array.isArray(res.json), "Expected array");
    assert(res.json.length >= 1, "Expected at least 1 spec");
    return { detail: `${res.json.length} specs` };
  });

  await test("GET /api/specs/:id", async () => {
    if (!state.spec?.id) return { skip: "no spec" };
    const res = await request("GET", `/api/specs/${state.spec.id}`);
    assertStatus(res, 200);
    assertFields(res.json, ["id", "title"]);
    return { detail: `title=${res.json.title}` };
  });

  await test("PUT /api/specs/:id (update)", async () => {
    if (!state.spec?.id) return { skip: "no spec" };
    const res = await request("PUT", `/api/specs/${state.spec.id}`, {
      body: { title: "Updated Test Spec" },
    });
    assertStatus(res, 200);
    return { detail: "title updated" };
  });

  // ── Tasks ────────────────────────────────────────────────────────

  group("Tasks");

  state.task = await test("POST /api/projects/:pid/tasks (create)", async () => {
    if (!state.spec?.id) return { skip: "no spec" };
    const res = await request("POST", `/api/projects/${state.projectId}/tasks`, {
      body: {
        specId: state.spec.id,
        title: "Test Task",
        description: "A test task for integration testing",
        status: "pending",
        orderIndex: 0,
        dependencyIds: [],
      },
    });
    assertStatus(res, 200, 201);
    assertField(res.json, "id", "Task");
    return { value: res.json, detail: `status=${res.status} id=${res.json.id}` };
  });

  await test("GET /api/projects/:pid/tasks (list)", async () => {
    const res = await request("GET", `/api/projects/${state.projectId}/tasks`);
    assertStatus(res, 200);
    assert(Array.isArray(res.json), "Expected array");
    assert(res.json.length >= 1, "Expected at least 1 task");
    return { detail: `${res.json.length} tasks` };
  });

  await test("GET /api/tasks/:id", async () => {
    if (!state.task?.id) return { skip: "no task" };
    const res = await request("GET", `/api/tasks/${state.task.id}`);
    assertStatus(res, 200);
    assertFields(res.json, ["id", "title", "status"]);
    return { detail: `title=${res.json.title} status=${res.json.status}` };
  });

  await test("PUT /api/tasks/:id (update)", async () => {
    if (!state.task?.id) return { skip: "no task" };
    const res = await request("PUT", `/api/tasks/${state.task.id}`, {
      body: { description: "Updated task description" },
    });
    assertStatus(res, 200);
    return { detail: "description updated" };
  });

  await test("PUT /api/tasks/:id (execution fields)", async () => {
    if (!state.task?.id) return { skip: "no task" };
    const execFields = {
      executionNotes: "Task completed successfully with all changes applied.",
      filesChanged: [
        { op: "create", path: "src/new-file.ts", linesAdded: 42, linesRemoved: 0 },
        { op: "modify", path: "src/existing.ts", linesAdded: 10, linesRemoved: 3 },
      ],
      model: "claude-sonnet-4-5",
      totalInputTokens: 15000,
      totalOutputTokens: 8500,
      sessionId: state.session?.id ?? null,
      assignedProjectAgentId: state.projectAgent?.id ?? null,
    };
    const res = await request("PUT", `/api/tasks/${state.task.id}`, { body: execFields });
    assertStatus(res, 200);

    const getRes = await request("GET", `/api/tasks/${state.task.id}`);
    assertStatus(getRes, 200);
    const t = getRes.json;
    assert(t.executionNotes === execFields.executionNotes, `executionNotes: got ${t.executionNotes}`);
    assert(t.model === execFields.model, `model: got ${t.model}`);
    assert(t.totalInputTokens === execFields.totalInputTokens, `totalInputTokens: got ${t.totalInputTokens}`);
    assert(t.totalOutputTokens === execFields.totalOutputTokens, `totalOutputTokens: got ${t.totalOutputTokens}`);
    assert(Array.isArray(t.filesChanged) && t.filesChanged.length === 2, "filesChanged length");
    assert(t.filesChanged[0].op === "create", `filesChanged[0].op: got ${t.filesChanged[0].op}`);
    assert(t.filesChanged[0].path === "src/new-file.ts", `filesChanged[0].path: got ${t.filesChanged[0].path}`);
    if (execFields.sessionId) assert(t.sessionId === execFields.sessionId, `sessionId: got ${t.sessionId}`);
    if (execFields.assignedProjectAgentId) assert(t.assignedProjectAgentId === execFields.assignedProjectAgentId, `assignedProjectAgentId: got ${t.assignedProjectAgentId}`);
    return { detail: "execution fields persisted and verified" };
  });

  await test("POST /api/tasks/:id/transition (pending → ready)", async () => {
    if (!state.task?.id) return { skip: "no task" };
    const res = await request("POST", `/api/tasks/${state.task.id}/transition`, {
      body: { status: "ready" },
    });
    assertStatus(res, 200);
    return { detail: "pending → ready" };
  });

  // ── Task State Machine ───────────────────────────────────────────

  group("Task State Machine");

  // Happy path: pending → ready → in_progress → done
  state.smTaskHappy = await test("Create task (happy path)", async () => {
    if (!state.spec?.id) return { skip: "no spec" };
    const res = await request("POST", `/api/projects/${state.projectId}/tasks`, {
      body: {
        specId: state.spec.id,
        title: "SM Happy Path Task",
        description: "Tests pending→ready→in_progress→done",
        status: "pending",
        orderIndex: 10,
        dependencyIds: [],
      },
    });
    assertStatus(res, 200, 201);
    return { value: res.json, detail: `id=${res.json.id}` };
  });

  for (const [from, to] of [["pending", "ready"], ["ready", "in_progress"], ["in_progress", "done"]]) {
    await test(`Happy: ${from} → ${to}`, async () => {
      if (!state.smTaskHappy?.id) return { skip: "no task" };
      const res = await request("POST", `/api/tasks/${state.smTaskHappy.id}/transition`, {
        body: { status: to },
      });
      assertStatus(res, 200);
      return { detail: `${from} → ${to}` };
    });
  }

  await test("Invalid: done → ready (should 400)", async () => {
    if (!state.smTaskHappy?.id) return { skip: "no task" };
    const res = await request("POST", `/api/tasks/${state.smTaskHappy.id}/transition`, {
      body: { status: "ready" },
    });
    assertStatus(res, 400);
    return { detail: `done → ready rejected (${res.status})` };
  });

  // Retry path: pending → ready → in_progress → failed → ready
  state.smTaskRetry = await test("Create task (retry path)", async () => {
    if (!state.spec?.id) return { skip: "no spec" };
    const res = await request("POST", `/api/projects/${state.projectId}/tasks`, {
      body: {
        specId: state.spec.id,
        title: "SM Retry Path Task",
        description: "Tests pending→ready→in_progress→failed→ready",
        status: "pending",
        orderIndex: 11,
        dependencyIds: [],
      },
    });
    assertStatus(res, 200, 201);
    return { value: res.json, detail: `id=${res.json.id}` };
  });

  for (const [from, to] of [["pending", "ready"], ["ready", "in_progress"], ["in_progress", "failed"], ["failed", "ready"]]) {
    await test(`Retry: ${from} → ${to}`, async () => {
      if (!state.smTaskRetry?.id) return { skip: "no task" };
      const res = await request("POST", `/api/tasks/${state.smTaskRetry.id}/transition`, {
        body: { status: to },
      });
      assertStatus(res, 200);
      return { detail: `${from} → ${to}` };
    });
  }

  // Blocked path: pending → ready → in_progress → blocked → ready
  state.smTaskBlocked = await test("Create task (blocked path)", async () => {
    if (!state.spec?.id) return { skip: "no spec" };
    const res = await request("POST", `/api/projects/${state.projectId}/tasks`, {
      body: {
        specId: state.spec.id,
        title: "SM Blocked Path Task",
        description: "Tests pending→ready→in_progress→blocked→ready",
        status: "pending",
        orderIndex: 12,
        dependencyIds: [],
      },
    });
    assertStatus(res, 200, 201);
    return { value: res.json, detail: `id=${res.json.id}` };
  });

  for (const [from, to] of [["pending", "ready"], ["ready", "in_progress"], ["in_progress", "blocked"], ["blocked", "ready"]]) {
    await test(`Blocked: ${from} → ${to}`, async () => {
      if (!state.smTaskBlocked?.id) return { skip: "no task" };
      const res = await request("POST", `/api/tasks/${state.smTaskBlocked.id}/transition`, {
        body: { status: to },
      });
      assertStatus(res, 200);
      return { detail: `${from} → ${to}` };
    });
  }

  // Invalid transitions → 400
  state.smTaskInvalid = await test("Create task (invalid transitions)", async () => {
    if (!state.spec?.id) return { skip: "no spec" };
    const res = await request("POST", `/api/projects/${state.projectId}/tasks`, {
      body: {
        specId: state.spec.id,
        title: "SM Invalid Transition Task",
        description: "Tests that invalid transitions are rejected",
        status: "pending",
        orderIndex: 13,
        dependencyIds: [],
      },
    });
    assertStatus(res, 200, 201);
    return { value: res.json, detail: `id=${res.json.id}` };
  });

  await test("Invalid: pending → done (should 400)", async () => {
    if (!state.smTaskInvalid?.id) return { skip: "no task" };
    const res = await request("POST", `/api/tasks/${state.smTaskInvalid.id}/transition`, {
      body: { status: "done" },
    });
    assertStatus(res, 400);
    return { detail: `pending → done rejected (${res.status})` };
  });

  await test("Invalid: pending → in_progress (should 400)", async () => {
    if (!state.smTaskInvalid?.id) return { skip: "no task" };
    const res = await request("POST", `/api/tasks/${state.smTaskInvalid.id}/transition`, {
      body: { status: "in_progress" },
    });
    assertStatus(res, 400);
    return { detail: `pending → in_progress rejected (${res.status})` };
  });

  await test("Invalid: pending → failed (should 400)", async () => {
    if (!state.smTaskInvalid?.id) return { skip: "no task" };
    const res = await request("POST", `/api/tasks/${state.smTaskInvalid.id}/transition`, {
      body: { status: "failed" },
    });
    assertStatus(res, 400);
    return { detail: `pending → failed rejected (${res.status})` };
  });

  await test("Invalid: pending → blocked (should 400)", async () => {
    if (!state.smTaskInvalid?.id) return { skip: "no task" };
    const res = await request("POST", `/api/tasks/${state.smTaskInvalid.id}/transition`, {
      body: { status: "blocked" },
    });
    assertStatus(res, 400);
    return { detail: `pending → blocked rejected (${res.status})` };
  });

  // ── Sessions ─────────────────────────────────────────────────────

  group("Sessions");

  state.session = await test("POST /api/project-agents/:paid/sessions (create)", async () => {
    if (!state.projectAgent?.id) return { skip: "no project agent" };
    const res = await request("POST", `/api/project-agents/${state.projectAgent.id}/sessions`, {
      body: {
        projectId: state.projectId,
        status: "active",
        contextUsageEstimate: 0.0,
        summaryOfPreviousContext: "",
      },
    });
    assertStatus(res, 200, 201);
    assertField(res.json, "id", "Session");
    return { value: res.json, detail: `status=${res.status} id=${res.json.id}` };
  });

  await test("GET /api/project-agents/:paid/sessions (list)", async () => {
    if (!state.projectAgent?.id) return { skip: "no project agent" };
    const res = await request("GET", `/api/project-agents/${state.projectAgent.id}/sessions`);
    assertStatus(res, 200);
    assert(Array.isArray(res.json), "Expected array");
    assert(res.json.length >= 1, "Expected at least 1 session");
    return { detail: `${res.json.length} sessions` };
  });

  await test("GET /api/sessions/:id", async () => {
    if (!state.session?.id) return { skip: "no session" };
    const res = await request("GET", `/api/sessions/${state.session.id}`);
    assertStatus(res, 200);
    assertField(res.json, "id", "Session");
    return { detail: `id=${res.json.id}` };
  });

  await test("PUT /api/sessions/:id (update)", async () => {
    if (!state.session?.id) return { skip: "no session" };
    const res = await request("PUT", `/api/sessions/${state.session.id}`, {
      body: { contextUsageEstimate: 0.25 },
    });
    assertStatus(res, 200);
    return { detail: "contextUsageEstimate updated" };
  });

  // ── Messages ─────────────────────────────────────────────────────

  group("Messages");

  const testMessages = [
    { role: "user", content: "Hello, this is test message 1", inputTokens: 10, outputTokens: 0 },
    { role: "assistant", content: "Hello! This is test response 1", inputTokens: 0, outputTokens: 25 },
    { role: "user", content: "Test message 2", inputTokens: 8, outputTokens: 0 },
    { role: "assistant", content: "Test response 2", inputTokens: 0, outputTokens: 15 },
    { role: "user", content: "Test message 3", inputTokens: 6, outputTokens: 0 },
  ];

  state.messages = [];
  for (let i = 0; i < testMessages.length; i++) {
    const msg = testMessages[i];
    const created = await test(`POST /api/sessions/:sid/messages (${msg.role} #${i + 1})`, async () => {
      if (!state.session?.id || !state.projectAgent?.id) return { skip: "no session or project agent" };
      const res = await request("POST", `/api/sessions/${state.session.id}/messages`, {
        body: {
          projectAgentId: state.projectAgent.id,
          projectId: state.projectId,
          role: msg.role,
          content: msg.content,
          inputTokens: msg.inputTokens,
          outputTokens: msg.outputTokens,
        },
      });
      assertStatus(res, 200, 201);
      assertField(res.json, "id", "Message");
      return { value: res.json, detail: `id=${res.json.id} role=${msg.role}` };
    });
    if (created) state.messages.push(created);
  }

  await test("GET /api/sessions/:sid/messages (list all)", async () => {
    if (!state.session?.id) return { skip: "no session" };
    const res = await request("GET", `/api/sessions/${state.session.id}/messages`);
    assertStatus(res, 200);
    assert(Array.isArray(res.json), "Expected array");
    assert(res.json.length >= 5, `Expected >=5 messages, got ${res.json.length}`);
    return { detail: `${res.json.length} messages` };
  });

  await test("GET /api/sessions/:sid/messages (pagination: limit=2)", async () => {
    if (!state.session?.id) return { skip: "no session" };
    const res = await request("GET", `/api/sessions/${state.session.id}/messages`, {
      query: { limit: 2 },
    });
    assertStatus(res, 200);
    assert(Array.isArray(res.json), "Expected array");
    assert(res.json.length <= 2, `Expected <=2 messages, got ${res.json.length}`);
    return { detail: `${res.json.length} messages (limit=2)` };
  });

  await test("GET /api/sessions/:sid/messages (pagination: limit=2, offset=2)", async () => {
    if (!state.session?.id) return { skip: "no session" };
    const res = await request("GET", `/api/sessions/${state.session.id}/messages`, {
      query: { limit: 2, offset: 2 },
    });
    assertStatus(res, 200);
    assert(Array.isArray(res.json), "Expected array");
    assert(res.json.length <= 2, `Expected <=2 messages, got ${res.json.length}`);
    return { detail: `${res.json.length} messages (limit=2, offset=2)` };
  });

  // ── Task Output as Session Message ─────────────────────────────

  group("Task Output as Session Message");

  await test("POST session message with task output content", async () => {
    if (!state.session?.id || !state.projectAgent?.id) return { skip: "no session or project agent" };
    const taskOutputContent = [
      "Search: TaskService modules",
      "Read src/lib.rs",
      "Read src/task_service.rs",
      "Plan: implement storage persistence",
      "Write src/storage.rs (42 lines)",
      "Build verification passed",
    ].join("\n");

    const res = await request("POST", `/api/sessions/${state.session.id}/messages`, {
      body: {
        projectAgentId: state.projectAgent.id,
        projectId: state.projectId,
        role: "assistant",
        content: taskOutputContent,
        inputTokens: 15000,
        outputTokens: 8500,
      },
    });
    assertStatus(res, 200, 201);
    assertField(res.json, "id", "Message");

    const listRes = await request("GET", `/api/sessions/${state.session.id}/messages`);
    assertStatus(listRes, 200);
    const assistantMsgs = listRes.json.filter((m) => m.role === "assistant");
    const found = assistantMsgs.find((m) => m.content && m.content.includes("storage persistence"));
    assert(found, "Task output message should be retrievable from session messages");
    return { detail: `message id=${res.json.id}, verified retrieval` };
  });

  // ── Log Entries ──────────────────────────────────────────────────

  group("Log Entries");

  const testLogs = [
    { level: "info", message: "Task started", metadata: { taskId: state.task?.id } },
    { level: "warn", message: "Build took longer than expected", metadata: { durationMs: 15000 } },
    { level: "error", message: "Test suite failed", metadata: { exitCode: 1 } },
    { level: "info", message: "Task completed", metadata: { taskId: state.task?.id } },
    { level: "debug", message: "Debug trace", metadata: { step: "cleanup" } },
  ];

  for (let i = 0; i < testLogs.length; i++) {
    const entry = testLogs[i];
    await test(`POST /api/projects/:pid/logs (${entry.level} #${i + 1})`, async () => {
      const res = await request("POST", `/api/projects/${state.projectId}/logs`, {
        body: entry,
      });
      assertStatus(res, 200, 201);
      return { detail: `status=${res.status} level=${entry.level}` };
    });
  }

  await test("GET /api/projects/:pid/logs (list all)", async () => {
    const res = await request("GET", `/api/projects/${state.projectId}/logs`);
    assertStatus(res, 200);
    assert(Array.isArray(res.json), "Expected array");
    assert(res.json.length >= 5, `Expected >=5 log entries, got ${res.json.length}`);
    return { detail: `${res.json.length} log entries` };
  });

  await test("GET /api/projects/:pid/logs (filter: level=error)", async () => {
    const res = await request("GET", `/api/projects/${state.projectId}/logs`, {
      query: { level: "error" },
    });
    assertStatus(res, 200);
    assert(Array.isArray(res.json), "Expected array");
    assert(res.json.length >= 1, "Expected at least 1 error log");
    return { detail: `${res.json.length} error logs` };
  });

  await test("GET /api/projects/:pid/logs (filter: level=info)", async () => {
    const res = await request("GET", `/api/projects/${state.projectId}/logs`, {
      query: { level: "info" },
    });
    assertStatus(res, 200);
    assert(Array.isArray(res.json), "Expected array");
    assert(res.json.length >= 2, "Expected at least 2 info logs");
    return { detail: `${res.json.length} info logs` };
  });

  await test("GET /api/projects/:pid/logs (pagination: limit=2)", async () => {
    const res = await request("GET", `/api/projects/${state.projectId}/logs`, {
      query: { limit: 2 },
    });
    assertStatus(res, 200);
    assert(Array.isArray(res.json), "Expected array");
    assert(res.json.length <= 2, `Expected <=2 logs, got ${res.json.length}`);
    return { detail: `${res.json.length} logs (limit=2)` };
  });

  await test("GET /api/projects/:pid/logs (pagination: limit=2, offset=2)", async () => {
    const res = await request("GET", `/api/projects/${state.projectId}/logs`, {
      query: { limit: 2, offset: 2 },
    });
    assertStatus(res, 200);
    assert(Array.isArray(res.json), "Expected array");
    assert(res.json.length <= 2, `Expected <=2 logs, got ${res.json.length}`);
    return { detail: `${res.json.length} logs (limit=2, offset=2)` };
  });

  // ── Error Handling ───────────────────────────────────────────────

  group("Error Handling");

  const FAKE_ID = "00000000-0000-0000-0000-000000000000";

  await test("GET /api/project-agents/:id (nonexistent) → 404", async () => {
    const res = await request("GET", `/api/project-agents/${FAKE_ID}`);
    assertStatus(res, 404);
    return { detail: "404 as expected" };
  });

  await test("GET /api/specs/:id (nonexistent) → 404", async () => {
    const res = await request("GET", `/api/specs/${FAKE_ID}`);
    assertStatus(res, 404);
    return { detail: "404 as expected" };
  });

  await test("GET /api/tasks/:id (nonexistent) → 404", async () => {
    const res = await request("GET", `/api/tasks/${FAKE_ID}`);
    assertStatus(res, 404);
    return { detail: "404 as expected" };
  });

  await test("GET /api/sessions/:id (nonexistent) → 404", async () => {
    const res = await request("GET", `/api/sessions/${FAKE_ID}`);
    assertStatus(res, 404);
    return { detail: "404 as expected" };
  });

  await test("GET /api/projects/:pid/agents (no auth) → 401", async () => {
    const res = await request("GET", `/api/projects/${state.projectId}/agents`, { auth: "none" });
    assertStatus(res, 401);
    return { detail: "401 Unauthorized as expected" };
  });

  await test("POST /api/projects/:pid/specs (no auth) → 401", async () => {
    const res = await request("POST", `/api/projects/${state.projectId}/specs`, {
      auth: "none",
      body: { title: "should fail" },
    });
    assertStatus(res, 401);
    return { detail: "401 Unauthorized as expected" };
  });

  await test("POST /api/projects/:pid/specs (invalid body) → 400", async () => {
    const res = await request("POST", `/api/projects/${state.projectId}/specs`, { body: {} });
    assert(res.status === 400 || res.status === 422, `Expected 400|422, got ${res.status}`);
    return { detail: `status=${res.status}` };
  });

  await test("POST /api/projects/:pid/tasks (invalid body) → 400", async () => {
    const res = await request("POST", `/api/projects/${state.projectId}/tasks`, { body: {} });
    assert(res.status === 400 || res.status === 422, `Expected 400|422, got ${res.status}`);
    return { detail: `status=${res.status}` };
  });

  // ── Cleanup ──────────────────────────────────────────────────────

  group("Cleanup");

  // Delete state machine tasks
  for (const [label, task] of [
    ["happy path task", state.smTaskHappy],
    ["retry path task", state.smTaskRetry],
    ["blocked path task", state.smTaskBlocked],
    ["invalid transition task", state.smTaskInvalid],
  ]) {
    await test(`DELETE /api/tasks/:id (${label})`, async () => {
      if (!task?.id) return { skip: `no ${label}` };
      const res = await request("DELETE", `/api/tasks/${task.id}`);
      assert(res.status === 200 || res.status === 204, `Expected 200|204, got ${res.status}`);
      return { detail: "deleted" };
    });
  }

  await test("DELETE /api/tasks/:id (main task)", async () => {
    if (!state.task?.id) return { skip: "no task" };
    const res = await request("DELETE", `/api/tasks/${state.task.id}`);
    assert(res.status === 200 || res.status === 204, `Expected 200|204, got ${res.status}`);
    return { detail: "deleted" };
  });

  await test("DELETE /api/specs/:id", async () => {
    if (!state.spec?.id) return { skip: "no spec" };
    const res = await request("DELETE", `/api/specs/${state.spec.id}`);
    assert(res.status === 200 || res.status === 204, `Expected 200|204, got ${res.status}`);
    return { detail: "deleted" };
  });

  // End session before deleting project agent (FK constraint)
  await test("PUT /api/sessions/:id (end session)", async () => {
    if (!state.session?.id) return { skip: "no session" };
    const res = await request("PUT", `/api/sessions/${state.session.id}`, {
      body: { status: "completed", endedAt: new Date().toISOString() },
    });
    assertStatus(res, 200);
    return { detail: "session completed" };
  });

  await test("DELETE /api/project-agents/:id", async () => {
    if (!state.projectAgent?.id) return { skip: "no project agent" };
    const res = await request("DELETE", `/api/project-agents/${state.projectAgent.id}`);
    assert(res.status === 200 || res.status === 204, `Expected 200|204, got ${res.status}: ${res.text?.slice(0, 200)}`);
    return { detail: "deleted" };
  });

  // Clean up aura-network resources
  if (NETWORK_BASE) {
    await test("DELETE test project (aura-network)", async () => {
      if (!state.networkProject?.id) return { skip: "no project" };
      const res = await request("DELETE", `/api/projects/${state.networkProject.id}`, { base: NETWORK_BASE });
      assert(res.status === 200 || res.status === 204, `Expected 200|204, got ${res.status}`);
      return { detail: "deleted" };
    });

    await test("DELETE test agent (aura-network)", async () => {
      if (!state.networkAgent?.id) return { skip: "no agent" };
      const res = await request("DELETE", `/api/agents/${state.networkAgent.id}`, { base: NETWORK_BASE });
      assert(res.status === 200 || res.status === 204, `Expected 200|204, got ${res.status}`);
      return { detail: "deleted" };
    });

    await test("DELETE test org (aura-network)", async () => {
      if (!state.networkOrg?.id) return { skip: "no org" };
      const res = await request("DELETE", `/api/orgs/${state.networkOrg.id}`, { base: NETWORK_BASE });
      if (res.status === 200 || res.status === 204) return { detail: "deleted" };
      if (res.status === 404 || res.status === 405) {
        return { detail: `status=${res.status} (delete not supported — may need manual cleanup)` };
      }
      return { detail: `status=${res.status}` };
    });
  }

  // ── Summary ──────────────────────────────────────────────────────

  printSummary();
}

function printSummary() {
  console.log(`\n${"═".repeat(60)}`);
  console.log(`${BOLD}SUMMARY${RESET}\n`);

  const groups = {};
  for (const r of results) {
    if (!groups[r.group]) groups[r.group] = [];
    groups[r.group].push(r);
  }

  let totalPass = 0, totalFail = 0, totalSkip = 0;

  for (const [groupName, tests] of Object.entries(groups)) {
    const pass = tests.filter((t) => t.passed && !t.skipped).length;
    const fail = tests.filter((t) => !t.passed && !t.skipped).length;
    const skip = tests.filter((t) => t.skipped).length;
    totalPass += pass;
    totalFail += fail;
    totalSkip += skip;

    const status = fail > 0 ? FAIL : skip === tests.length ? SKIP : PASS;
    console.log(`  ${status} ${groupName}: ${pass} passed, ${fail} failed, ${skip} skipped`);
  }

  console.log(`\n  Total: ${totalPass} passed, ${totalFail} failed, ${totalSkip} skipped`);
  console.log(`${"═".repeat(60)}\n`);

  if (totalFail > 0) {
    console.log(`${BOLD}FAILURES:${RESET}\n`);
    for (const r of results) {
      if (!r.passed && !r.skipped) {
        console.log(`  ${FAIL} [${r.group}] ${r.name}`);
        console.log(`     ${r.detail}\n`);
      }
    }
  }

  if (totalSkip > 0) {
    console.log(`${BOLD}SKIPPED:${RESET}\n`);
    for (const r of results) {
      if (r.skipped) {
        console.log(`  ${SKIP} [${r.group}] ${r.name} — ${r.detail}`);
      }
    }
    console.log();
  }

  process.exit(totalFail > 0 ? 1 : 0);
}

// ── Run ──────────────────────────────────────────────────────────────

run().catch((err) => {
  console.error(`\nFATAL: ${err.message}`);
  console.error(err.stack);
  printSummary();
});
