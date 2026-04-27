// Live preflight that exercises every vital backend path used by the
// SWE-bench / Terminal-Bench long runs against a real running stack.
//
// Order of steps mirrors `runScenario` in benchmark-api-runner.mjs so a
// failure here means the long benchmark would also fail at the same point:
//
//   1.  GET    /api/auth/session                       -> auth still valid
//   2.  POST   /api/auth/import-access-token           -> session import path
//   3.  GET    /api/orgs                               -> org list
//   4.  POST   /api/orgs                               -> create-or-resolve org
//   5.  POST   /api/agents                             -> agent CRUD
//   6.  POST   /api/projects                           -> import-by-reference
//   7.  POST   /api/projects/:id/agents                -> attach instance
//   8.  POST   /api/projects/:id/agents/:aid/events/stream
//                                                      -> SSE chat / spec gen
//   9.  GET    /api/projects/:id/specs                 -> >= 1 spec
//  10.  POST   /api/projects/:id/tasks/extract         -> >= 1 task
//  11.  POST   /api/projects/:id/loop/start
//        + GET /api/projects/:id/tasks (poll)          -> >= 1 terminal task
//  12.  GET    /api/projects/:id/stats
//        + GET /api/projects/:id/agents/:aid/sessions  -> telemetry surfaces
//
// Cleanup runs in a finally block regardless of failure (project, agent
// instance, agent, integration, org). Each step is timed and emits a
// structured `{ step, status, elapsedMs, details }` record via `onStep`.

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const DEFAULT_LOOP_TIMEOUT_MS = 180_000;
const DEFAULT_POLL_INTERVAL_MS = 4_000;
const DEFAULT_SPEC_STREAM_TIMEOUT_MS = 120_000;
const DEFAULT_PREFLIGHT_ORG_NAME = "Aura Preflight";

const FULL_ACCESS_CAPABILITIES = Object.freeze([
  "spawnAgent",
  "controlAgent",
  "readAgent",
  "listAgents",
  "manageOrgMembers",
  "manageBilling",
  "invokeProcess",
  "postToFeed",
  "generateMedia",
  "readAllProjects",
  "writeAllProjects",
]);

function fullAccessPermissions() {
  return {
    scope: { orgs: [], projects: [], agent_ids: [] },
    capabilities: FULL_ACCESS_CAPABILITIES.map((type) => ({ type })),
  };
}

function authHeaders(accessToken, extra = {}) {
  return {
    Authorization: `Bearer ${accessToken}`,
    ...extra,
  };
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

async function* sseEvents(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    while (true) {
      const lfIdx = buffer.indexOf("\n\n");
      const crlfIdx = buffer.indexOf("\r\n\r\n");
      let sep = -1;
      let sepLen = 0;
      if (lfIdx !== -1 && (crlfIdx === -1 || lfIdx < crlfIdx)) {
        sep = lfIdx;
        sepLen = 2;
      } else if (crlfIdx !== -1) {
        sep = crlfIdx;
        sepLen = 4;
      }
      if (sep === -1) break;
      const frame = buffer.slice(0, sep);
      buffer = buffer.slice(sep + sepLen);
      let eventType = "message";
      const dataLines = [];
      for (const line of frame.split(/\r?\n/)) {
        if (line.startsWith("event:")) {
          eventType = line.slice(6).replace(/^ /, "");
        } else if (line.startsWith("data:")) {
          dataLines.push(line.slice(5).replace(/^ /, ""));
        }
      }
      const dataText = dataLines.length > 0 ? dataLines.join("\n") : null;
      yield { eventType, data: dataText !== null ? safeJsonParse(dataText) : null };
    }
  }
}

class StepFailure extends Error {
  constructor(step, message, details = {}) {
    super(`${step}: ${message}`);
    this.step = step;
    this.details = details;
  }
}

function emit(onStep, record) {
  if (typeof onStep !== "function") return;
  try {
    onStep(record);
  } catch {
    // Listener errors must never break the preflight.
  }
}

