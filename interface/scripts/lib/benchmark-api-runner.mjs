import { promises as fs } from "node:fs";
import path from "node:path";

const DEFAULT_IGNORE_PATTERNS = Object.freeze([
  ".git/**",
  "node_modules/**",
  "__pycache__/**",
  ".venv/**",
  "*.pyc",
  ".pytest_cache/**",
]);

function authHeaders(accessToken, extra = {}) {
  return {
    Authorization: `Bearer ${accessToken}`,
    ...extra,
  };
}

export function createBenchmarkClient(options = {}) {
  const apiBaseUrl = typeof options.apiBaseUrl === "string" ? options.apiBaseUrl.trim() : "";
  const accessToken = typeof options.accessToken === "string" ? options.accessToken.trim() : "";
  const storageUrl = typeof options.storageUrl === "string" ? options.storageUrl.trim() : "";
  const verbose = options.verbose === true;

  if (!apiBaseUrl) {
    throw new Error("createBenchmarkClient: apiBaseUrl is required");
  }
  if (!accessToken) {
    throw new Error("createBenchmarkClient: accessToken is required");
  }

  const client = {
    apiBaseUrl,
    accessToken,
    storageUrl,
    verbose,

    logStep(message, details) {
      if (!this.verbose) return;
      if (details === undefined) {
        process.stderr.write(`[api-benchmark] ${message}\n`);
        return;
      }
      process.stderr.write(`[api-benchmark] ${message} ${JSON.stringify(details)}\n`);
    },

    async apiJson(method, endpoint, body) {
      const response = await fetch(`${this.apiBaseUrl}${endpoint}`, {
        method,
        headers: authHeaders(
          this.accessToken,
          body == null ? {} : { "Content-Type": "application/json" },
        ),
        body: body == null ? undefined : JSON.stringify(body),
      });
      const text = await response.text();
      if (!response.ok) {
        throw new Error(`${method} ${endpoint} failed with ${response.status}: ${text}`);
      }
      return text ? JSON.parse(text) : null;
    },

    async ensureImportedAccessToken() {
      const response = await fetch(`${this.apiBaseUrl}/api/auth/import-access-token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ access_token: this.accessToken }),
      });

      if (response.ok) {
        this.logStep("access token imported", { apiBaseUrl: this.apiBaseUrl });
        return;
      }

      if ([403, 404, 405].includes(response.status)) {
        this.logStep("access token import skipped", { status: response.status });
        return;
      }

      const text = await response.text();
      throw new Error(
        `POST /api/auth/import-access-token failed with ${response.status}: ${text}`,
      );
    },

    async storageJson(sessionId) {
      if (!this.storageUrl) return [];
      const response = await fetch(`${this.storageUrl}/api/sessions/${sessionId}/events`, {
        headers: authHeaders(this.accessToken),
      });
      const text = await response.text();
      if (!response.ok) {
        throw new Error(`GET storage session events failed with ${response.status}: ${text}`);
      }
      return text ? JSON.parse(text) : [];
    },

    async cleanupEntity(resource, id, endpoint) {
      if (!id) return { resource, id: "", ok: true, skipped: true };
      const response = await fetch(`${this.apiBaseUrl}${endpoint}`, {
        method: "DELETE",
        headers: authHeaders(this.accessToken),
      });
      return {
        resource,
        id,
        ok: response.ok || response.status === 404,
        status: response.status,
      };
    },

    async cleanupEntities(ids) {
      const results = [];
      results.push(await this.cleanupEntity(
        "integration",
        ids.integrationId,
        ids.orgId && ids.integrationId
          ? `/api/orgs/${ids.orgId}/integrations/${ids.integrationId}`
          : "",
      ));
      results.push(await this.cleanupEntity(
        "agent_instance",
        ids.agentInstanceId,
        ids.projectId && ids.agentInstanceId
          ? `/api/projects/${ids.projectId}/agents/${ids.agentInstanceId}`
          : "",
      ));
      results.push(await this.cleanupEntity(
        "project",
        ids.projectId,
        ids.projectId ? `/api/projects/${ids.projectId}` : "",
      ));
      results.push(await this.cleanupEntity(
        "agent",
        ids.agentId,
        ids.agentId ? `/api/agents/${ids.agentId}` : "",
      ));
      return results;
    },
  };

  return client;
}

function escapeRegexChar(ch) {
  return /[.+(){}^$|\\[\]]/.test(ch) ? `\\${ch}` : ch;
}

function globToRegex(pattern) {
  let regexStr = "^";
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i];
    if (ch === "*") {
      if (pattern[i + 1] === "*") {
        if (pattern[i + 2] === "/") {
          regexStr += "(?:.*/)?";
          i += 3;
          continue;
        }
        regexStr += ".*";
        i += 2;
        continue;
      }
      regexStr += "[^/]*";
      i += 1;
      continue;
    }
    if (ch === "?") {
      regexStr += "[^/]";
      i += 1;
      continue;
    }
    regexStr += escapeRegexChar(ch);
    i += 1;
  }
  regexStr += "$";
  return new RegExp(regexStr);
}

function compileIgnoreMatchers(patterns) {
  return patterns.map((pattern) => {
    const regex = globToRegex(pattern);
    const dirGlob = pattern.endsWith("/**") ? pattern.slice(0, -3) : null;
    return { pattern, regex, dirGlob };
  });
}

function toPosix(value) {
  return value.replaceAll("\\", "/");
}

function shouldIgnoreFile(relativePosix, matchers) {
  for (const matcher of matchers) {
    if (matcher.regex.test(relativePosix)) return true;
  }
  return false;
}

function shouldIgnoreDirectory(relativePosix, matchers) {
  for (const matcher of matchers) {
    if (matcher.dirGlob && matcher.dirGlob === relativePosix) return true;
    if (matcher.regex.test(`${relativePosix}/.placeholder`)) return true;
  }
  return false;
}

export async function walkFixtureDir(absoluteDir, options = {}) {
  if (typeof absoluteDir !== "string" || !absoluteDir) {
    throw new Error("walkFixtureDir: absoluteDir is required");
  }
  if (!path.isAbsolute(absoluteDir)) {
    throw new Error(`walkFixtureDir: absoluteDir must be absolute (got ${absoluteDir})`);
  }

  const ignorePatterns = [
    ...DEFAULT_IGNORE_PATTERNS,
    ...(Array.isArray(options.ignore) ? options.ignore : []),
  ];
  const matchers = compileIgnoreMatchers(ignorePatterns);
  const files = [];

  async function walk(currentDir) {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(currentDir, entry.name);
      const relativePath = path.relative(absoluteDir, absolutePath);
      const relativePosix = toPosix(relativePath);

      if (entry.isDirectory()) {
        if (shouldIgnoreDirectory(relativePosix, matchers)) continue;
        await walk(absolutePath);
        continue;
      }

      if (!entry.isFile()) continue;
      if (shouldIgnoreFile(relativePosix, matchers)) continue;

      const contents = await fs.readFile(absolutePath);
      files.push({
        relative_path: relativePath,
        contents_base64: contents.toString("base64"),
      });
    }
  }

  await walk(absoluteDir);
  files.sort((left, right) => left.relative_path.localeCompare(right.relative_path));
  return files;
}

export function sumBuildAndTestSteps(outputs) {
  return Object.values(outputs).reduce(
    (summary, output) => ({
      buildSteps: summary.buildSteps + (output.build_steps?.length ?? 0),
      testSteps: summary.testSteps + (output.test_steps?.length ?? 0),
    }),
    { buildSteps: 0, testSteps: 0 },
  );
}

export function sumSessionTokens(sessions) {
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

function readNumber(record, keys) {
  for (const key of keys) {
    if (typeof record[key] === "number" && Number.isFinite(record[key])) {
      return record[key];
    }
  }
  return null;
}

export function countFilesChanged(content) {
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

export function matchesExpectedText(content, expected) {
  if (content.includes(expected)) return true;
  const squashWhitespace = (value) => value.replace(/\s+/g, "");
  return squashWhitespace(content).includes(squashWhitespace(expected));
}

export function summarizeSessionUsage(events) {
  const summaries = {
    assistant_message_end: [],
    token_usage: [],
  };

  for (const event of events) {
    const eventType = event.event_type ?? event.eventType ?? event.type ?? "";
    if (!(eventType in summaries)) continue;
    const usage = readUsagePayload(event.content);
    if (!usage) continue;
    const inputTokens = readNumber(usage, ["input_tokens", "inputTokens", "prompt_tokens"]);
    const outputTokens = readNumber(usage, [
      "output_tokens",
      "outputTokens",
      "completion_tokens",
    ]);
    if (inputTokens == null || outputTokens == null) {
      continue;
    }
    summaries[eventType].push({
      inputTokens,
      outputTokens,
      cacheCreationInputTokens: Number(
        readNumber(usage, [
          "cache_creation_input_tokens",
          "cacheCreationInputTokens",
          "prompt_cache_miss_tokens",
        ]) ?? 0,
      ),
      cacheReadInputTokens: Number(
        readNumber(usage, [
          "cache_read_input_tokens",
          "cacheReadInputTokens",
          "prompt_cache_hit_tokens",
        ]) ?? 0,
      ),
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

function resolveAgentRuntimeConfig(scenario) {
  const template = scenario.agentTemplate ?? {};
  const adapterType =
    process.env.AURA_EVAL_AGENT_ADAPTER_TYPE?.trim()
    || template.adapterType
    || "aura_harness";
  const integrationProvider =
    process.env.AURA_EVAL_AGENT_INTEGRATION_PROVIDER?.trim()
    || template.integrationProvider
    || "";

  return {
    adapterType,
    environment:
      process.env.AURA_EVAL_AGENT_ENVIRONMENT?.trim()
      || template.environment
      || (template.machineType === "remote" ? "swarm_microvm" : "local_host"),
    authSource:
      process.env.AURA_EVAL_AGENT_AUTH_SOURCE?.trim()
      || template.authSource
      || (integrationProvider ? "org_integration" : "aura_managed"),
    integrationProvider,
    integrationName:
      process.env.AURA_EVAL_AGENT_INTEGRATION_NAME?.trim()
      || template.integrationName
      || "",
    defaultModel:
      process.env.AURA_EVAL_AGENT_DEFAULT_MODEL?.trim()
      || template.defaultModel
      || "",
    apiKey:
      process.env.AURA_EVAL_AGENT_INTEGRATION_API_KEY?.trim()
      || "",
  };
}

async function resolveEvalOrg(client, orgName) {
  const orgs = await client.apiJson("GET", "/api/orgs");
  const existing = orgs.find((org) => org.name === orgName);
  if (existing) return { ...existing, created: false };
  const created = await client.apiJson("POST", "/api/orgs", { name: orgName });
  return { ...created, created: true };
}

async function createEvalIntegration(client, orgId, runtimeConfig) {
  if (runtimeConfig.authSource !== "org_integration" || !runtimeConfig.integrationProvider) {
    return null;
  }

  const payload = {
    name:
      runtimeConfig.integrationName
      || `${runtimeConfig.adapterType}-${runtimeConfig.integrationProvider}-eval`,
    provider: runtimeConfig.integrationProvider,
    default_model: runtimeConfig.defaultModel || null,
    api_key: runtimeConfig.apiKey || null,
  };

  return client.apiJson("POST", `/api/orgs/${orgId}/integrations`, payload);
}

async function pollForLoopCompletion(client, projectId, timeoutMs, pollIntervalMs) {
  const deadline = Date.now() + timeoutMs;
  let latestTasks = [];

  while (Date.now() < deadline) {
    latestTasks = await client.apiJson("GET", `/api/projects/${projectId}/tasks`);
    const allTerminal = latestTasks.length > 0
      && latestTasks.every((task) => ["done", "failed", "blocked"].includes(task.status));
    if (allTerminal) return latestTasks;
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  throw new Error(`Timed out waiting for tasks in project ${projectId}`);
}

async function collectTaskOutputs(client, projectId, tasks) {
  const outputs = await Promise.all(tasks.map(async (task) => {
    const output = await client.apiJson(
      "GET",
      `/api/projects/${projectId}/tasks/${task.task_id}/output`,
    );
    return [task.task_id, output];
  }));
  return Object.fromEntries(outputs);
}

async function readArtifactFile(client, rootPath, relativePath) {
  return client.apiJson("POST", "/api/read-file", {
    path: path.join(rootPath, relativePath),
  });
}

async function verifyArtifactFiles(client, rootPath, checks) {
  const results = [];
  for (const check of checks ?? []) {
    const response = await readArtifactFile(client, rootPath, check.path);
    if (!response.ok) {
      throw new Error(
        `Expected ${check.path} to be readable: ${response.error ?? "unknown error"}`,
      );
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

function resolveFixturePath(scenario, fixturesDir) {
  const explicit = scenario.project?.fixtureAbsolutePath;
  if (typeof explicit === "string" && explicit.length > 0) {
    if (!path.isAbsolute(explicit)) {
      throw new Error(
        `runScenario: scenario.project.fixtureAbsolutePath must be absolute (got ${explicit})`,
      );
    }
    return explicit;
  }
  if (!fixturesDir) {
    throw new Error(
      "runScenario: fixturesDir is required when scenario.project.fixtureAbsolutePath is not set",
    );
  }
  if (!scenario.project?.fixtureDir) {
    throw new Error(
      "runScenario: scenario.project.fixtureDir is required when fixtureAbsolutePath is not set",
    );
  }
  return path.join(fixturesDir, scenario.project.fixtureDir);
}

export async function runScenario(scenario, options) {
  if (!options || typeof options !== "object") {
    throw new Error("runScenario: options.client is required");
  }
  const { client } = options;
  if (!client || typeof client.apiJson !== "function") {
    throw new Error("runScenario: options.client is required");
  }

  const fixturesDir = options.fixturesDir ?? null;
  const keepEntities = options.keepEntities ?? (process.env.AURA_EVAL_KEEP_ENTITIES === "1");
  const orgName = options.orgName ?? (process.env.AURA_EVAL_ORG_NAME ?? "Aura Evaluations");
  const bundleId = options.bundleId ?? (process.env.AURA_EVAL_BUNDLE_ID ?? "api-local");
  const device = options.device ?? "api-local";
  const onProgress = typeof options.onProgress === "function" ? options.onProgress : null;
  const fixtureIgnore = options.fixtureIgnore;

  const startedAt = Date.now();
  const runId = `${scenario.id}-${Date.now()}`;
  const projectName = `${scenario.project.name} ${runId}`;
  const operationLog = [];

  const recordStep = (step, summary, details) => {
    operationLog.push({ step, summary });
    if (onProgress) {
      try {
        onProgress(details === undefined ? { step, summary } : { step, summary, details });
      } catch {
        // Ignore listener errors so they cannot break the pipeline.
      }
    }
  };

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
  let integration = null;

  try {
    await client.ensureImportedAccessToken();

    const fixturePath = resolveFixturePath(scenario, fixturesDir);
    const files = await walkFixtureDir(fixturePath, {
      ignore: Array.isArray(fixtureIgnore) ? fixtureIgnore : undefined,
    });
    client.logStep("fixture prepared", {
      scenarioId: scenario.id,
      fileCount: files.length,
      fixturePath,
    });

    org = await resolveEvalOrg(client, orgName);
    client.logStep("org resolved", { orgId: org.org_id, created: org.created });
    recordStep(
      "resolve_org",
      org.created ? "Created org" : "Reused org",
      { orgId: org.org_id, created: org.created },
    );

    const runtimeConfig = resolveAgentRuntimeConfig(scenario);
    integration = await createEvalIntegration(client, org.org_id, runtimeConfig);
    if (integration) {
      client.logStep("integration created", {
        integrationId: integration.integration_id,
        provider: integration.provider,
      });
      recordStep(
        "create_integration",
        `Created org integration ${integration.integration_id}`,
        { integrationId: integration.integration_id, provider: integration.provider },
      );
    }

    agent = await client.apiJson("POST", "/api/agents", {
      org_id: org.org_id,
      name: scenario.agentTemplate.name,
      role: scenario.agentTemplate.role,
      personality: scenario.agentTemplate.personality,
      system_prompt: scenario.agentTemplate.systemPrompt,
      machine_type:
        process.env.AURA_EVAL_AGENT_MACHINE_TYPE
        ?? scenario.agentTemplate.machineType
        ?? "local",
      adapter_type: runtimeConfig.adapterType,
      environment: runtimeConfig.environment,
      auth_source: runtimeConfig.authSource,
      integration_id:
        runtimeConfig.authSource === "org_integration"
          ? (integration?.integration_id ?? null)
          : null,
      default_model: runtimeConfig.defaultModel || null,
      skills: [],
      icon: null,
    });
    client.logStep("agent created", { agentId: agent.agent_id });
    recordStep("create_agent", `Created agent ${agent.agent_id}`, { agentId: agent.agent_id });

    client.logStep("creating project", { projectName });
    project = await client.apiJson("POST", "/api/projects/import", {
      org_id: org.org_id,
      name: projectName,
      description: scenario.project.description,
      files,
      build_command: scenario.project.buildCommand,
      test_command: scenario.project.testCommand,
    });
    client.logStep("project created", { projectId: project.project_id });
    recordStep(
      "create_project",
      `Imported project ${project.project_id}`,
      { projectId: project.project_id, fileCount: files.length },
    );

    agentInstance = await client.apiJson(
      "POST",
      `/api/projects/${project.project_id}/agents`,
      { agent_id: agent.agent_id },
    );
    client.logStep("agent attached", { agentInstanceId: agentInstance.agent_instance_id });
    recordStep(
      "create_agent_instance",
      `Attached agent instance ${agentInstance.agent_instance_id}`,
      { agentInstanceId: agentInstance.agent_instance_id },
    );

    specs = await client.apiJson(
      "POST",
      `/api/projects/${project.project_id}/specs/generate?agent_instance_id=${agentInstance.agent_instance_id}`,
    );
    client.logStep("specs generated", { count: specs.length });
    recordStep("create_spec", `Generated ${specs.length} specs`, { count: specs.length });

    tasks = await client.apiJson(
      "POST",
      `/api/projects/${project.project_id}/tasks/extract?agent_instance_id=${agentInstance.agent_instance_id}`,
    );
    client.logStep("tasks extracted", { count: tasks.length });
    recordStep("create_tasks", `Extracted ${tasks.length} tasks`, { count: tasks.length });

    await client.apiJson(
      "POST",
      `/api/projects/${project.project_id}/loop/start?agent_instance_id=${agentInstance.agent_instance_id}`,
    );
    client.logStep("loop started", { projectId: project.project_id });
    recordStep("build_app", "Started autonomous loop", { projectId: project.project_id });

    completedTasks = await pollForLoopCompletion(
      client,
      project.project_id,
      scenario.timeouts.loopCompletionMs,
      scenario.timeouts.pollIntervalMs,
    );
    const doneCount = completedTasks.filter((task) => task.status === "done").length;
    const failedCount = completedTasks.filter((task) => task.status === "failed").length;
    client.logStep("loop completed", { done: doneCount, failed: failedCount });
    recordStep(
      "wait_for_completion",
      "Loop reached terminal state",
      { done: doneCount, failed: failedCount },
    );

    outputs = await collectTaskOutputs(client, project.project_id, completedTasks);
    projectStats = await client.apiJson("GET", `/api/projects/${project.project_id}/stats`);
    sessions = await client.apiJson(
      "GET",
      `/api/projects/${project.project_id}/agents/${agentInstance.agent_instance_id}/sessions`,
    );

    if (client.storageUrl) {
      client.logStep("collecting rich usage", { sessionCount: sessions.length });
      const perSession = await Promise.all(sessions.map(async (session) => {
        const summary = summarizeSessionUsage(await client.storageJson(session.session_id));
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
        acc.maxEstimatedContextTokens = Math.max(
          acc.maxEstimatedContextTokens,
          session.maxEstimatedContextTokens,
        );
        acc.maxContextUtilization = Math.max(
          acc.maxContextUtilization,
          session.maxContextUtilization,
        );
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
      client.logStep("verifying artifacts", { workspacePath: agentInstance.workspace_path });
      artifactChecks = await verifyArtifactFiles(
        client,
        agentInstance.workspace_path.trim(),
        scenario.project.artifactChecks,
      );
    }

    const stepSummary = sumBuildAndTestSteps(outputs);
    const tokenSummary = sumSessionTokens(sessions);
    const doneTasks = completedTasks.filter((task) => task.status === "done");
    const failedTasks = completedTasks.filter((task) => task.status === "failed");

    const verification = scenario.verification ?? {};
    if (verification.requireAnyDoneTasks && doneTasks.length === 0) {
      throw new Error("Benchmark finished without any done tasks");
    }
    if (verification.requireNoFailedTasks && failedTasks.length > 0) {
      throw new Error(
        `Benchmark had failed tasks: ${failedTasks.map((task) => task.title).join(", ")}`,
      );
    }
    if (verification.requireBuildSteps && stepSummary.buildSteps === 0) {
      throw new Error("Benchmark finished without any build steps recorded");
    }
    if (verification.requireTestSteps && stepSummary.testSteps === 0) {
      throw new Error("Benchmark finished without any test steps recorded");
    }

    const cleanup = keepEntities
      ? { enabled: false, results: [] }
      : {
        enabled: true,
        results: await client.cleanupEntities({
          projectId: project.project_id,
          agentId: agent.agent_id,
          agentInstanceId: agentInstance.agent_instance_id,
          orgId: org.org_id,
          integrationId: integration?.integration_id ?? null,
        }),
      };

    return {
      scenarioId: scenario.id,
      title: scenario.title,
      suite: scenario.suite,
      kind: scenario.kind,
      device,
      bundleId,
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
        totalTokens: Number(
          projectStats.total_tokens ?? tokenSummary.input + tokenSummary.output,
        ),
        estimatedCostUsd: Number(projectStats.estimated_cost_usd ?? 0),
        totalCacheCreationInputTokens: richUsageSummary?.totalCacheCreationInputTokens ?? 0,
        totalCacheReadInputTokens: richUsageSummary?.totalCacheReadInputTokens ?? 0,
        promptInputFootprintTokens:
          richUsageSummary?.promptInputFootprintTokens ?? tokenSummary.input,
        maxEstimatedContextTokens: richUsageSummary?.maxEstimatedContextTokens ?? 0,
        maxContextUtilization:
          richUsageSummary?.maxContextUtilization
          ?? Math.max(
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
  } catch (error) {
    client.logStep("scenario failed", {
      scenarioId: scenario.id,
      error: error instanceof Error ? error.message : String(error),
    });
    if (!keepEntities) {
      await client.cleanupEntities({
        projectId: project?.project_id,
        agentId: agent?.agent_id,
        agentInstanceId: agentInstance?.agent_instance_id,
      }).catch(() => {});
    }
    throw error;
  }
}
