import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const interfaceRoot = path.resolve(currentDir, "..");
const scenariosPath = path.join(interfaceRoot, "tests/e2e/evals/scenarios/live-benchmark.json");
const fixturesDir = path.join(interfaceRoot, "tests/e2e/evals/fixtures");
const resultsDir = path.join(interfaceRoot, "test-results");

const apiBaseUrl = process.env.AURA_EVAL_API_BASE_URL?.trim()
  || process.env.AURA_EVAL_BASE_URL?.trim()
  || "http://127.0.0.1:3190";
const storageUrl = process.env.AURA_EVAL_STORAGE_URL?.trim() || "";
const accessToken = process.env.AURA_EVAL_ACCESS_TOKEN?.trim() || "";
const keepEntities = process.env.AURA_EVAL_KEEP_ENTITIES === "1";
const orgName = process.env.AURA_EVAL_ORG_NAME ?? "Aura Evaluations";
const verbose = process.env.AURA_EVAL_VERBOSE === "1";

if (!accessToken) {
  throw new Error("Set AURA_EVAL_ACCESS_TOKEN before running the API benchmark.");
}

const grepPattern = process.argv[2]?.trim() || "";

function authHeaders(extra = {}) {
  return {
    Authorization: `Bearer ${accessToken}`,
    ...extra,
  };
}

function logStep(message, details) {
  if (!verbose) return;
  if (details === undefined) {
    process.stderr.write(`[api-benchmark] ${message}\n`);
    return;
  }
  process.stderr.write(`[api-benchmark] ${message} ${JSON.stringify(details)}\n`);
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

async function storageJson(sessionId) {
  if (!storageUrl) return [];
  const response = await fetch(`${storageUrl}/api/sessions/${sessionId}/events`, {
    headers: authHeaders(),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`GET storage session events failed with ${response.status}: ${text}`);
  }
  return text ? JSON.parse(text) : [];
}

async function walkFixtureDir(dir, root = dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const absolutePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walkFixtureDir(absolutePath, root));
      continue;
    }

    const contents = await fs.readFile(absolutePath);
    files.push({
      relative_path: path.relative(root, absolutePath),
      contents_base64: contents.toString("base64"),
    });
  }

  files.sort((left, right) => left.relative_path.localeCompare(right.relative_path));
  return files;
}

function sumBuildAndTestSteps(outputs) {
  return Object.values(outputs).reduce(
    (summary, output) => ({
      buildSteps: summary.buildSteps + (output.build_steps?.length ?? 0),
      testSteps: summary.testSteps + (output.test_steps?.length ?? 0),
    }),
    { buildSteps: 0, testSteps: 0 },
  );
}

function sumSessionTokens(sessions) {
  return sessions.reduce(
    (summary, session) => ({
      input: summary.input + Number(session.total_input_tokens ?? 0),
      output: summary.output + Number(session.total_output_tokens ?? 0),
    }),
    { input: 0, output: 0 },
  );
}

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function readUsagePayload(content) {
  const outer = asRecord(content);
  if (!outer) return null;
  return asRecord(outer.usage) ?? outer;
}

function countFilesChanged(content) {
  const outer = asRecord(content);
  if (!outer) return 0;
  const filesChanged = outer.files_changed ?? outer.filesChanged;
  if (Array.isArray(filesChanged)) return filesChanged.length;
  const grouped = asRecord(filesChanged);
  if (!grouped) return 0;
  return ["created", "modified", "deleted"].reduce((count, key) => {
    const value = grouped[key];
    return count + (Array.isArray(value) ? value.length : 0);
  }, 0);
}

function matchesExpectedText(content, expected) {
  if (content.includes(expected)) return true;
  const squashWhitespace = (value) => value.replace(/\s+/g, "");
  return squashWhitespace(content).includes(squashWhitespace(expected));
}

