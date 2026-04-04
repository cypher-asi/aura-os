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

if (!accessToken) {
  throw new Error("Set AURA_EVAL_ACCESS_TOKEN before running the runtime adapter eval.");
}

const adapterType = process.env.AURA_RUNTIME_EVAL_ADAPTER?.trim() || "aura_harness";
const environment = process.env.AURA_RUNTIME_EVAL_ENVIRONMENT?.trim()
  || (adapterType === "aura_harness" ? "local_host" : "local_host");
const defaultModel = process.env.AURA_RUNTIME_EVAL_MODEL?.trim() || "";
const prompt = process.env.AURA_RUNTIME_EVAL_PROMPT?.trim()
  || "Reply with exactly `hello from runtime eval` and stop.";
const runChatValidation = process.env.AURA_RUNTIME_EVAL_CHAT === "1"
  || ["codex", "claude_code"].includes(adapterType);
const chatTimeoutMs = Number.parseInt(process.env.AURA_RUNTIME_EVAL_CHAT_TIMEOUT_MS ?? "45000", 10);

function inferProvider() {
  if (adapterType === "claude_code") return "anthropic";
  if (adapterType === "codex") return "openai";
  return "";
}

const requestedAuthSource = process.env.AURA_RUNTIME_EVAL_AUTH_SOURCE?.trim() || "";
const authSource = requestedAuthSource
  || (adapterType === "aura_harness" ? "aura_managed" : "local_cli_auth");
const integrationProvider = authSource === "org_integration"
  ? (process.env.AURA_RUNTIME_EVAL_PROVIDER?.trim() || inferProvider())
  : (process.env.AURA_RUNTIME_EVAL_PROVIDER?.trim() || "");
const integrationName = process.env.AURA_RUNTIME_EVAL_INTEGRATION_NAME?.trim()
  || (authSource === "org_integration" && integrationProvider
    ? `${adapterType}-${integrationProvider}-runtime-eval`
    : "");
const apiKey = process.env.AURA_RUNTIME_EVAL_API_KEY?.trim() || "";

function authHeaders(extra = {}) {
  return {
    Authorization: `Bearer ${accessToken}`,
    ...extra,
  };
}

