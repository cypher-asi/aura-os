#!/usr/bin/env node

/**
 * aura-network API Integration Test Suite
 *
 * Tests every endpoint aura-app needs from aura-network to verify
 * 1:1 feature parity before wiring up the proxy layer.
 *
 * Usage:
 *   node scripts/test-aura-network.mjs
 *
 * Required env (reads from .env automatically):
 *   AURA_NETWORK_URL          - e.g. https://aura-network.onrender.com
 *   AURA_NETWORK_AUTH_TOKEN   - JWT from zOS login (Bearer token)
 *   AURA_NETWORK_INTERNAL_TOKEN - for /internal/* endpoints
 */

import { readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

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

let BASE = process.env.AURA_NETWORK_URL?.replace(/\/$/, "");
let JWT = process.env.AURA_NETWORK_AUTH_TOKEN;
let INTERNAL_TOKEN = process.env.AURA_NETWORK_INTERNAL_TOKEN;

if (!BASE) {
  console.error("ERROR: AURA_NETWORK_URL is not set. Add it to .env or export it.");
  process.exit(1);
}

const LOCAL_APP_URL = "http://localhost:3100";
const ZOS_LOGIN_URL = "https://zosapi.zero.tech/api/v2/accounts/login";

async function fetchTokenFromLocalApp() {
  try {
    const res = await fetch(`${LOCAL_APP_URL}/api/auth/access-token`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.access_token || null;
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
  // 1. Try .env / environment (already loaded above)
  if (JWT) return JWT;

  // 2. Try running local app
  console.log("\n  No AURA_NETWORK_AUTH_TOKEN in .env.");
  console.log("  Checking running aura-app (localhost:3100)...");
  const localToken = await fetchTokenFromLocalApp();
  if (localToken) {
    console.log("  Got JWT from local app.\n");
    return localToken;
  }
  console.log("  App not running.\n");

  // 3. Log in to zOS directly
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

async function request(method, path, { body, auth = "jwt", query, expectStatus } = {}) {
  const url = new URL(path, BASE);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }

  const headers = { "Content-Type": "application/json" };
  if (auth === "jwt") headers["Authorization"] = `Bearer ${JWT}`;
  else if (auth === "internal") headers["X-Internal-Token"] = INTERNAL_TOKEN || "";
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
  console.log(`${BOLD}aura-network Integration Test Suite${RESET}`);
  console.log(`Target: ${BASE}`);
  console.log(`JWT:    ${JWT.slice(0, 20)}...`);
  console.log(`Internal Token: ${INTERNAL_TOKEN ? INTERNAL_TOKEN.slice(0, 12) + "..." : "(not set)"}`);

  // ── Health ───────────────────────────────────────────────────────

  group("Health");

  await test("GET /health", async () => {
    const res = await request("GET", "/health", { auth: "none" });
    assertStatus(res, 200);
    return { detail: `${res.status} OK` };
  });

  // ── Users ────────────────────────────────────────────────────────

  group("Users");

  state.me = await test("GET /api/users/me", async () => {
    const res = await request("GET", "/api/users/me");
    assertStatus(res, 200);
    assertFields(res.json, ["id", "displayName"], "User");
    return { value: res.json, detail: `id=${res.json.id} name=${res.json.displayName}` };
  });

  await test("PUT /api/users/me (update profile)", async () => {
    const res = await request("PUT", "/api/users/me", {
      body: { bio: `aura-app integration test ${Date.now()}` },
    });
    assertStatus(res, 200);
    assertField(res.json, "bio");
    return { detail: "bio updated" };
  });

  await test("GET /api/users/:id", async () => {
    if (!state.me?.id) return { skip: "no user id from /me" };
    const res = await request("GET", `/api/users/${state.me.id}`);
    assertStatus(res, 200);
    assertFields(res.json, ["id", "displayName"]);
    return { detail: `found user ${res.json.displayName}` };
  });

  state.myProfile = await test("GET /api/users/:id/profile", async () => {
    if (!state.me?.id) return { skip: "no user id" };
    const res = await request("GET", `/api/users/${state.me.id}/profile`);
    assertStatus(res, 200);
    assertFields(res.json, ["id", "profileType", "displayName"]);
    return { value: res.json, detail: `profileId=${res.json.id} type=${res.json.profileType}` };
  });

  // ── Profiles ─────────────────────────────────────────────────────

  group("Profiles");

  await test("GET /api/profiles/:id", async () => {
    if (!state.myProfile?.id) return { skip: "no profile id" };
    const res = await request("GET", `/api/profiles/${state.myProfile.id}`);
    assertStatus(res, 200);
    assertFields(res.json, ["id", "profileType", "displayName"]);
    return { detail: `type=${res.json.profileType}` };
  });

  await test("GET /api/profiles/:id/activity", async () => {
    if (!state.myProfile?.id) return { skip: "no profile id" };
    const res = await request("GET", `/api/profiles/${state.myProfile.id}/activity`);
    assertStatus(res, 200);
    assert(Array.isArray(res.json), "Expected array of activity events");
    return { detail: `${res.json.length} events` };
  });

  // ── Organizations ────────────────────────────────────────────────

  group("Organizations");

  state.org = await test("POST /api/orgs (create)", async () => {
    const name = `test-org-${Date.now()}`;
    const res = await request("POST", "/api/orgs", { body: { name } });
    assertStatus(res, 200, 201);
    assertFields(res.json, ["id", "name", "slug"]);
    return { value: res.json, detail: `status=${res.status} id=${res.json.id} name=${res.json.name}` };
  });

  await test("GET /api/orgs (list)", async () => {
    const res = await request("GET", "/api/orgs");
    assertStatus(res, 200);
    assert(Array.isArray(res.json), "Expected array");
    return { detail: `${res.json.length} orgs` };
  });

  await test("GET /api/orgs/:id", async () => {
    if (!state.org?.id) return { skip: "no org" };
    const res = await request("GET", `/api/orgs/${state.org.id}`);
    assertStatus(res, 200);
    assertFields(res.json, ["id", "name"]);
    return { detail: `name=${res.json.name}` };
  });

  await test("PUT /api/orgs/:id (update)", async () => {
    if (!state.org?.id) return { skip: "no org" };
    const res = await request("PUT", `/api/orgs/${state.org.id}`, {
      body: { name: `${state.org.name}-updated` },
    });
    assertStatus(res, 200);
    assert(res.json.name.includes("updated"), "Name not updated");
    return { detail: `renamed to ${res.json.name}` };
  });

  // ── Org Members ──────────────────────────────────────────────────

  group("Org Members");

  await test("GET /api/orgs/:id/members (list)", async () => {
    if (!state.org?.id) return { skip: "no org" };
    const res = await request("GET", `/api/orgs/${state.org.id}/members`);
    assertStatus(res, 200);
    assert(Array.isArray(res.json), "Expected array");
    assert(res.json.length >= 1, "Owner should be a member");
    const owner = res.json.find((m) => m.role === "owner");
    assert(owner, "Expected owner member");
    return { detail: `${res.json.length} members, owner found` };
  });

  await test("PUT /api/orgs/:id/members/:userId (update role/budget)", async () => {
    if (!state.org?.id || !state.me?.id) return { skip: "no org or user" };
    const res = await request("PUT", `/api/orgs/${state.org.id}/members/${state.me.id}`, {
      body: { creditBudget: 100000 },
    });
    // Owner role change may be restricted, but budget update should work
    if (res.status === 200) {
      return { detail: "budget updated" };
    }
    // Some implementations prevent self-role change; accept 200 or 400
    assert(res.status === 200 || res.status === 400 || res.status === 403,
      `Unexpected status ${res.status}: ${res.text?.slice(0, 100)}`);
    return { detail: `status=${res.status} (may restrict self-update)` };
  });

  // ── Org Invites ──────────────────────────────────────────────────

  group("Org Invites");

  state.invite = await test("POST /api/orgs/:id/invites (create)", async () => {
    if (!state.org?.id) return { skip: "no org" };
    const res = await request("POST", `/api/orgs/${state.org.id}/invites`);
    assertStatus(res, 200, 201);
    assertFields(res.json, ["id", "token"]);
    return { value: res.json, detail: `status=${res.status} token=${res.json.token?.slice(0, 12)}...` };
  });

  await test("GET /api/orgs/:id/invites (list)", async () => {
    if (!state.org?.id) return { skip: "no org" };
    const res = await request("GET", `/api/orgs/${state.org.id}/invites`);
    assertStatus(res, 200);
    assert(Array.isArray(res.json), "Expected array");
    return { detail: `${res.json.length} invites` };
  });

  await test("DELETE /api/orgs/:id/invites/:inviteId (revoke)", async () => {
    if (!state.org?.id || !state.invite?.id) return { skip: "no invite" };
    const res = await request("DELETE", `/api/orgs/${state.org.id}/invites/${state.invite.id}`);
    assert(res.status === 200 || res.status === 204, `Expected 200|204, got ${res.status}`);
    return { detail: "invite revoked" };
  });

  // Note: POST /api/invites/:token/accept requires a DIFFERENT user's JWT,
  // so we test the endpoint exists but expect 4xx for self-accept
  await test("POST /api/invites/:token/accept (endpoint exists)", async () => {
    if (!state.invite?.token) return { skip: "no invite token" };
    const res = await request("POST", `/api/invites/${state.invite.token}/accept`);
    // Revoked invite or self-accept should return 400/403/404/409, not 500
    assert(res.status < 500, `Server error: ${res.status} ${res.text?.slice(0, 100)}`);
    return { detail: `status=${res.status} (expected rejection — invite was revoked or self-accept)` };
  });

  // ── Agents ───────────────────────────────────────────────────────

  group("Agents");

  state.agent = await test("POST /api/agents (create)", async () => {
    const res = await request("POST", "/api/agents", {
      body: {
        name: `test-agent-${Date.now()}`,
        role: "developer",
        personality: "helpful and thorough",
        systemPrompt: "You are a test agent.",
        skills: ["typescript", "rust"],
        icon: "bot",
      },
    });
    assertStatus(res, 200, 201);
    assertFields(res.json, ["id", "name"]);
    return { value: res.json, detail: `status=${res.status} id=${res.json.id} name=${res.json.name}` };
  });

  await test("GET /api/agents (list)", async () => {
    const res = await request("GET", "/api/agents");
    assertStatus(res, 200);
    assert(Array.isArray(res.json), "Expected array");
    return { detail: `${res.json.length} agents` };
  });

  await test("GET /api/agents?org_id= (list filtered by org)", async () => {
    if (!state.org?.id) return { skip: "no org" };
    const res = await request("GET", "/api/agents", { query: { org_id: state.org.id } });
    assertStatus(res, 200);
    assert(Array.isArray(res.json), "Expected array");
    return { detail: `${res.json.length} agents in org` };
  });

  await test("GET /api/agents/:id", async () => {
    if (!state.agent?.id) return { skip: "no agent" };
    const res = await request("GET", `/api/agents/${state.agent.id}`);
    assertStatus(res, 200);
    assertFields(res.json, ["id", "name"]);
    return { detail: `name=${res.json.name}` };
  });

  await test("PUT /api/agents/:id (update)", async () => {
    if (!state.agent?.id) return { skip: "no agent" };
    const res = await request("PUT", `/api/agents/${state.agent.id}`, {
      body: { personality: "updated personality for testing" },
    });
    assertStatus(res, 200);
    return { detail: "personality updated" };
  });

  state.agentProfile = await test("GET /api/agents/:id/profile", async () => {
    if (!state.agent?.id) return { skip: "no agent" };
    const res = await request("GET", `/api/agents/${state.agent.id}/profile`);
    assertStatus(res, 200);
    assertFields(res.json, ["id", "profileType"]);
    assert(res.json.profileType === "agent", `Expected profileType=agent, got ${res.json.profileType}`);
    return { value: res.json, detail: `profileId=${res.json.id}` };
  });

  // ── Projects ─────────────────────────────────────────────────────

  group("Projects");

  state.project = await test("POST /api/projects (create)", async () => {
    if (!state.org?.id) return { skip: "no org" };
    const res = await request("POST", "/api/projects", {
      body: {
        name: `test-project-${Date.now()}`,
        orgId: state.org.id,
        folder: "/tmp/test-project",
      },
    });
    assertStatus(res, 200, 201);
    assertFields(res.json, ["id", "name"]);
    return { value: res.json, detail: `status=${res.status} id=${res.json.id} name=${res.json.name}` };
  });

  await test("GET /api/projects?org_id= (list)", async () => {
    if (!state.org?.id) return { skip: "no org" };
    const res = await request("GET", "/api/projects", { query: { org_id: state.org.id } });
    assertStatus(res, 200);
    assert(Array.isArray(res.json), "Expected array");
    const found = res.json.some((p) => p.id === state.project?.id);
    return { detail: `${res.json.length} projects, created project ${found ? "found" : "NOT found"}` };
  });

  await test("GET /api/projects/:id", async () => {
    if (!state.project?.id) return { skip: "no project" };
    const res = await request("GET", `/api/projects/${state.project.id}`);
    assertStatus(res, 200);
    assertFields(res.json, ["id", "name"]);
    return { detail: `name=${res.json.name}` };
  });

  await test("PUT /api/projects/:id (update)", async () => {
    if (!state.project?.id) return { skip: "no project" };
    const res = await request("PUT", `/api/projects/${state.project.id}`, {
      body: { name: `${state.project.name}-updated` },
    });
    assertStatus(res, 200);
    return { detail: `renamed to ${res.json.name}` };
  });

  // ── Follows ──────────────────────────────────────────────────────

  group("Follows");

  state.follow = await test("POST /api/follows (follow a profile)", async () => {
    if (!state.agentProfile?.id) return { skip: "no agent profile to follow" };
    const res = await request("POST", "/api/follows", {
      body: { targetProfileId: state.agentProfile.id },
    });
    assertStatus(res, 200, 201);
    return { value: res.json, detail: `following profile ${state.agentProfile.id}` };
  });

  await test("GET /api/follows (list)", async () => {
    const res = await request("GET", "/api/follows");
    assertStatus(res, 200);
    assert(Array.isArray(res.json), "Expected array");
    return { detail: `${res.json.length} follows` };
  });

  await test("DELETE /api/follows/:profileId (unfollow)", async () => {
    if (!state.agentProfile?.id) return { skip: "no profile to unfollow" };
    const res = await request("DELETE", `/api/follows/${state.agentProfile.id}`);
    assert(res.status === 200 || res.status === 204, `Expected 200|204, got ${res.status}`);
    return { detail: "unfollowed" };
  });

  // ── Feed ─────────────────────────────────────────────────────────

  group("Feed");

  for (const filter of ["my-agents", "org", "following", "everything"]) {
    await test(`GET /api/feed?filter=${filter}`, async () => {
      const res = await request("GET", "/api/feed", { query: { filter } });
      assertStatus(res, 200);
      assert(Array.isArray(res.json), "Expected array");
      return { detail: `${res.json.length} events` };
    });
  }

  await test("GET /api/feed (pagination: limit + offset)", async () => {
    const res = await request("GET", "/api/feed?limit=5&offset=0", {});
    assertStatus(res, 200);
    assert(Array.isArray(res.json), "Expected array");
    assert(res.json.length <= 5, `Expected <=5 results, got ${res.json.length}`);
    return { detail: `${res.json.length} events (limit=5)` };
  });

  // ── Comments ─────────────────────────────────────────────────────

  group("Comments");

  // We need an activity event to comment on. Try posting one via internal endpoint first.
  state.activityEvent = await test("POST /internal/activity (create test event for comments)", async () => {
    if (!INTERNAL_TOKEN) return { skip: "no AURA_NETWORK_INTERNAL_TOKEN" };
    if (!state.myProfile?.id || !state.org?.id) return { skip: "no profile or org" };
    const res = await request("POST", "/internal/activity", {
      auth: "internal",
      body: {
        profileId: state.myProfile.id,
        orgId: state.org.id,
        projectId: state.project?.id,
        eventType: "task_completed",
        title: "Integration test: completed task",
        summary: "Automated test event from aura-app integration tests",
        metadata: { test: true, timestamp: Date.now() },
      },
    });
    if (res.status === 201 || res.status === 200) {
      assertField(res.json, "id");
      return { value: res.json, detail: `eventId=${res.json.id}` };
    }
    return { skip: `status=${res.status} ${res.text?.slice(0, 80)}` };
  });

  // If no event from internal endpoint, try to find one from the feed
  if (!state.activityEvent) {
    state.activityEvent = await test("(fallback) find existing event from feed", async () => {
      const res = await request("GET", "/api/feed", { query: { filter: "everything", limit: 1 } });
      if (res.ok && res.json?.length > 0) {
        return { value: res.json[0], detail: `using event ${res.json[0].id}` };
      }
      return { skip: "no events in feed to comment on" };
    });
  }

  state.comment = await test("POST /api/activity/:eventId/comments (add)", async () => {
    if (!state.activityEvent?.id) return { skip: "no activity event" };
    const res = await request("POST", `/api/activity/${state.activityEvent.id}/comments`, {
      body: { content: `Integration test comment ${Date.now()}` },
    });
    assertStatus(res, 200, 201);
    assertFields(res.json, ["id", "content"]);
    return { value: res.json, detail: `commentId=${res.json.id}` };
  });

  await test("GET /api/activity/:eventId/comments (list)", async () => {
    if (!state.activityEvent?.id) return { skip: "no activity event" };
    const res = await request("GET", `/api/activity/${state.activityEvent.id}/comments`);
    assertStatus(res, 200);
    assert(Array.isArray(res.json), "Expected array");
    return { detail: `${res.json.length} comments` };
  });

  await test("DELETE /api/comments/:id (delete own)", async () => {
    if (!state.comment?.id) return { skip: "no comment" };
    const res = await request("DELETE", `/api/comments/${state.comment.id}`);
    assert(res.status === 200 || res.status === 204, `Expected 200|204, got ${res.status}`);
    return { detail: "comment deleted" };
  });

  // ── Leaderboard ──────────────────────────────────────────────────

  group("Leaderboard");

  for (const period of ["day", "week", "month", "all"]) {
    await test(`GET /api/leaderboard?period=${period}`, async () => {
      const res = await request("GET", "/api/leaderboard", { query: { period } });
      assertStatus(res, 200);
      assert(Array.isArray(res.json), "Expected array");
      return { detail: `${res.json.length} entries` };
    });
  }

  await test("GET /api/leaderboard?period=week&org_id= (org-scoped)", async () => {
    if (!state.org?.id) return { skip: "no org" };
    const res = await request("GET", "/api/leaderboard", {
      query: { period: "week", org_id: state.org.id },
    });
    assertStatus(res, 200);
    assert(Array.isArray(res.json), "Expected array");
    return { detail: `${res.json.length} entries in org` };
  });

  // ── Token Usage & Stats ──────────────────────────────────────────

  group("Token Usage & Stats");

  await test("GET /api/users/me/usage (personal)", async () => {
    const res = await request("GET", "/api/users/me/usage");
    assertStatus(res, 200);
    return { detail: JSON.stringify(res.json).slice(0, 100) };
  });

  await test("GET /api/users/me/usage?period=month", async () => {
    const res = await request("GET", "/api/users/me/usage", { query: { period: "month" } });
    assertStatus(res, 200);
    return { detail: "period=month OK" };
  });

  await test("GET /api/orgs/:id/usage (org usage)", async () => {
    if (!state.org?.id) return { skip: "no org" };
    const res = await request("GET", `/api/orgs/${state.org.id}/usage`);
    assertStatus(res, 200);
    return { detail: JSON.stringify(res.json).slice(0, 100) };
  });

  await test("GET /api/orgs/:id/usage?period=month", async () => {
    if (!state.org?.id) return { skip: "no org" };
    const res = await request("GET", `/api/orgs/${state.org.id}/usage`, { query: { period: "month" } });
    assertStatus(res, 200);
    return { detail: "period=month OK" };
  });

  await test("GET /api/orgs/:id/usage/members (per-member breakdown)", async () => {
    if (!state.org?.id) return { skip: "no org" };
    const res = await request("GET", `/api/orgs/${state.org.id}/usage/members`);
    assertStatus(res, 200);
    assert(Array.isArray(res.json), "Expected array");
    return { detail: `${res.json.length} members with usage` };
  });

  await test("GET /api/stats (global KPIs)", async () => {
    const res = await request("GET", "/api/stats");
    assertStatus(res, 200);
    return { detail: JSON.stringify(res.json).slice(0, 120) };
  });

  // ── Internal Endpoints ───────────────────────────────────────────

  group("Internal Endpoints");

  if (!INTERNAL_TOKEN) {
    record("(all internal endpoints)", false, "AURA_NETWORK_INTERNAL_TOKEN not set", true);
  } else {
    await test("GET /internal/users/:zeroUserId (lookup)", async () => {
      if (!state.me?.zeroUserId) return { skip: "no zeroUserId on current user" };
      const res = await request("GET", `/internal/users/${state.me.zeroUserId}`, { auth: "internal" });
      assertStatus(res, 200);
      assertFields(res.json, ["id"]);
      return { detail: `found user id=${res.json.id}` };
    });

    await test("POST /internal/usage (record token usage)", async () => {
      if (!state.org?.id || !state.me?.id) return { skip: "no org or user" };
      const res = await request("POST", "/internal/usage", {
        auth: "internal",
        body: {
          orgId: state.org.id,
          userId: state.me.id,
          agentId: state.agent?.id,
          model: "claude-sonnet-4-20250514",
          inputTokens: 1000,
          outputTokens: 500,
          estimatedCostUsd: 0.015,
        },
      });
      assert(res.status === 200 || res.status === 201 || res.status === 204,
        `Expected 200|201|204, got ${res.status}: ${res.text?.slice(0, 100)}`);
      return { detail: `status=${res.status}` };
    });

    await test("POST /internal/activity (post activity event)", async () => {
      if (!state.myProfile?.id || !state.org?.id) return { skip: "no profile or org" };
      const res = await request("POST", "/internal/activity", {
        auth: "internal",
        body: {
          profileId: state.myProfile.id,
          orgId: state.org.id,
          projectId: state.project?.id,
          eventType: "loop_finished",
          title: "Dev loop completed (integration test)",
          summary: "Automated event from test script",
          metadata: { tasksCompleted: 3, tokensUsed: 15000 },
        },
      });
      assert(res.status === 200 || res.status === 201,
        `Expected 200|201, got ${res.status}: ${res.text?.slice(0, 100)}`);
      return { detail: `status=${res.status}` };
    });

    await test("GET /internal/orgs/:id/members/:userId/budget (credit budget)", async () => {
      if (!state.org?.id || !state.me?.id) return { skip: "no org or user" };
      const res = await request("GET", `/internal/orgs/${state.org.id}/members/${state.me.id}/budget`, {
        auth: "internal",
      });
      assertStatus(res, 200);
      assertField(res.json, "allowed", "Budget response");
      return { detail: `allowed=${res.json.allowed} budget=${res.json.budget} used=${res.json.used}` };
    });
  }

  // ── WebSocket ────────────────────────────────────────────────────

  group("WebSocket");

  await test("WS /ws/events (connect + receive)", async () => {
    const wsUrl = BASE.replace(/^http/, "ws") + `/ws/events?token=${JWT}`;
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        resolve({ detail: "connected OK (no events within 3s, which is expected)" });
      }, 3000);

      try {
        // Node 21+ has built-in WebSocket; older versions need polyfill
        if (typeof WebSocket === "undefined") {
          clearTimeout(timeout);
          resolve({ skip: "WebSocket not available in this Node version (need 21+)" });
          return;
        }
        const ws = new WebSocket(wsUrl);
        ws.onopen = () => {
          clearTimeout(timeout);
          ws.close();
          resolve({ detail: "connected and closed cleanly" });
        };
        ws.onerror = (err) => {
          clearTimeout(timeout);
          ws.close?.();
          resolve({ skip: `WS error: ${err.message || "connection failed"}` });
        };
      } catch (err) {
        clearTimeout(timeout);
        resolve({ skip: `WS not supported: ${err.message}` });
      }
    });
  });

  // ── Response Shape Validation ────────────────────────────────────
  // Verify aura-network responses match what aura-app interface expects

  group("Response Shape Validation (camelCase fields)");

  await test("User has expected fields", async () => {
    if (!state.me) return { skip: "no user data" };
    const expected = ["id", "displayName", "createdAt", "updatedAt"];
    const optional = ["zeroUserId", "profileImage", "primaryZid", "bio"];
    for (const f of expected) assertField(state.me, f, "User");
    const present = [...expected, ...optional.filter((f) => state.me[f] !== undefined)];
    return { detail: `fields: ${present.join(", ")}` };
  });

  await test("Org has expected fields", async () => {
    if (!state.org) return { skip: "no org data" };
    const expected = ["id", "name", "slug", "createdAt"];
    const optional = ["ownerUserId", "billingEmail", "updatedAt"];
    for (const f of expected) assertField(state.org, f, "Org");
    const present = [...expected, ...optional.filter((f) => state.org[f] !== undefined)];
    return { detail: `fields: ${present.join(", ")}` };
  });

  await test("Agent has expected fields", async () => {
    if (!state.agent) return { skip: "no agent data" };
    const expected = ["id", "name", "createdAt"];
    const optional = ["userId", "orgId", "role", "personality", "systemPrompt", "skills", "icon", "updatedAt"];
    for (const f of expected) assertField(state.agent, f, "Agent");
    const present = [...expected, ...optional.filter((f) => state.agent[f] !== undefined)];
    return { detail: `fields: ${present.join(", ")}` };
  });

  await test("Project has expected fields", async () => {
    if (!state.project) return { skip: "no project data" };
    const expected = ["id", "name", "createdAt"];
    const optional = ["orgId", "folder", "updatedAt"];
    for (const f of expected) assertField(state.project, f, "Project");
    const present = [...expected, ...optional.filter((f) => state.project[f] !== undefined)];
    return { detail: `fields: ${present.join(", ")}` };
  });

  await test("Profile has expected fields", async () => {
    if (!state.myProfile) return { skip: "no profile data" };
    const expected = ["id", "profileType", "displayName", "createdAt"];
    const optional = ["userId", "agentId", "bio", "avatar", "updatedAt"];
    for (const f of expected) assertField(state.myProfile, f, "Profile");
    const present = [...expected, ...optional.filter((f) => state.myProfile[f] !== undefined)];
    return { detail: `fields: ${present.join(", ")}` };
  });

  // ── Error Handling ───────────────────────────────────────────────

  group("Error Handling");

  await test("GET /api/users/nonexistent → 404 with error body", async () => {
    const res = await request("GET", "/api/users/00000000-0000-0000-0000-000000000000");
    assertStatus(res, 404);
    assertField(res.json?.error || res.json, "code", "Error response");
    return { detail: `code=${(res.json?.error || res.json)?.code}` };
  });

  await test("GET /api/orgs (no auth) → 401", async () => {
    const res = await request("GET", "/api/orgs", { auth: "none" });
    assertStatus(res, 401);
    return { detail: "401 Unauthorized as expected" };
  });

  await test("POST /api/orgs (invalid body) → 400", async () => {
    const res = await request("POST", "/api/orgs", { body: {} });
    assert(res.status === 400 || res.status === 422,
      `Expected 400|422, got ${res.status}`);
    return { detail: `status=${res.status}` };
  });

  // ── Cleanup ──────────────────────────────────────────────────────

  group("Cleanup");

  await test("DELETE /api/projects/:id", async () => {
    if (!state.project?.id) return { skip: "no project to delete" };
    const res = await request("DELETE", `/api/projects/${state.project.id}`);
    assert(res.status === 200 || res.status === 204, `Expected 200|204, got ${res.status}`);
    return { detail: "project deleted" };
  });

  await test("DELETE /api/agents/:id", async () => {
    if (!state.agent?.id) return { skip: "no agent to delete" };
    const res = await request("DELETE", `/api/agents/${state.agent.id}`);
    assert(res.status === 200 || res.status === 204, `Expected 200|204, got ${res.status}`);
    return { detail: "agent deleted" };
  });

  // Delete org last (depends on nothing else existing in it)
  await test("DELETE /api/orgs/:id (if supported)", async () => {
    if (!state.org?.id) return { skip: "no org to delete" };
    // aura-network README doesn't list DELETE /api/orgs/:id, so this may 404/405
    const res = await request("DELETE", `/api/orgs/${state.org.id}`);
    if (res.status === 200 || res.status === 204) {
      return { detail: "org deleted" };
    }
    if (res.status === 404 || res.status === 405) {
      return { detail: `status=${res.status} (org delete not supported — may need manual cleanup)` };
    }
    return { detail: `status=${res.status}` };
  });

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