async function timedStep(onStep, step, fn) {
  const startedAt = Date.now();
  try {
    const result = await fn();
    const elapsedMs = Date.now() - startedAt;
    emit(onStep, { step, status: "ok", elapsedMs, details: result?.detailsForLog ?? null });
    return result;
  } catch (error) {
    const elapsedMs = Date.now() - startedAt;
    if (error instanceof StepFailure) {
      emit(onStep, {
        step,
        status: "fail",
        elapsedMs,
        error: error.message,
        details: error.details,
      });
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    emit(onStep, { step, status: "fail", elapsedMs, error: message });
    throw new StepFailure(step, message);
  }
}

async function ensureFixtureDir(fixtureDir) {
  if (typeof fixtureDir !== "string" || fixtureDir.length === 0) {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "aura-preflight-"));
    await fs.writeFile(
      path.join(tempRoot, "requirements.md"),
      [
        "# Preflight task",
        "",
        "Create a file named `hello.txt` whose contents are exactly the single line:",
        "",
        "```",
        "hello",
        "```",
        "",
        "Do not modify any other files.",
        "",
      ].join("\n"),
      "utf8",
    );
    await fs.writeFile(
      path.join(tempRoot, "package.json"),
      JSON.stringify(
        {
          name: "aura-preflight-fixture",
          private: true,
          version: "0.0.0",
          scripts: { build: "echo ok", test: "echo ok" },
        },
        null,
        2,
      ),
      "utf8",
    );
    return { fixtureDir: tempRoot, ephemeral: true };
  }
  if (!path.isAbsolute(fixtureDir)) {
    throw new StepFailure(
      "validate_fixture",
      `fixtureDir must be absolute (got ${fixtureDir})`,
    );
  }
  try {
    const stat = await fs.stat(fixtureDir);
    if (!stat.isDirectory()) {
      throw new StepFailure(
        "validate_fixture",
        `fixtureDir is not a directory: ${fixtureDir}`,
      );
    }
  } catch (cause) {
    if (cause instanceof StepFailure) throw cause;
    throw new StepFailure(
      "validate_fixture",
      `fixtureDir is not accessible: ${fixtureDir} (${cause instanceof Error ? cause.message : String(cause)})`,
    );
  }
  return { fixtureDir, ephemeral: false };
}