function summarizeSessionUsage(events) {
  const summaries = {
    assistant_message_end: [],
    token_usage: [],
  };

  for (const event of events) {
    const eventType = event.event_type ?? event.eventType ?? event.type ?? "";
    if (!(eventType in summaries)) continue;
    const usage = readUsagePayload(event.content);
    if (!usage) continue;
    if (typeof usage.input_tokens !== "number" || typeof usage.output_tokens !== "number") {
      continue;
    }
    summaries[eventType].push({
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      cacheCreationInputTokens: Number(usage.cache_creation_input_tokens ?? 0),
      cacheReadInputTokens: Number(usage.cache_read_input_tokens ?? 0),
      estimatedContextTokens: Number(usage.estimated_context_tokens ?? 0),
      contextUtilization: Number(usage.context_utilization ?? 0),
      model: typeof usage.model === "string" ? usage.model : null,
      provider: typeof usage.provider === "string" ? usage.provider : null,
      fileChangeCount: countFilesChanged(event.content),
    });
  }

  const source = summaries.assistant_message_end.length > 0
    ? "assistant_message_end"
    : summaries.token_usage.length > 0
      ? "token_usage"
      : "none";
  const entries = source === "assistant_message_end"
    ? summaries.assistant_message_end
    : source === "token_usage"
      ? summaries.token_usage
      : [];

  const models = new Set();
  const providers = new Set();

  const total = entries.reduce((acc, entry) => {
    if (entry.model) models.add(entry.model);
    if (entry.provider) providers.add(entry.provider);
    acc.turnCount += 1;
    acc.inputTokens += entry.inputTokens;
    acc.outputTokens += entry.outputTokens;
    acc.cacheCreationInputTokens += entry.cacheCreationInputTokens;
    acc.cacheReadInputTokens += entry.cacheReadInputTokens;
    acc.promptInputFootprintTokens +=
      entry.inputTokens + entry.cacheCreationInputTokens + entry.cacheReadInputTokens;
    acc.maxEstimatedContextTokens = Math.max(
      acc.maxEstimatedContextTokens,
      entry.estimatedContextTokens,
    );
    acc.maxContextUtilization = Math.max(
      acc.maxContextUtilization,
      entry.contextUtilization,
    );
    acc.fileChangeCount += entry.fileChangeCount;
    return acc;
  }, {
    turnCount: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    promptInputFootprintTokens: 0,
    maxEstimatedContextTokens: 0,
    maxContextUtilization: 0,
    fileChangeCount: 0,
  });

  return {
    source,
    ...total,
    models: Array.from(models).sort(),
    providers: Array.from(providers).sort(),
  };
}

async function resolveEvalOrg() {
  const orgs = await apiJson("GET", "/api/orgs");
  const existing = orgs.find((org) => org.name === orgName);
  if (existing) return { ...existing, created: false };
  const created = await apiJson("POST", "/api/orgs", { name: orgName });
  return { ...created, created: true };
}