function logStep(message, details) {
  if (!verbose) return;
  process.stderr.write(`[runtime-eval] ${message}`);
  if (details !== undefined) {
    process.stderr.write(` ${JSON.stringify(details)}`);
  }
  process.stderr.write("\n");
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

async function maybeCreateIntegration(orgId) {
  if (authSource !== "org_integration" || !integrationProvider) return null;
  return apiJson("POST", `/api/orgs/${orgId}/integrations`, {
    name: integrationName,
    provider: integrationProvider,
    default_model: defaultModel || null,
    api_key: apiKey || null,
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

async function cleanupAgent(agentId) {
  if (!agentId) return null;

  let detachedBindings = [];
  try {
    const bindings = await apiJson("GET", `/api/agents/${agentId}/projects`);
    detachedBindings = await Promise.all(
      (bindings ?? []).map((binding) =>
        cleanupEntity("DELETE", `/api/agents/${agentId}/projects/${binding.project_agent_id}`),
      ),
    );
  } catch (error) {
    detachedBindings = [{
      endpoint: `/api/agents/${agentId}/projects`,
      ok: false,
      status: 500,
      error: error instanceof Error ? error.message : String(error),
    }];
  }

  const deleted = await cleanupEntity("DELETE", `/api/agents/${agentId}`);
  return { detachedBindings, deleted };
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
      const dataLines = frame
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .filter(Boolean);
      for (const line of dataLines) {
        try {
          const parsed = JSON.parse(line);
          events.push(parsed);
          if (parsed.type === "text_delta" && typeof parsed.text === "string") {
            assembledText += parsed.text;
          }
        } catch {
          // ignore malformed frames
        }
      }
    }
  }

  return { text: assembledText.trim(), events };
}

async function runChat(agentId) {
  const controller = new AbortController();
  const timer = Number.isFinite(chatTimeoutMs) && chatTimeoutMs > 0
    ? setTimeout(() => controller.abort(), chatTimeoutMs)
    : null;

  try {
    const response = await fetch(`${apiBaseUrl}/api/agents/${agentId}/events/stream`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ content: prompt }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const text = await response.text();
      return {
        ok: false,
        status: response.status,
        error: text,
        text: "",
        events: [],
      };
    }

    const sse = await readSse(response);
    const endEvent = sse.events.findLast?.((event) => event.type === "assistant_message_end")
      ?? [...sse.events].reverse().find((event) => event.type === "assistant_message_end");

    return {
      ok: Boolean(endEvent),
      status: response.status,
      text: sse.text,
      events: sse.events,
      usage: endEvent?.usage ?? null,
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return {
        ok: false,
        status: 408,
        error: `chat stream timed out after ${chatTimeoutMs}ms`,
        text: "",
        events: [],
      };
    }
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function main() {
  const startedAt = Date.now();
  const artifact = {
    suite: "runtime-adapter-eval",
    adapterType,
    environment,
    authSource,
    defaultModel: defaultModel || null,
    apiBaseUrl,
    startedAt: new Date(startedAt).toISOString(),
  };

  let org = null;
  let integration = null;
  let agent = null;

  try {
    await ensureImportedAccessToken();
    org = await resolveEvalOrg();
    integration = await maybeCreateIntegration(org.org_id);

    agent = await apiJson("POST", "/api/agents", {
      org_id: org.org_id,
      name: `Runtime Eval ${adapterType}`,
      role: "Engineer",
      personality: "Concise and reliable.",
      system_prompt: "Reply exactly as requested and stop when the request is complete.",
      machine_type: environment === "swarm_microvm" ? "remote" : "local",
      adapter_type: adapterType,
      environment,
      auth_source: authSource,
      integration_id: authSource === "org_integration" ? (integration?.integration_id ?? null) : null,
      default_model: defaultModel || null,
      skills: [],
      icon: null,
    });

    logStep("agent created", { agentId: agent.agent_id, adapterType });

    const runtimeTest = await apiJson("POST", `/api/agents/${agent.agent_id}/runtime/test`);
    const chatRun = runChatValidation
      ? await runChat(agent.agent_id)
      : {
          ok: true,
          skipped: true,
          reason: "runtime_test_only_for_aura_harness",
          text: runtimeTest.message ?? "",
          events: [],
          usage: null,
        };

    const payload = {
      ...artifact,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      success: Boolean(runtimeTest?.ok) && Boolean(chatRun?.ok),
      org,
      integration,
      agent,
      runtimeTest,
      chatRun,
    };

    await fs.mkdir(resultsDir, { recursive: true });
    const outputPath = path.join(resultsDir, `${adapterType}-runtime-eval.json`);
    await fs.writeFile(outputPath, JSON.stringify(payload, null, 2), "utf8");

    if (!keepEntities) {
      payload.cleanup = {
        agent: await cleanupAgent(agent.agent_id),
        integration: integration
          ? await cleanupEntity("DELETE", `/api/orgs/${org.org_id}/integrations/${integration.integration_id}`)
          : null,
      };
      await fs.writeFile(outputPath, JSON.stringify(payload, null, 2), "utf8");
    }

    process.stdout.write(`${outputPath}\n`);
    if (!payload.success) {
      process.exitCode = 1;
    }
  } catch (error) {
    const payload = {
      ...artifact,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      success: false,
      org,
      integration,
      agent,
      error: error instanceof Error ? error.message : String(error),
    };
    await fs.mkdir(resultsDir, { recursive: true });
    const outputPath = path.join(resultsDir, `${adapterType}-runtime-eval.json`);
    await fs.writeFile(outputPath, JSON.stringify(payload, null, 2), "utf8");
    process.stdout.write(`${outputPath}\n`);
    process.exitCode = 1;
  }
}

await main();