async function deleteIgnoringMissing(client, endpoint) {
  if (!endpoint) return { ok: true, status: 0, skipped: true };
  try {
    const response = await fetch(`${client.apiBaseUrl}${endpoint}`, {
      method: "DELETE",
      headers: authHeaders(client.accessToken),
    });
    return { ok: response.ok || response.status === 404, status: response.status };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function cleanupCreatedEntities(client, ids, onStep) {
  // Best-effort. We mirror the cleanup order the long-running benchmark uses
  // (integration -> agent_instance -> project -> agent) and treat 404/409 as
  // expected-on-some-stacks (e.g. agent has historical sessions). The org is
  // intentionally left in place even when we created it: the API doesn't
  // expose a DELETE /api/orgs/:id, and reusing "Aura Preflight" across runs
  // is harmless.
  const results = [];
  if (ids.orgId && ids.integrationId) {
    results.push({
      resource: "integration",
      id: ids.integrationId,
      ...(await deleteIgnoringMissing(
        client,
        `/api/orgs/${ids.orgId}/integrations/${ids.integrationId}`,
      )),
    });
  }
  if (ids.projectId && ids.agentInstanceId) {
    results.push({
      resource: "agent_instance",
      id: ids.agentInstanceId,
      ...(await deleteIgnoringMissing(
        client,
        `/api/projects/${ids.projectId}/agents/${ids.agentInstanceId}`,
      )),
    });
  }
  if (ids.projectId) {
    results.push({
      resource: "project",
      id: ids.projectId,
      ...(await deleteIgnoringMissing(client, `/api/projects/${ids.projectId}`)),
    });
  }
  if (ids.agentId) {
    results.push({
      resource: "agent",
      id: ids.agentId,
      ...(await deleteIgnoringMissing(client, `/api/agents/${ids.agentId}`)),
    });
  }
  emit(onStep, {
    step: "cleanup",
    status: "ok",
    elapsedMs: 0,
    details: { results },
  });
  return results;
}

function resolveRuntimeConfig() {
  const adapterType = process.env.AURA_EVAL_AGENT_ADAPTER_TYPE?.trim() || "aura_harness";
  const integrationProvider = process.env.AURA_EVAL_AGENT_INTEGRATION_PROVIDER?.trim() || "";
  return {
    adapterType,
    environment:
      process.env.AURA_EVAL_AGENT_ENVIRONMENT?.trim() || "local_host",
    authSource:
      process.env.AURA_EVAL_AGENT_AUTH_SOURCE?.trim()
      || (integrationProvider ? "org_integration" : "aura_managed"),
    integrationProvider,
    integrationName: process.env.AURA_EVAL_AGENT_INTEGRATION_NAME?.trim() || "",
    defaultModel: process.env.AURA_EVAL_AGENT_DEFAULT_MODEL?.trim() || "",
    apiKey: process.env.AURA_EVAL_AGENT_INTEGRATION_API_KEY?.trim() || "",
    machineType: process.env.AURA_EVAL_AGENT_MACHINE_TYPE?.trim() || "local",
  };
}

export async function runLivePipelinePreflight(options = {}) {
  const { client } = options;
  if (!client || typeof client.apiJson !== "function") {
    throw new Error("runLivePipelinePreflight: options.client is required");
  }
  const onStep = typeof options.onStep === "function" ? options.onStep : null;
  const orgName = options.orgName ?? process.env.AURA_EVAL_PREFLIGHT_ORG_NAME?.trim()
    ?? DEFAULT_PREFLIGHT_ORG_NAME;
  const loopTimeoutMs = Number(
    options.loopTimeoutMs
      ?? process.env.AURA_BENCH_PREFLIGHT_LOOP_TIMEOUT_MS
      ?? DEFAULT_LOOP_TIMEOUT_MS,
  );
  const pollIntervalMs = Number(options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS);
  const specStreamTimeoutMs = Number(
    options.specStreamTimeoutMs
      ?? process.env.AURA_BENCH_PREFLIGHT_SPEC_TIMEOUT_MS
      ?? DEFAULT_SPEC_STREAM_TIMEOUT_MS,
  );

  const { fixtureDir, ephemeral } = await ensureFixtureDir(options.fixtureDir);

  const startedAt = Date.now();
  const ids = {
    orgId: null,
    integrationId: null,
    agentId: null,
    projectId: null,
    agentInstanceId: null,
  };

  emit(onStep, {
    step: "preflight_start",
    status: "ok",
    elapsedMs: 0,
    details: { fixtureDir, ephemeral, loopTimeoutMs, specStreamTimeoutMs },
  });

  try {
    await timedStep(onStep, "auth_session", async () => {
      const session = await client.apiJson("GET", "/api/auth/session");
      if (!session) {
        throw new StepFailure("auth_session", "session response was empty");
      }
      return { detailsForLog: { hasUser: Boolean(session?.user || session?.user_id) } };
    });

    await timedStep(onStep, "auth_import_token", async () => {
      await client.ensureImportedAccessToken();
      return { detailsForLog: null };
    });

    const orgs = await timedStep(onStep, "list_orgs", async () => {
      const list = await client.apiJson("GET", "/api/orgs");
      if (!Array.isArray(list)) {
        throw new StepFailure("list_orgs", "GET /api/orgs did not return an array");
      }
      return { value: list, detailsForLog: { orgCount: list.length } };
    });

    const orgRecord = await timedStep(onStep, "resolve_org", async () => {
      const existing = orgs.value.find((org) => org.name === orgName);
      if (existing) {
        ids.orgId = existing.org_id;
        return {
          value: { ...existing, created: false },
          detailsForLog: { orgId: existing.org_id, created: false },
        };
      }
      const created = await client.apiJson("POST", "/api/orgs", { name: orgName });
      if (!created?.org_id) {
        throw new StepFailure("resolve_org", "POST /api/orgs returned no org_id");
      }
      ids.orgId = created.org_id;
      return {
        value: { ...created, created: true },
        detailsForLog: { orgId: created.org_id, created: true },
      };
    });

    const runtimeConfig = resolveRuntimeConfig();

    if (runtimeConfig.authSource === "org_integration" && runtimeConfig.integrationProvider) {
      await timedStep(onStep, "create_integration", async () => {
        const integration = await client.apiJson(
          "POST",
          `/api/orgs/${orgRecord.value.org_id}/integrations`,
          {
            name:
              runtimeConfig.integrationName
              || `${runtimeConfig.adapterType}-${runtimeConfig.integrationProvider}-preflight`,
            provider: runtimeConfig.integrationProvider,
            default_model: runtimeConfig.defaultModel || null,
            api_key: runtimeConfig.apiKey || null,
          },
        );
        ids.integrationId = integration?.integration_id ?? null;
        return {
          detailsForLog: {
            integrationId: ids.integrationId,
            provider: runtimeConfig.integrationProvider,
          },
        };
      });
    }

    const agent = await timedStep(onStep, "create_agent", async () => {
      const created = await client.apiJson("POST", "/api/agents", {
        org_id: orgRecord.value.org_id,
        name: "Aura-Preflight",
        role: "Engineer",
        personality: "Methodical, careful, preflight-only.",
        system_prompt:
          "You are AURA running a fast preflight task. Make the smallest possible change to satisfy requirements.md.",
        machine_type: runtimeConfig.machineType,
        adapter_type: runtimeConfig.adapterType,
        environment: runtimeConfig.environment,
        auth_source: runtimeConfig.authSource,
        integration_id:
          runtimeConfig.authSource === "org_integration" ? ids.integrationId : null,
        default_model: runtimeConfig.defaultModel || null,
        skills: [],
        icon: null,
        permissions: fullAccessPermissions(),
      });
      if (!created?.agent_id) {
        throw new StepFailure("create_agent", "POST /api/agents returned no agent_id");
      }
      ids.agentId = created.agent_id;
      return { value: created, detailsForLog: { agentId: created.agent_id } };
    });

    const project = await timedStep(onStep, "create_project", async () => {
      const created = await client.apiJson("POST", "/api/projects", {
        org_id: orgRecord.value.org_id,
        name: `Aura Preflight ${Date.now()}`,
        description: "Live preflight project (auto-cleanup).",
        build_command: "echo ok",
        test_command: "echo ok",
        local_workspace_path: fixtureDir,
      });
      if (!created?.project_id) {
        throw new StepFailure(
          "create_project",
          "POST /api/projects returned no project_id",
        );
      }
      ids.projectId = created.project_id;
      return { value: created, detailsForLog: { projectId: created.project_id } };
    });

    const agentInstance = await timedStep(onStep, "attach_agent_instance", async () => {
      const created = await client.apiJson(
        "POST",
        `/api/projects/${project.value.project_id}/agents`,
        { agent_id: agent.value.agent_id },
      );
      if (!created?.agent_instance_id) {
        throw new StepFailure(
          "attach_agent_instance",
          "POST /api/projects/:id/agents returned no agent_instance_id",
        );
      }
      ids.agentInstanceId = created.agent_instance_id;
      return {
        value: created,
        detailsForLog: { agentInstanceId: created.agent_instance_id },
      };
    });

    await timedStep(onStep, "spec_stream", async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), specStreamTimeoutMs);
      let response;
      try {
        response = await fetch(
          `${client.apiBaseUrl}/api/projects/${project.value.project_id}`
            + `/agents/${agentInstance.value.agent_instance_id}/events/stream`,
          {
            method: "POST",
            headers: authHeaders(client.accessToken, {
              Accept: "text/event-stream",
              "Content-Type": "application/json",
            }),
            body: JSON.stringify({
              content: "Generate specs for this project",
              action: "generate_specs",
            }),
            signal: controller.signal,
          },
        );
      } catch (error) {
        clearTimeout(timer);
        const message = error instanceof Error ? error.message : String(error);
        throw new StepFailure(
          "spec_stream",
          `POST /events/stream transport failure: ${message}`,
        );
      }
      if (!response.ok) {
        clearTimeout(timer);
        const body = await response.text().catch(() => "");
        throw new StepFailure(
          "spec_stream",
          `HTTP ${response.status}: ${body.slice(0, 240)}`,
          { hint: response.status === 403
              ? "router/proxy auth likely rejected the chat path; verify aura-router cookie/secret"
              : undefined },
        );
      }
      let streamError = null;
      try {
        for await (const { eventType, data } of sseEvents(response)) {
          if (eventType === "assistant_message_end") break;
          if (eventType === "error") {
            streamError = typeof data?.message === "string" && data.message.length > 0
              ? data.message
              : "spec stream error";
            break;
          }
        }
      } finally {
        clearTimeout(timer);
      }
      if (streamError) {
        throw new StepFailure("spec_stream", streamError);
      }
      return { detailsForLog: null };
    });

    const specs = await timedStep(onStep, "list_specs", async () => {
      const list = await client.apiJson(
        "GET",
        `/api/projects/${project.value.project_id}/specs`,
      );
      const safe = Array.isArray(list) ? list : [];
      if (safe.length === 0) {
        throw new StepFailure(
          "list_specs",
          "spec stream completed but /api/projects/:id/specs returned 0 specs",
        );
      }
      return { value: safe, detailsForLog: { specCount: safe.length } };
    });

    void specs;

    const tasks = await timedStep(onStep, "extract_tasks", async () => {
      const extracted = await client.apiJson(
        "POST",
        `/api/projects/${project.value.project_id}/tasks/extract`
          + `?agent_instance_id=${agentInstance.value.agent_instance_id}`,
      );
      const safe = Array.isArray(extracted) ? extracted : [];
      if (safe.length === 0) {
        throw new StepFailure(
          "extract_tasks",
          "tasks/extract returned 0 tasks; the LLM router/model is likely unhealthy",
        );
      }
      return { value: safe, detailsForLog: { taskCount: safe.length } };
    });

    void tasks;

    await timedStep(onStep, "loop_start", async () => {
      await client.apiJson(
        "POST",
        `/api/projects/${project.value.project_id}/loop/start`
          + `?agent_instance_id=${agentInstance.value.agent_instance_id}`,
      );
      return { detailsForLog: null };
    });

    const loopOutcome = await timedStep(onStep, "loop_progress", async () => {
      const deadline = Date.now() + loopTimeoutMs;
      let lastSeen = null;
      while (Date.now() < deadline) {
        const latest = await client.apiJson(
          "GET",
          `/api/projects/${project.value.project_id}/tasks`,
        );
        lastSeen = Array.isArray(latest) ? latest : [];
        const anyTerminal = lastSeen.some((task) =>
          ["done", "failed", "blocked"].includes(String(task?.status ?? "").toLowerCase()),
        );
        if (anyTerminal) {
          return {
            value: lastSeen,
            detailsForLog: {
              taskCount: lastSeen.length,
              statuses: lastSeen.map((t) => t.status),
            },
          };
        }
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      }
      throw new StepFailure(
        "loop_progress",
        `no task reached a terminal state within ${loopTimeoutMs}ms`,
        {
          hint: "check the harness adapter logs (AURA_STACK_LOG_DIR/harness.log)",
          lastStatuses: (lastSeen ?? []).map((t) => t?.status),
        },
      );
    });

    void loopOutcome;

    await timedStep(onStep, "stats_and_sessions", async () => {
      const [stats, sessions] = await Promise.all([
        client.apiJson("GET", `/api/projects/${project.value.project_id}/stats`),
        client.apiJson(
          "GET",
          `/api/projects/${project.value.project_id}`
            + `/agents/${agentInstance.value.agent_instance_id}/sessions`,
        ),
      ]);
      const sessionList = Array.isArray(sessions) ? sessions : [];
      return {
        detailsForLog: {
          totalTokens: Number(stats?.total_tokens ?? 0),
          sessionCount: sessionList.length,
        },
      };
    });

    const totalElapsedMs = Date.now() - startedAt;
    emit(onStep, {
      step: "preflight_complete",
      status: "ok",
      elapsedMs: totalElapsedMs,
      details: { fixtureDir, ephemeral },
    });
    return { ok: true, totalElapsedMs };
  } finally {
    await cleanupCreatedEntities(client, ids, onStep);
    if (ephemeral) {
      await fs.rm(fixtureDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}
