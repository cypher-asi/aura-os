#!/usr/bin/env node

/**
 * z-billing & aura-router API Integration Test Suite
 *
 * Tests every endpoint aura-app needs from z-billing and aura-router to verify
 * API contracts before implementing the billing migration.
 *
 * Usage:
 *   node scripts/test-zbilling-api.mjs
 *
 * Required env (reads from .env automatically):
 *   AURA_ROUTER_URL            - e.g. https://your-router-host.example.com
 *   Z_BILLING_URL              - e.g. https://your-billing-host.example.com
 *   AURA_NETWORK_AUTH_TOKEN    - JWT from zOS login (Bearer token)
 *
 * Test groups:
 *   1. Health checks (both services)
 *   2. z-billing: balance, purchase, transactions, account, payments
 *   3. aura-router: non-streaming, streaming (SSE), multiple models
 *   4. Error handling (401, 400, 402)
 *   5. Integration flows (balance → LLM → balance debit verification)
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

const ROUTER_BASE = process.env.AURA_ROUTER_URL?.replace(/\/$/, "");
const BILLING_BASE = process.env.Z_BILLING_URL?.replace(/\/$/, "");
let JWT = process.env.AURA_NETWORK_AUTH_TOKEN;

if (!ROUTER_BASE) {
  console.error("ERROR: AURA_ROUTER_URL is not set. Add it to .env or export it.");
  process.exit(1);
}
if (!BILLING_BASE) {
  console.error("ERROR: Z_BILLING_URL is not set. Add it to .env or export it.");
  process.exit(1);
}

// ── Token Acquisition ────────────────────────────────────────────────

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

  console.log("\n  No auth token in .env (AURA_NETWORK_AUTH_TOKEN).");
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

// ── HTTP Helpers ─────────────────────────────────────────────────────

async function request(method, path, { body, auth = "jwt", base, timeout = 60_000 } = {}) {
  const url = new URL(path, base);
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (auth === "jwt") headers["Authorization"] = `Bearer ${JWT}`;
  if (auth === "invalid") headers["Authorization"] = "Bearer invalid-token-12345";

  const opts = { method, headers, signal: AbortSignal.timeout(timeout) };
  if (body !== undefined) opts.body = JSON.stringify(body);

  const res = await fetch(url.toString(), opts);
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }

  return { status: res.status, ok: res.ok, json, text, headers: res.headers };
}

async function requestSSE(method, path, { body, auth = "jwt", base, timeout = 30_000 } = {}) {
  const url = new URL(path, base);
  const headers = { "Content-Type": "application/json" };
  if (auth === "jwt") headers["Authorization"] = `Bearer ${JWT}`;

  const res = await fetch(url.toString(), {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeout),
  });

  if (!res.ok) {
    const text = await res.text();
    return { status: res.status, ok: false, events: [], text, contentType: res.headers.get("content-type") };
  }

  const contentType = res.headers.get("content-type") || "";
  const events = [];
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.startsWith("event: ")) {
          const eventType = line.slice(7).trim();
          events.push({ type: eventType, data: null });
        } else if (line.startsWith("data: ")) {
          const dataStr = line.slice(6).trim();
          if (events.length > 0 && events[events.length - 1].data === null) {
            try { events[events.length - 1].data = JSON.parse(dataStr); } catch {
              events[events.length - 1].data = dataStr;
            }
          }
        }
      }
    }
  } catch (err) {
    if (err.name !== "AbortError") throw err;
  }

  return { status: res.status, ok: true, events, contentType };
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
    record(name, false, msg.slice(0, 300));
    return undefined;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertStatus(res, ...expected) {
  assert(
    expected.includes(res.status),
    `Expected ${expected.join("|")}, got ${res.status}: ${(res.text || "").slice(0, 200)}`
  );
}

function assertField(obj, field, label) {
  assert(obj && obj[field] !== undefined && obj[field] !== null, `${label || "Response"} missing field '${field}'`);
}

function assertFields(obj, fields, label) {
  for (const f of fields) assertField(obj, f, label);
}

// ── State ────────────────────────────────────────────────────────────

const state = {};

// ══════════════════════════════════════════════════════════════════════
//  TEST SUITE
// ══════════════════════════════════════════════════════════════════════

async function run() {
  console.log(`\n${BOLD}z-billing & aura-router Integration Test Suite${RESET}`);
  console.log(`Router:  ${ROUTER_BASE}`);
  console.log(`Billing: ${BILLING_BASE}`);
  console.log(`JWT:     ${JWT.slice(0, 20)}...`);

  // ── 0. Account Provisioning ─────────────────────────────────────────
  // z-billing may require account creation before other endpoints work.

  group("Account Provisioning (discovery)");

  state.accountExists = false;

  // Probe whether account exists
  const probeRes = await request("GET", "/v1/accounts/me", { base: BILLING_BASE });
  if (probeRes.status === 200) {
    state.accountExists = true;
    record("Account exists", true, `plan=${probeRes.json?.plan}`);
  } else if (probeRes.status === 404) {
    record("Account not found (404)", true, "will attempt provisioning");

    // Try POST /v1/accounts to create one
    await test("POST /v1/accounts (auto-provision)", async () => {
      const res = await request("POST", "/v1/accounts", { base: BILLING_BASE, body: {} });
      if (res.status === 200 || res.status === 201) {
        state.accountExists = true;
        return { detail: `${res.status} — account created: ${JSON.stringify(res.json).slice(0, 150)}` };
      }
      if (res.status === 404 || res.status === 405) {
        return { detail: `${res.status} — POST /v1/accounts not supported` };
      }
      return { detail: `${res.status} — ${(res.text || "").slice(0, 150)}` };
    });

    // Try POST /v1/accounts/register
    if (!state.accountExists) {
      await test("POST /v1/accounts/register (discover)", async () => {
        const res = await request("POST", "/v1/accounts/register", { base: BILLING_BASE, body: {} });
        if (res.status === 200 || res.status === 201) {
          state.accountExists = true;
          return { detail: `${res.status} — account registered: ${JSON.stringify(res.json).slice(0, 150)}` };
        }
        return { detail: `${res.status} — not supported` };
      });
    }

    // Try POST /v1/accounts/provision
    if (!state.accountExists) {
      await test("POST /v1/accounts/provision (discover)", async () => {
        const res = await request("POST", "/v1/accounts/provision", { base: BILLING_BASE, body: {} });
        if (res.status === 200 || res.status === 201) {
          state.accountExists = true;
          return { detail: `${res.status} — account provisioned: ${JSON.stringify(res.json).slice(0, 150)}` };
        }
        return { detail: `${res.status} — not supported` };
      });
    }

    // Try POST /v1/credits/balance (some APIs create on first balance check)
    if (!state.accountExists) {
      await test("POST /v1/credits/balance (discover auto-create)", async () => {
        const res = await request("POST", "/v1/credits/balance", { base: BILLING_BASE, body: {} });
        if (res.status === 200 || res.status === 201) {
          state.accountExists = true;
          return { detail: `${res.status} — balance created: ${JSON.stringify(res.json).slice(0, 150)}` };
        }
        return { detail: `${res.status} — not supported` };
      });
    }

    if (!state.accountExists) {
      console.log(`\n  ${BOLD}NOTE:${RESET} Account does not exist in z-billing and no auto-provisioning endpoint found.`);
      console.log(`  z-billing tests that require an account will fail with 404.`);
      console.log(`  The account may need to be created via aura-router (first LLM call) or admin API.\n`);
    }
  }

  // ── 1. Health Checks ───────────────────────────────────────────────

  group("Health Checks");

  await test("GET aura-router /health", async () => {
    const res = await request("GET", "/health", { base: ROUTER_BASE, auth: "none" });
    assertStatus(res, 200);
    assertField(res.json, "status", "Router health");
    return { detail: `${res.status} — ${JSON.stringify(res.json)}` };
  });

  await test("GET z-billing /health", async () => {
    const res = await request("GET", "/health", { base: BILLING_BASE, auth: "none" });
    assertStatus(res, 200);
    assertField(res.json, "status", "Billing health");
    return { detail: `${res.status} — ${JSON.stringify(res.json)}` };
  });

  // ── 2. z-billing: Balance ──────────────────────────────────────────

  group("z-billing: Balance");

  state.initialBalance = await test("GET /v1/credits/balance (valid JWT)", async () => {
    const res = await request("GET", "/v1/credits/balance", { base: BILLING_BASE });
    if (res.status === 404 && !state.accountExists) {
      return { skip: "account not found (needs provisioning)" };
    }
    assertStatus(res, 200);
    assertField(res.json, "balance_cents", "CreditBalance");
    assertField(res.json, "plan", "CreditBalance");
    assert(typeof res.json.balance_cents === "number", `balance_cents should be number, got ${typeof res.json.balance_cents}`);
    assert(typeof res.json.plan === "string", `plan should be string, got ${typeof res.json.plan}`);
    return {
      value: res.json,
      detail: `balance_cents=${res.json.balance_cents}, plan="${res.json.plan}", balance_formatted=${res.json.balance_formatted || "N/A"}`,
    };
  });

  await test("GET /v1/credits/balance (no JWT) → 401", async () => {
    const res = await request("GET", "/v1/credits/balance", { base: BILLING_BASE, auth: "none" });
    assertStatus(res, 401);
    return { detail: `${res.status} Unauthorized` };
  });

  await test("GET /v1/credits/balance (invalid JWT) → 401", async () => {
    const res = await request("GET", "/v1/credits/balance", { base: BILLING_BASE, auth: "invalid" });
    assertStatus(res, 401);
    return { detail: `${res.status} Unauthorized` };
  });

  // ── 3. z-billing: Account ──────────────────────────────────────────

  group("z-billing: Account");

  state.account = await test("GET /v1/accounts/me (valid JWT)", async () => {
    const res = await request("GET", "/v1/accounts/me", { base: BILLING_BASE });
    if (res.status === 404 && !state.accountExists) {
      return { skip: "account not found (needs provisioning)" };
    }
    assertStatus(res, 200);
    assert(res.json !== null, "Expected JSON response");
    return {
      value: res.json,
      detail: `keys=${Object.keys(res.json).join(",")}`,
    };
  });

  await test("GET /v1/accounts/me (no JWT) → 401", async () => {
    const res = await request("GET", "/v1/accounts/me", { base: BILLING_BASE, auth: "none" });
    assertStatus(res, 401);
    return { detail: `${res.status} Unauthorized` };
  });

  // ── 4. z-billing: Transactions ─────────────────────────────────────

  group("z-billing: Transactions");

  state.transactions = await test("GET /v1/credits/transactions (valid JWT)", async () => {
    const res = await request("GET", "/v1/credits/transactions", { base: BILLING_BASE });
    if (res.status === 404 && !state.accountExists) {
      return { skip: "account not found (needs provisioning)" };
    }
    assertStatus(res, 200);
    // Response may be a raw array or a wrapper object with a transactions field
    const txns = Array.isArray(res.json) ? res.json : (res.json?.transactions || res.json?.data || []);
    const isWrapped = !Array.isArray(res.json);
    assert(Array.isArray(txns), `Could not find transactions array. Keys: ${Object.keys(res.json || {}).join(",")}`);
    if (txns.length > 0) {
      const tx = txns[0];
      const keys = Object.keys(tx);
      return {
        value: txns,
        detail: `${txns.length} transactions${isWrapped ? " (wrapped in object)" : ""}, first keys=[${keys.join(",")}], wrapper keys=[${Object.keys(res.json).join(",")}]`,
      };
    }
    return {
      value: txns,
      detail: `0 transactions${isWrapped ? ` (wrapped in object, keys=[${Object.keys(res.json).join(",")}])` : " (empty account)"}`,
    };
  });

  await test("Verify transaction shape", async () => {
    if (!state.transactions || state.transactions.length === 0) {
      return { skip: "no transactions to inspect" };
    }
    const tx = state.transactions[0];
    const hasId = tx.id !== undefined;
    const hasAmount = tx.amount_cents !== undefined || tx.amount !== undefined;
    const hasType = tx.transaction_type !== undefined || tx.type !== undefined;
    const hasDesc = tx.description !== undefined;
    const hasDate = tx.created_at !== undefined || tx.createdAt !== undefined;
    return {
      detail: `id=${hasId}, amount=${hasAmount}, type=${hasType}, desc=${hasDesc}, date=${hasDate} | sample=${JSON.stringify(tx).slice(0, 200)}`,
    };
  });

  await test("GET /v1/credits/transactions (no JWT) → 401", async () => {
    const res = await request("GET", "/v1/credits/transactions", { base: BILLING_BASE, auth: "none" });
    assertStatus(res, 401);
    return { detail: `${res.status} Unauthorized` };
  });

  // ── 5. z-billing: Payments ─────────────────────────────────────────

  group("z-billing: Payments");

  await test("GET /v1/payments (valid JWT)", async () => {
    const res = await request("GET", "/v1/payments", { base: BILLING_BASE });
    if (res.status === 404) {
      // 404 is expected for accounts without a linked Stripe customer
      return { detail: `404 — ${res.json?.error?.message || "no Stripe customer"} (expected for fresh account)` };
    }
    assertStatus(res, 200);
    const isArray = Array.isArray(res.json);
    const isObj = res.json !== null && typeof res.json === "object";
    assert(isArray || isObj, `Expected array or object, got ${typeof res.json}`);
    const count = isArray ? res.json.length : (res.json.payments?.length ?? "N/A");
    return { detail: `${res.status} OK — ${count} payments` };
  });

  // ── 6. z-billing: Purchase ─────────────────────────────────────────

  group("z-billing: Purchase");

  state.checkout = await test("POST /v1/credits/purchase (amount_usd: 5.0)", async () => {
    if (!state.accountExists) return { skip: "account not found (needs provisioning)" };
    const res = await request("POST", "/v1/credits/purchase", {
      base: BILLING_BASE,
      body: { amount_usd: 5.0 },
    });
    assertStatus(res, 200, 201);
    assert(res.json !== null, "Expected JSON response");
    const url = res.json.checkout_url || res.json.checkoutUrl || res.json.url;
    assert(url, `No checkout URL found in response. Keys: ${Object.keys(res.json).join(",")}`);
    assert(url.startsWith("https://"), `checkout_url should be HTTPS, got: ${url.slice(0, 60)}`);
    const sessionId = res.json.session_id || res.json.sessionId || res.json.id;
    return {
      value: { checkout_url: url, session_id: sessionId },
      detail: `checkout_url=${url.slice(0, 60)}... session_id=${sessionId || "N/A"}`,
    };
  });

  await test("Verify checkout_url is Stripe", async () => {
    if (!state.checkout?.checkout_url) return { skip: "no checkout URL" };
    const url = state.checkout.checkout_url;
    assert(url.includes("stripe.com"), `Expected Stripe URL, got: ${url.slice(0, 80)}`);
    return { detail: `URL contains stripe.com` };
  });

  await test("POST /v1/credits/purchase (amount_usd: 0) → 400", async () => {
    const res = await request("POST", "/v1/credits/purchase", {
      base: BILLING_BASE,
      body: { amount_usd: 0 },
    });
    assertStatus(res, 400, 422);
    return { detail: `${res.status} — rejected zero amount` };
  });

  await test("POST /v1/credits/purchase (no JWT) → 401", async () => {
    const res = await request("POST", "/v1/credits/purchase", {
      base: BILLING_BASE,
      auth: "none",
      body: { amount_usd: 5.0 },
    });
    assertStatus(res, 401);
    return { detail: `${res.status} Unauthorized` };
  });

  // ── 7. aura-router: Non-Streaming LLM ─────────────────────────────

  group("aura-router: Non-Streaming (Haiku)");

  state.nonStreamResponse = await test("POST /v1/messages (haiku, stream=false)", async () => {
    const res = await request("POST", "/v1/messages", {
      base: ROUTER_BASE,
      body: {
        model: "claude-haiku-4-5",
        max_tokens: 50,
        stream: false,
        messages: [{ role: "user", content: "Reply with exactly: hello" }],
      },
      timeout: 30_000,
    });
    if (res.status === 402) {
      state.got402 = true;
      return { skip: `402 Insufficient Credits (expected if balance=0) — error: ${res.json?.error?.message}` };
    }
    assertStatus(res, 200);
    assert(res.json !== null, "Expected JSON response");
    return {
      value: res.json,
      detail: `keys=[${Object.keys(res.json).join(",")}]`,
    };
  });

  await test("Verify response has content", async () => {
    const r = state.nonStreamResponse;
    if (!r) return { skip: "no response from previous test" };
    assert(Array.isArray(r.content), `Expected content array, got ${typeof r.content}`);
    assert(r.content.length > 0, "content array is empty");
    const text = r.content[0]?.text || r.content[0]?.value;
    assert(text, "content[0] has no text");
    return { detail: `text="${text.slice(0, 80)}"` };
  });

  await test("Verify response has usage tokens", async () => {
    const r = state.nonStreamResponse;
    if (!r) return { skip: "no response" };
    assertField(r, "usage", "Response");
    assertField(r.usage, "input_tokens", "Usage");
    assertField(r.usage, "output_tokens", "Usage");
    return { detail: `input=${r.usage.input_tokens}, output=${r.usage.output_tokens}` };
  });

  await test("Verify response has stop_reason", async () => {
    const r = state.nonStreamResponse;
    if (!r) return { skip: "no response" };
    const reason = r.stop_reason || r.stop_sequence;
    assert(reason !== undefined, "Missing stop_reason");
    return { detail: `stop_reason="${reason}"` };
  });

  // ── 8. aura-router: Streaming LLM ─────────────────────────────────

  group("aura-router: Streaming (SSE)");

  state.sseResult = await test("POST /v1/messages (haiku, stream=true)", async () => {
    const result = await requestSSE("POST", "/v1/messages", {
      base: ROUTER_BASE,
      body: {
        model: "claude-haiku-4-5",
        max_tokens: 100,
        stream: true,
        messages: [{ role: "user", content: "Count from 1 to 5, one number per line." }],
      },
      timeout: 30_000,
    });
    if (result.status === 402) {
      return { skip: `402 Insufficient Credits (expected if balance=0)` };
    }
    assertStatus(result, 200);
    assert(result.events.length > 0, "No SSE events received");
    return {
      value: result,
      detail: `${result.events.length} events, content-type=${result.contentType}`,
    };
  });

  await test("Verify SSE has message_start event", async () => {
    if (!state.sseResult) return { skip: "no SSE result" };
    const evt = state.sseResult.events.find((e) => e.type === "message_start");
    assert(evt, `No message_start event. Events: [${state.sseResult.events.map((e) => e.type).join(", ")}]`);
    return { detail: `found message_start` };
  });

  await test("Verify SSE has content_block_delta events", async () => {
    if (!state.sseResult) return { skip: "no SSE result" };
    const deltas = state.sseResult.events.filter((e) => e.type === "content_block_delta");
    assert(deltas.length > 0, "No content_block_delta events");
    const sampleText = deltas[0]?.data?.delta?.text || JSON.stringify(deltas[0]?.data).slice(0, 60);
    return { detail: `${deltas.length} delta events, first="${sampleText}"` };
  });

  await test("Verify SSE has message_stop event", async () => {
    if (!state.sseResult) return { skip: "no SSE result" };
    const evt = state.sseResult.events.find((e) => e.type === "message_stop");
    assert(evt, "No message_stop event");
    return { detail: "stream completed cleanly" };
  });

  await test("Verify SSE message_delta has usage", async () => {
    if (!state.sseResult) return { skip: "no SSE result" };
    const evt = state.sseResult.events.find((e) => e.type === "message_delta");
    if (!evt) return { skip: "no message_delta event" };
    const usage = evt.data?.usage;
    if (!usage) return { skip: `message_delta has no usage: ${JSON.stringify(evt.data).slice(0, 100)}` };
    return { detail: `output_tokens=${usage.output_tokens}` };
  });

  // ── 9. aura-router: Multiple Models ────────────────────────────────

  group("aura-router: Multiple Models");

  for (const model of ["claude-haiku-4-5", "claude-sonnet-4-5"]) {
    await test(`POST /v1/messages (${model})`, async () => {
      const res = await request("POST", "/v1/messages", {
        base: ROUTER_BASE,
        body: {
          model,
          max_tokens: 20,
          stream: false,
          messages: [{ role: "user", content: "Say OK" }],
        },
        timeout: 60_000,
      });
      if (res.status === 402) {
        return { skip: `402 Insufficient Credits` };
      }
      assertStatus(res, 200);
      assert(res.json?.content?.length > 0, "Empty content");
      const text = res.json.content[0]?.text || "";
      return { detail: `model=${res.json.model || model}, text="${text.slice(0, 40)}"` };
    });
  }

  // Opus is expensive — skip by default, just note it
  await test("POST /v1/messages (claude-opus-4-6) — skipped (expensive)", async () => {
    return { skip: "opus is $15+/Mout — enable manually if needed" };
  });

  // ── 10. aura-router: Error Handling ────────────────────────────────

  group("aura-router: Error Handling");

  await test("POST /v1/messages (no JWT) → 401", async () => {
    const res = await request("POST", "/v1/messages", {
      base: ROUTER_BASE,
      auth: "none",
      body: {
        model: "claude-haiku-4-5",
        max_tokens: 10,
        messages: [{ role: "user", content: "test" }],
      },
    });
    assertStatus(res, 401);
    return { detail: `${res.status} Unauthorized` };
  });

  await test("POST /v1/messages (invalid JWT) → 401", async () => {
    const res = await request("POST", "/v1/messages", {
      base: ROUTER_BASE,
      auth: "invalid",
      body: {
        model: "claude-haiku-4-5",
        max_tokens: 10,
        messages: [{ role: "user", content: "test" }],
      },
    });
    assertStatus(res, 401);
    return { detail: `${res.status} Unauthorized` };
  });

  await test("POST /v1/messages (nonexistent model) → 400", async () => {
    const res = await request("POST", "/v1/messages", {
      base: ROUTER_BASE,
      body: {
        model: "nonexistent-model-xyz",
        max_tokens: 10,
        messages: [{ role: "user", content: "test" }],
      },
    });
    assertStatus(res, 400);
    return { detail: `${res.status} Bad Request` };
  });

  await test("POST /v1/messages (empty body) → 400", async () => {
    const res = await request("POST", "/v1/messages", {
      base: ROUTER_BASE,
      body: {},
    });
    assertStatus(res, 400, 422);
    return { detail: `${res.status}` };
  });

  // ── 10b. aura-router: 402 Insufficient Credits ─────────────────────

  group("aura-router: 402 Handling");

  await test("Verify 402 error shape (INSUFFICIENT_CREDITS)", async () => {
    const res = await request("POST", "/v1/messages", {
      base: ROUTER_BASE,
      body: {
        model: "claude-haiku-4-5",
        max_tokens: 10,
        messages: [{ role: "user", content: "test" }],
      },
    });
    if (res.status === 200) {
      return { detail: "got 200 (account has credits) — cannot verify 402 shape" };
    }
    assertStatus(res, 402);
    assert(res.json?.error, "402 response missing error object");
    assert(res.json.error.code === "INSUFFICIENT_CREDITS", `Expected code=INSUFFICIENT_CREDITS, got ${res.json.error.code}`);
    assert(typeof res.json.error.message === "string", "error.message should be string");
    return { detail: `code="${res.json.error.code}", message="${res.json.error.message}"` };
  });

  // ── 11. Flow: LLM Request Debits Credits ───────────────────────────

  group("Flow: LLM Request Debits Credits");

  state.flowBalanceBefore = await test("Record balance before LLM call", async () => {
    const res = await request("GET", "/v1/credits/balance", { base: BILLING_BASE });
    if (res.status === 404) return { skip: "account not found" };
    assertStatus(res, 200);
    return { value: res.json.balance_cents, detail: `balance_cents=${res.json.balance_cents}` };
  });

  state.flowLlmResponse = await test("Make LLM call via aura-router", async () => {
    if (state.flowBalanceBefore === undefined) return { skip: "could not get balance" };
    if (state.flowBalanceBefore <= 0) return { skip: `balance is ${state.flowBalanceBefore} — no credits to test debit` };
    const res = await request("POST", "/v1/messages", {
      base: ROUTER_BASE,
      body: {
        model: "claude-haiku-4-5",
        max_tokens: 20,
        stream: false,
        messages: [{ role: "user", content: "Say hello" }],
      },
      timeout: 30_000,
    });
    assertStatus(res, 200);
    return { value: res.json, detail: `input=${res.json.usage?.input_tokens}, output=${res.json.usage?.output_tokens}` };
  });

  // Small delay to let billing settle
  if (state.flowLlmResponse) {
    await new Promise((r) => setTimeout(r, 2000));
  }

  await test("Verify balance decreased after LLM call", async () => {
    if (state.flowBalanceBefore === undefined || !state.flowLlmResponse) {
      return { skip: "previous steps failed" };
    }
    const res = await request("GET", "/v1/credits/balance", { base: BILLING_BASE });
    assertStatus(res, 200);
    const after = res.json.balance_cents;
    const diff = state.flowBalanceBefore - after;
    assert(diff > 0, `Balance did not decrease: before=${state.flowBalanceBefore}, after=${after}, diff=${diff}`);
    return { detail: `before=${state.flowBalanceBefore}, after=${after}, debited=${diff} cents` };
  });

  await test("Verify latest transaction matches LLM usage", async () => {
    if (!state.flowLlmResponse) return { skip: "no LLM response" };
    const res = await request("GET", "/v1/credits/transactions", { base: BILLING_BASE });
    assertStatus(res, 200);
    const txns = Array.isArray(res.json) ? res.json : (res.json?.transactions || []);
    if (txns.length === 0) {
      return { detail: "no usage transactions yet (debits may not appear as individual transactions)" };
    }
    const latest = txns[0];
    return { detail: `latest tx: ${JSON.stringify(latest).slice(0, 200)}` };
  });

  // ── 12. Flow: Streaming + Billing ──────────────────────────────────

  group("Flow: Streaming + Billing");

  const streamBalBefore = await test("Record balance before streaming call", async () => {
    const res = await request("GET", "/v1/credits/balance", { base: BILLING_BASE });
    if (res.status === 404) return { skip: "account not found" };
    assertStatus(res, 200);
    return { value: res.json.balance_cents, detail: `balance_cents=${res.json.balance_cents}` };
  });

  const streamResult = await test("Stream LLM call via aura-router", async () => {
    if (streamBalBefore === undefined || streamBalBefore <= 0) {
      return { skip: `balance=${streamBalBefore} — cannot test` };
    }
    const result = await requestSSE("POST", "/v1/messages", {
      base: ROUTER_BASE,
      body: {
        model: "claude-haiku-4-5",
        max_tokens: 50,
        stream: true,
        messages: [{ role: "user", content: "Say hello world" }],
      },
      timeout: 30_000,
    });
    assertStatus(result, 200);
    const stopEvt = result.events.find((e) => e.type === "message_stop");
    assert(stopEvt, "Stream did not complete (no message_stop)");
    return { value: result, detail: `${result.events.length} events, stream completed` };
  });

  if (streamResult) {
    await new Promise((r) => setTimeout(r, 2000));
  }

  await test("Verify balance decreased after streaming call", async () => {
    if (streamBalBefore === undefined || !streamResult) return { skip: "previous steps failed" };
    const res = await request("GET", "/v1/credits/balance", { base: BILLING_BASE });
    assertStatus(res, 200);
    const after = res.json.balance_cents;
    const diff = streamBalBefore - after;
    assert(diff > 0, `Balance did not decrease: before=${streamBalBefore}, after=${after}`);
    return { detail: `before=${streamBalBefore}, after=${after}, debited=${diff} cents` };
  });

  // ── 13. Flow: Auth Consistency ─────────────────────────────────────

  group("Flow: Auth Consistency");

  await test("Same JWT authenticates on both services", async () => {
    const [bal, llm] = await Promise.all([
      request("GET", "/v1/credits/balance", { base: BILLING_BASE }),
      request("POST", "/v1/messages", {
        base: ROUTER_BASE,
        body: {
          model: "claude-haiku-4-5",
          max_tokens: 10,
          stream: false,
          messages: [{ role: "user", content: "OK" }],
        },
        timeout: 30_000,
      }),
    ]);
    // Both should accept the JWT (not 401). 404/402 are OK — they mean auth succeeded.
    const balAuth = bal.status !== 401;
    const llmAuth = llm.status !== 401;
    assert(balAuth, `z-billing rejected JWT: ${bal.status}`);
    assert(llmAuth, `aura-router rejected JWT: ${llm.status}`);
    return { detail: `z-billing=${bal.status}, aura-router=${llm.status} — JWT accepted by both` };
  });

  // ── 14. Response Shape Snapshot ────────────────────────────────────

  group("Response Shape Snapshot");

  await test("CreditBalance shape", async () => {
    if (!state.initialBalance) return { skip: "no balance response" };
    const b = state.initialBalance;
    const shape = {};
    for (const [k, v] of Object.entries(b)) shape[k] = typeof v;
    return { detail: JSON.stringify(shape) };
  });

  await test("Account shape", async () => {
    if (!state.account) return { skip: "no account response" };
    const shape = {};
    for (const [k, v] of Object.entries(state.account)) shape[k] = typeof v;
    return { detail: JSON.stringify(shape) };
  });

  await test("Transaction shape (first entry)", async () => {
    if (!state.transactions || state.transactions.length === 0) return { skip: "no transactions" };
    const tx = state.transactions[0];
    const shape = {};
    for (const [k, v] of Object.entries(tx)) shape[k] = typeof v;
    return { detail: JSON.stringify(shape) };
  });

  await test("Non-stream LLM response shape", async () => {
    if (!state.nonStreamResponse) return { skip: "no LLM response" };
    const r = state.nonStreamResponse;
    const shape = {};
    for (const [k, v] of Object.entries(r)) shape[k] = Array.isArray(v) ? "array" : typeof v;
    return { detail: JSON.stringify(shape) };
  });

  // ── Summary ────────────────────────────────────────────────────────

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