async function pollForLoopCompletion(projectId, timeoutMs, pollIntervalMs) {
  const deadline = Date.now() + timeoutMs;
  let latestTasks = [];

  while (Date.now() < deadline) {
    latestTasks = await apiJson("GET", `/api/projects/${projectId}/tasks`);
    const allTerminal = latestTasks.length > 0
      && latestTasks.every((task) => ["done", "failed", "blocked"].includes(task.status));
    if (allTerminal) return latestTasks;
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  throw new Error(`Timed out waiting for tasks in project ${projectId}`);
}

async function collectTaskOutputs(projectId, tasks) {
  const outputs = await Promise.all(tasks.map(async (task) => {
    const output = await apiJson("GET", `/api/projects/${projectId}/tasks/${task.task_id}/output`);
    return [task.task_id, output];
  }));
  return Object.fromEntries(outputs);
}

async function readArtifactFile(rootPath, relativePath) {
  return apiJson("POST", "/api/read-file", {
    path: path.join(rootPath, relativePath),
  });
}

async function verifyArtifactFiles(rootPath, checks) {
  const results = [];
  for (const check of checks ?? []) {
    const response = await readArtifactFile(rootPath, check.path);
    if (!response.ok) {
      throw new Error(`Expected ${check.path} to be readable: ${response.error ?? "unknown error"}`);
    }
    const content = response.content ?? "";
    for (const text of check.mustContain) {
      if (!matchesExpectedText(content, text)) {
        throw new Error(`Artifact ${check.path} did not contain expected text: ${text}`);
      }
    }
    results.push({
      path: check.path,
      ok: response.ok,
      matchedTexts: check.mustContain,
    });
  }
  return results;
}

async function cleanupEntity(resource, id, endpoint) {
  if (!id) return { resource, id: "", ok: true, skipped: true };
  const response = await fetch(`${apiBaseUrl}${endpoint}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  return {
    resource,
    id,
    ok: response.ok || response.status === 404,
    status: response.status,
  };
}

async function cleanupEntities(ids) {
  const results = [];
  results.push(await cleanupEntity(
    "agent_instance",
    ids.agentInstanceId,
    ids.projectId && ids.agentInstanceId
      ? `/api/projects/${ids.projectId}/agents/${ids.agentInstanceId}`
      : "",
  ));
  results.push(await cleanupEntity(
    "project",
    ids.projectId,
    ids.projectId ? `/api/projects/${ids.projectId}` : "",
  ));
  results.push(await cleanupEntity(
    "agent",
    ids.agentId,
    ids.agentId ? `/api/agents/${ids.agentId}` : "",
  ));
  return results;
}

async function runScenario(scenario) {
  const startedAt = Date.now();
  const runId = `${scenario.id}-${Date.now()}`;
  const projectName = `${scenario.project.name} ${runId}`;
  const operationLog = [];

  let org = null;
  let agent = null;
  let project = null;
  let agentInstance = null;
  let specs = [];
  let tasks = [];
  let completedTasks = [];
  let outputs = {};
  let projectStats = {};
  let sessions = [];
  let richUsageSummary = null;
  let artifactChecks = [];

  try {
    const files = await walkFixtureDir(path.join(fixturesDir, scenario.project.fixtureDir));
    logStep("fixture prepared", { scenarioId: scenario.id, fileCount: files.length });

    org = await resolveEvalOrg();
    logStep("org resolved", { orgId: org.org_id, created: org.created });
    operationLog.push({ step: "resolve_org", summary: org.created ? "Created org" : "Reused org" });

    agent = await apiJson("POST", "/api/agents", {
      name: scenario.agentTemplate.name,
      role: scenario.agentTemplate.role,
      personality: scenario.agentTemplate.personality,
      system_prompt: scenario.agentTemplate.systemPrompt,
      machine_type: process.env.AURA_EVAL_AGENT_MACHINE_TYPE ?? scenario.agentTemplate.machineType ?? "local",
      skills: [],
      icon: null,
    });
    logStep("agent created", { agentId: agent.agent_id });
    operationLog.push({ step: "create_agent", summary: `Created agent ${agent.agent_id}` });

    logStep("creating project", { projectName });
    project = await apiJson("POST", "/api/projects/import", {
      org_id: org.org_id,
      name: projectName,
      description: scenario.project.description,
      files,
      build_command: scenario.project.buildCommand,
      test_command: scenario.project.testCommand,
    });
    logStep("project created", { projectId: project.project_id });
    operationLog.push({ step: "create_project", summary: `Imported project ${project.project_id}` });

    agentInstance = await apiJson("POST", `/api/projects/${project.project_id}/agents`, {
      agent_id: agent.agent_id,
    });
    logStep("agent attached", { agentInstanceId: agentInstance.agent_instance_id });
    operationLog.push({
      step: "create_agent_instance",
      summary: `Attached agent instance ${agentInstance.agent_instance_id}`,
    });

    specs = await apiJson(
      "POST",
      `/api/projects/${project.project_id}/specs/generate?agent_instance_id=${agentInstance.agent_instance_id}`,
    );
    logStep("specs generated", { count: specs.length });
    operationLog.push({ step: "create_spec", summary: `Generated ${specs.length} specs` });

    tasks = await apiJson(
      "POST",
      `/api/projects/${project.project_id}/tasks/extract?agent_instance_id=${agentInstance.agent_instance_id}`,
    );
    logStep("tasks extracted", { count: tasks.length });
    operationLog.push({ step: "create_tasks", summary: `Extracted ${tasks.length} tasks` });

    await apiJson(
      "POST",
      `/api/projects/${project.project_id}/loop/start?agent_instance_id=${agentInstance.agent_instance_id}`,
    );
    logStep("loop started", { projectId: project.project_id });
    operationLog.push({ step: "build_app", summary: "Started autonomous loop" });

    completedTasks = await pollForLoopCompletion(
      project.project_id,
      scenario.timeouts.loopCompletionMs,
      scenario.timeouts.pollIntervalMs,
    );
    logStep("loop completed", {
      done: completedTasks.filter((task) => task.status === "done").length,
      failed: completedTasks.filter((task) => task.status === "failed").length,
    });
    operationLog.push({ step: "wait_for_completion", summary: "Loop reached terminal state" });

    outputs = await collectTaskOutputs(project.project_id, completedTasks);
    projectStats = await apiJson("GET", `/api/projects/${project.project_id}/stats`);
    sessions = await apiJson(
      "GET",
      `/api/projects/${project.project_id}/agents/${agentInstance.agent_instance_id}/sessions`,
    );

    if (storageUrl) {
      logStep("collecting rich usage", { sessionCount: sessions.length });
      const perSession = await Promise.all(sessions.map(async (session) => {
        const summary = summarizeSessionUsage(await storageJson(session.session_id));
        return { sessionId: session.session_id, ...summary };
      }));
      const models = new Set();
      const providers = new Set();
      richUsageSummary = perSession.reduce((acc, session) => {
        if (session.source === "assistant_message_end") {
          acc.richUsageSessions += 1;
          acc.richUsageTurns += session.turnCount;
        } else if (session.source === "token_usage") {
          acc.fallbackUsageSessions += 1;
          acc.fallbackUsageTurns += session.turnCount;
        }
        acc.totalInputTokens += session.inputTokens;
        acc.totalOutputTokens += session.outputTokens;
        acc.totalCacheCreationInputTokens += session.cacheCreationInputTokens;
        acc.totalCacheReadInputTokens += session.cacheReadInputTokens;
        acc.promptInputFootprintTokens += session.promptInputFootprintTokens;
        acc.maxEstimatedContextTokens = Math.max(acc.maxEstimatedContextTokens, session.maxEstimatedContextTokens);
        acc.maxContextUtilization = Math.max(acc.maxContextUtilization, session.maxContextUtilization);
        acc.fileChangeCount += session.fileChangeCount;
        session.models.forEach((model) => models.add(model));
        session.providers.forEach((provider) => providers.add(provider));
        return acc;
      }, {
        richUsageSessions: 0,
        fallbackUsageSessions: 0,
        richUsageTurns: 0,
        fallbackUsageTurns: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalCacheCreationInputTokens: 0,
        totalCacheReadInputTokens: 0,
        promptInputFootprintTokens: 0,
        maxEstimatedContextTokens: 0,
        maxContextUtilization: 0,
        fileChangeCount: 0,
      });
      richUsageSummary.models = Array.from(models).sort();
      richUsageSummary.providers = Array.from(providers).sort();
      richUsageSummary.sessionBreakdown = perSession;
    }

    if (agentInstance.workspace_path?.trim()) {
      logStep("verifying artifacts", { workspacePath: agentInstance.workspace_path });
      artifactChecks = await verifyArtifactFiles(
        agentInstance.workspace_path.trim(),
        scenario.project.artifactChecks,
      );
    }

    const stepSummary = sumBuildAndTestSteps(outputs);
    const tokenSummary = sumSessionTokens(sessions);
    const doneTasks = completedTasks.filter((task) => task.status === "done");
    const failedTasks = completedTasks.filter((task) => task.status === "failed");

    if (scenario.verification.requireAnyDoneTasks && doneTasks.length === 0) {
      throw new Error("Benchmark finished without any done tasks");
    }
    if (scenario.verification.requireNoFailedTasks && failedTasks.length > 0) {
      throw new Error(`Benchmark had failed tasks: ${failedTasks.map((task) => task.title).join(", ")}`);
    }

    const cleanup = keepEntities
      ? { enabled: false, results: [] }
      : { enabled: true, results: await cleanupEntities({
          projectId: project.project_id,
          agentId: agent.agent_id,
          agentInstanceId: agentInstance.agent_instance_id,
        }) };

    const payload = {
      scenarioId: scenario.id,
      title: scenario.title,
      suite: scenario.suite,
      kind: scenario.kind,
      device: "api-local",
      bundleId: process.env.AURA_EVAL_BUNDLE_ID ?? "api-local",
      runId,
      story: scenario.story,
      canonicalPrompts: scenario.canonicalPrompts,
      operationLog,
      entities: {
        orgId: org.org_id,
        agentId: agent.agent_id,
        projectId: project.project_id,
        agentInstanceId: agentInstance.agent_instance_id,
        workspacePath: agentInstance.workspace_path ?? null,
      },
      counts: {
        specs: specs.length,
        tasks: tasks.length,
        doneTasks: doneTasks.length,
        failedTasks: failedTasks.length,
        artifactChecks: artifactChecks.length,
      },
      metrics: {
        totalDurationMs: Date.now() - startedAt,
        totalInputTokens: tokenSummary.input,
        totalOutputTokens: tokenSummary.output,
        totalTokens: Number(projectStats.total_tokens ?? tokenSummary.input + tokenSummary.output),
        estimatedCostUsd: Number(projectStats.estimated_cost_usd ?? 0),
        totalCacheCreationInputTokens: richUsageSummary?.totalCacheCreationInputTokens ?? 0,
        totalCacheReadInputTokens: richUsageSummary?.totalCacheReadInputTokens ?? 0,
        promptInputFootprintTokens: richUsageSummary?.promptInputFootprintTokens ?? tokenSummary.input,
        maxEstimatedContextTokens: richUsageSummary?.maxEstimatedContextTokens ?? 0,
        maxContextUtilization: richUsageSummary?.maxContextUtilization ?? Math.max(
          ...sessions.map((session) => Number(session.context_usage_estimate ?? 0)),
          0,
        ),
        richUsageTurns: richUsageSummary?.richUsageTurns ?? 0,
        fallbackUsageTurns: richUsageSummary?.fallbackUsageTurns ?? 0,
        richUsageSessions: richUsageSummary?.richUsageSessions ?? 0,
        fallbackUsageSessions: richUsageSummary?.fallbackUsageSessions ?? 0,
        fileChangeCount: richUsageSummary?.fileChangeCount ?? 0,
        buildSteps: stepSummary.buildSteps,
        testSteps: stepSummary.testSteps,
        artifactVerificationPassed: artifactChecks.length,
      },
      projectStats,
      richUsageSummary,
      artifactChecks,
      cleanup,
      taskStatuses: completedTasks.map((task) => ({
        taskId: task.task_id,
        title: task.title,
        status: task.status,
        totalInputTokens: task.total_input_tokens,
        totalOutputTokens: task.total_output_tokens,
      })),
      taskOutputs: outputs,
    };

    await fs.mkdir(resultsDir, { recursive: true });
    const outputPath = path.join(resultsDir, `${scenario.id}.api-benchmark.json`);
    await fs.writeFile(outputPath, JSON.stringify(payload, null, 2), "utf8");
    logStep("scenario complete", { outputPath });
    return outputPath;
  } catch (error) {
    logStep("scenario failed", {
      scenarioId: scenario.id,
      error: error instanceof Error ? error.message : String(error),
    });
    if (!keepEntities) {
      await cleanupEntities({
        projectId: project?.project_id,
        agentId: agent?.agent_id,
        agentInstanceId: agentInstance?.agent_instance_id,
      }).catch(() => {});
    }
    throw error;
  }
}

async function main() {
  const scenarios = JSON.parse(await fs.readFile(scenariosPath, "utf8"));
  const selected = scenarios.filter((scenario) => {
    if (!grepPattern) return true;
    const haystack = `${scenario.id} ${scenario.title}`.toLowerCase();
    return haystack.includes(grepPattern.toLowerCase());
  });

  if (selected.length === 0) {
    throw new Error(`No benchmark scenarios matched "${grepPattern}"`);
  }

  for (const scenario of selected) {
    const outputPath = await runScenario(scenario);
    process.stdout.write(`${path.relative(interfaceRoot, outputPath)}\n`);
  }
}

await main();
