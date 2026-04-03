import { expect, type AriaRole, type Locator, type Page, type TestInfo } from "@playwright/test";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { aggregateUsageSummaries, summarizeSessionUsage, type RawStorageSessionEvent } from "../../../src/lib/benchmark-usage";
import { mockAuthenticatedApp } from "../helpers/mockAuthenticatedApp";

type DeviceName =
  | "eval-desktop-chromium"
  | "eval-mobile-chromium"
  | "eval-mobile-webkit"
  | "eval-live-desktop";

interface RoleTarget {
  role: AriaRole;
  name?: string;
  exact?: boolean;
}

interface RoleValueExpectation extends RoleTarget {
  value: string;
}

interface BrowserStepAction {
  clickRole?: RoleTarget;
}

interface BrowserStepExpectation {
  urlMatches?: string;
  visibleTexts?: string[];
  visibleRoles?: RoleTarget[];
  hiddenRoles?: RoleTarget[];
  roleValues?: RoleValueExpectation[];
}

interface BrowserScenarioStep {
  label: string;
  navigate?: string;
  action?: BrowserStepAction;
  expect?: BrowserStepExpectation;
}

interface BrowserScenario {
  id: string;
  suite: "smoke";
  kind: "browser_core";
  title: string;
  devices: DeviceName[];
  bootstrap: "guest" | "mock_authenticated_app";
  steps: BrowserScenarioStep[];
}

export interface WorkflowE2EScenario {
  id: string;
  suite: "workflow";
  kind: "deterministic_lifecycle";
  title: string;
  devices: DeviceName[];
  fixtureDir: string;
  org: {
    name: string;
  };
  agentTemplate: {
    name: string;
    role: string;
    personality: string;
    systemPrompt: string;
  };
  project: {
    name: string;
    description: string;
    buildCommand: string;
    testCommand: string;
  };
  generatedSpec: {
    title: string;
  };
  extractedTasks: Array<{
    title: string;
    description: string;
  }>;
  verification: {
    statsTexts: string[];
    taskOutputContains: string[];
  };
}

interface BenchmarkArtifactCheck {
  path: string;
  mustContain: string[];
}

interface BenchmarkAgentTemplate {
  name: string;
  role: string;
  personality: string;
  systemPrompt: string;
  machineType?: string;
}

interface BenchmarkProjectFixture {
  name: string;
  description: string;
  fixtureDir: string;
  buildCommand: string;
  testCommand: string;
  artifactChecks?: BenchmarkArtifactCheck[];
}

interface BenchmarkTimeouts {
  loginMs: number;
  loopCompletionMs: number;
  pollIntervalMs: number;
}

interface BenchmarkVerification {
  requireNoFailedTasks: boolean;
  requireAnyDoneTasks: boolean;
  requireBuildSteps: boolean;
  requireTestSteps: boolean;
  statsTexts: string[];
}

export interface LiveBenchmarkScenario {
  id: string;
  suite: "benchmark";
  kind: "live_pipeline";
  title: string;
  devices: DeviceName[];
  story: {
    actor: string;
    goal: string;
    benefit: string;
  };
  canonicalPrompts: string[];
  agentTemplate: BenchmarkAgentTemplate;
  project: BenchmarkProjectFixture;
  timeouts: BenchmarkTimeouts;
  verification: BenchmarkVerification;
}

interface ImportedProjectFilePayload {
  relative_path: string;
  contents_base64: string;
}

interface RunStepResult {
  label: string;
  durationMs: number;
}

interface BenchmarkTask {
  task_id: string;
  title: string;
  status: string;
  total_input_tokens: number;
  total_output_tokens: number;
}

interface BenchmarkSession {
  session_id: string;
  total_input_tokens: number;
  total_output_tokens: number;
  context_usage_estimate?: number;
  model?: string;
  status?: string;
}

interface RichSessionUsageSummary {
  richUsageSessions: number;
  fallbackUsageSessions: number;
  richUsageTurns: number;
  fallbackUsageTurns: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheCreationInputTokens: number;
  totalCacheReadInputTokens: number;
  promptInputFootprintTokens: number;
  maxEstimatedContextTokens: number;
  maxContextUtilization: number;
  fileChangeCount: number;
  models: string[];
  providers: string[];
  sessionBreakdown: Array<{
    sessionId: string;
    source: "assistant_message_end" | "token_usage" | "none";
    turnCount: number;
    inputTokens: number;
    outputTokens: number;
    cacheCreationInputTokens: number;
    cacheReadInputTokens: number;
    maxEstimatedContextTokens: number;
    maxContextUtilization: number;
  }>;
}

interface BenchmarkTaskOutput {
  output: string;
  build_steps?: unknown[];
  test_steps?: unknown[];
}

interface ImportedProject {
  project_id: string;
}

interface ImportedAgentInstance {
  agent_instance_id: string;
  workspace_path?: string | null;
}

interface BenchmarkOrg {
  org_id: string;
  name: string;
}

interface FileReadResponse {
  ok: boolean;
  path?: string;
  content?: string;
  error?: string;
}

interface CleanupResult {
  resource: string;
  id: string;
  ok: boolean;
  status: number | null;
  skipped?: boolean;
  message?: string;
}

interface BenchmarkOrgResolution extends BenchmarkOrg {
  created: boolean;
}

interface EvalAuthSession {
  access_token?: string;
  [key: string]: unknown;
}

interface BenchmarkOperationLogEntry {
  step: string;
  summary: string;
  durationMs?: number;
  details?: Record<string, unknown>;
}

const demoModeEnabled = process.env.AURA_EVAL_DEMO_MODE === "1";
const demoStepDelayMs = Number(process.env.AURA_EVAL_DEMO_STEP_DELAY_MS ?? 1200);

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const scenariosDir = path.join(currentDir, "scenarios");
const fixturesDir = path.join(currentDir, "fixtures");

async function readJsonFile<T>(filePath: string): Promise<T> {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw) as T;
}

export async function loadBrowserScenarios(): Promise<BrowserScenario[]> {
  return readJsonFile<BrowserScenario[]>(path.join(scenariosDir, "core-browser-smoke.json"));
}

export async function loadLiveBenchmarkScenarios(): Promise<LiveBenchmarkScenario[]> {
  return readJsonFile<LiveBenchmarkScenario[]>(path.join(scenariosDir, "live-benchmark.json"));
}

export async function loadWorkflowE2EScenarios(): Promise<WorkflowE2EScenario[]> {
  return readJsonFile<WorkflowE2EScenario[]>(path.join(scenariosDir, "workflow-e2e.json"));
}

export async function bootstrapScenarioPage(page: Page, scenario: BrowserScenario) {
  if (scenario.bootstrap === "mock_authenticated_app") {
    await mockAuthenticatedApp(page);
    return;
  }

  await page.route("**/api/auth/session", async (route) => {
    await route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ error: "Unauthorized", code: "unauthorized", details: null }),
    });
  });

  await page.route("**/api/auth/validate", async (route) => {
    await route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ error: "Unauthorized", code: "unauthorized", details: null }),
    });
  });
}

function roleLocator(page: Page, target: RoleTarget): Locator {
  return page.getByRole(target.role, {
    name: target.name,
    exact: target.exact,
  }).first();
}

async function executeAction(page: Page, action?: BrowserStepAction) {
  if (!action) return;
  if (action.clickRole) {
    await roleLocator(page, action.clickRole).click();
  }
}

async function assertExpectations(page: Page, expectation?: BrowserStepExpectation) {
  if (!expectation) return;

  if (expectation.urlMatches) {
    await expect(page).toHaveURL(new RegExp(expectation.urlMatches));
  }

  for (const text of expectation.visibleTexts ?? []) {
    await expect(page.getByText(text, { exact: true }).first()).toBeVisible();
  }

  for (const target of expectation.visibleRoles ?? []) {
    await expect(roleLocator(page, target)).toBeVisible();
  }

  for (const target of expectation.hiddenRoles ?? []) {
    await expect(roleLocator(page, target)).toHaveCount(0);
  }

  for (const target of expectation.roleValues ?? []) {
    await expect(roleLocator(page, target)).toHaveValue(target.value);
  }
}

export async function runBrowserScenario(
  page: Page,
  scenario: BrowserScenario,
): Promise<RunStepResult[]> {
  const steps: RunStepResult[] = [];

  for (const step of scenario.steps) {
    const startedAt = Date.now();
    if (step.navigate) {
      await page.goto(step.navigate);
    }
    await executeAction(page, step.action);
    await assertExpectations(page, step.expect);
    steps.push({
      label: step.label,
      durationMs: Date.now() - startedAt,
    });
  }

  return steps;
}

export function scenarioSupportsDevice(devices: DeviceName[], projectName: string): boolean {
  return devices.includes(projectName as DeviceName);
}

export async function writeEvalArtifacts(
  page: Page,
  testInfo: TestInfo,
  name: string,
  payload: unknown,
) {
  const summaryPath = testInfo.outputPath(`${name}.json`);
  await fs.writeFile(summaryPath, JSON.stringify(payload, null, 2), "utf8");
  await testInfo.attach(`${name}.json`, {
    path: summaryPath,
    contentType: "application/json",
  });

  const benchmarkLog = formatBenchmarkRunLog(payload);
  if (benchmarkLog) {
    const logPath = testInfo.outputPath(`${name}.log.txt`);
    await fs.writeFile(logPath, benchmarkLog, "utf8");
    await testInfo.attach(`${name}.log.txt`, {
      path: logPath,
      contentType: "text/plain",
    });
  }

  const screenshotPath = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  await testInfo.attach(`${name}.png`, {
    path: screenshotPath,
    contentType: "image/png",
  });
}

async function apiRequest(
  page: Page,
  method: "GET" | "POST" | "DELETE",
  url: string,
  body?: unknown,
) {
  const jwt = await page.evaluate(() => window.localStorage.getItem("aura-jwt"));
  const headers = jwt ? { Authorization: `Bearer ${jwt}` } : undefined;

  if (method === "GET") {
    return page.request.get(url, { headers });
  }
  if (method === "DELETE") {
    return page.request.delete(url, { headers });
  }
  return page.request.post(url, { data: body, headers });
}

async function apiJson<T>(
  page: Page,
  method: "GET" | "POST" | "DELETE",
  url: string,
  body?: unknown,
): Promise<T> {
  const response = await apiRequest(page, method, url, body);
  const text = await response.text();
  if (!response.ok()) {
    throw new Error(`${method} ${url} failed with ${response.status()}: ${text}`);
  }
  if (!text) {
    return undefined as T;
  }
  return JSON.parse(text) as T;
}

async function authedAbsoluteJson<T>(
  page: Page,
  method: "GET" | "POST" | "DELETE",
  url: string,
  body?: unknown,
): Promise<T> {
  const jwt = await page.evaluate(() => window.localStorage.getItem("aura-jwt"));
  const headers = jwt ? { Authorization: `Bearer ${jwt}` } : undefined;

  let response;
  if (method === "GET") {
    response = await page.request.get(url, { headers });
  } else if (method === "DELETE") {
    response = await page.request.delete(url, { headers });
  } else {
    response = await page.request.post(url, { data: body, headers });
  }

  const text = await response.text();
  if (!response.ok()) {
    throw new Error(`${method} ${url} failed with ${response.status()}: ${text}`);
  }
  if (!text) {
    return undefined as T;
  }
  return JSON.parse(text) as T;
}

async function maybePauseForDemo(page: Page, milliseconds = demoStepDelayMs) {
  if (!demoModeEnabled || milliseconds <= 0) return;
  await page.waitForTimeout(milliseconds);
}

async function maybeShowDemoPage(page: Page, url: string, milliseconds?: number) {
  if (!demoModeEnabled) return;
  await page.goto(url);
  await maybePauseForDemo(page, milliseconds);
}

async function deleteResource(
  page: Page,
  resource: string,
  id: string | null | undefined,
  url: string,
): Promise<CleanupResult> {
  if (!id) {
    return {
      resource,
      id: "",
      ok: true,
      status: null,
      skipped: true,
      message: "not created",
    };
  }

  const response = await apiRequest(page, "DELETE", url);
  const text = await response.text();
  return {
    resource,
    id,
    ok: response.ok() || response.status() === 404,
    status: response.status(),
    message: text || undefined,
  };
}

export async function loginForLiveEval(
  page: Page,
  email: string,
  password: string,
  timeoutMs: number,
) {
  await page.goto("/login");
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder("Password").fill(password);
  await page.locator("form").getByRole("button", { name: "Sign In" }).click();
  await expect
    .poll(async () => {
      const response = await apiRequest(page, "GET", "/api/auth/session");
      return response.ok();
    }, { timeout: timeoutMs })
    .toBe(true);
}

export async function importAccessTokenForLiveEval(
  page: Page,
  accessToken: string,
  timeoutMs: number,
) {
  await page.goto("/login");
  const session = await apiJson<EvalAuthSession>(page, "POST", "/api/auth/import-access-token", {
    access_token: accessToken,
  });
  await page.evaluate((value) => {
    if (value?.access_token) {
      window.localStorage.setItem("aura-jwt", value.access_token);
      window.localStorage.setItem("aura-session", JSON.stringify(value));
    }
  }, session);
  await expect
    .poll(async () => {
      const response = await apiRequest(page, "GET", "/api/auth/session");
      return response.ok();
    }, { timeout: timeoutMs })
    .toBe(true);
}

async function walkFixtureDir(dir: string, rootDir = dir): Promise<ImportedProjectFilePayload[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: ImportedProjectFilePayload[] = [];

  for (const entry of entries) {
    const absolutePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walkFixtureDir(absolutePath, rootDir));
      continue;
    }

    const contents = await fs.readFile(absolutePath);
    files.push({
      relative_path: path.relative(rootDir, absolutePath),
      contents_base64: contents.toString("base64"),
    });
  }

  files.sort((left, right) => left.relative_path.localeCompare(right.relative_path));
  return files;
}

export async function collectFixtureFiles(fixtureDir: string): Promise<ImportedProjectFilePayload[]> {
  return walkFixtureDir(path.join(fixturesDir, fixtureDir));
}

async function pollForLoopCompletion(
  page: Page,
  projectId: string,
  timeoutMs: number,
  pollIntervalMs: number,
): Promise<BenchmarkTask[]> {
  const deadline = Date.now() + timeoutMs;
  let latestTasks: BenchmarkTask[] = [];

  while (Date.now() < deadline) {
    latestTasks = await apiJson<BenchmarkTask[]>(page, "GET", `/api/projects/${projectId}/tasks`);
    const allTerminal = latestTasks.length > 0
      && latestTasks.every((task) => ["done", "failed", "blocked"].includes(task.status));
    if (allTerminal) {
      return latestTasks;
    }
    await page.waitForTimeout(pollIntervalMs);
  }

  throw new Error(`Timed out waiting for tasks in project ${projectId} to reach a terminal state`);
}

async function collectTaskOutputs(page: Page, projectId: string, tasks: BenchmarkTask[]) {
  const outputs = await Promise.all(tasks.map(async (task) => {
    const output = await apiJson<BenchmarkTaskOutput>(
      page,
      "GET",
      `/api/projects/${projectId}/tasks/${task.task_id}/output`,
    );
    return [task.task_id, output] as const;
  }));

  return Object.fromEntries(outputs);
}

async function verifyArtifactFiles(
  page: Page,
  rootPath: string,
  checks: BenchmarkArtifactCheck[] | undefined,
  options?: {
    machineType?: string;
    remoteAgentId?: string;
  },
) {
  const results = [];
  const matchesExpectedText = (content: string, expected: string) => {
    if (content.includes(expected)) return true;
    const squashWhitespace = (value: string) => value.replace(/\s+/g, "");
    return squashWhitespace(content).includes(squashWhitespace(expected));
  };

  for (const check of checks ?? []) {
    const response = await readArtifactFile(
      page,
      rootPath,
      check.path,
      options?.machineType,
      options?.remoteAgentId,
    );

    expect(response.ok, `Expected ${check.path} to be readable`).toBe(true);
    const content = response.content ?? "";
    for (const text of check.mustContain) {
      expect(
        matchesExpectedText(content, text),
        `Expected ${check.path} to contain ${text}`,
      ).toBe(true);
    }

    results.push({
      path: check.path,
      ok: response.ok,
      matchedTexts: check.mustContain,
    });
  }

  return results;
}

async function readArtifactFile(
  page: Page,
  rootPath: string,
  relativePath: string,
  machineType?: string,
  remoteAgentId?: string,
) {
  if (machineType === "remote" && remoteAgentId) {
    const remoteCandidates = [
      path.posix.join("/state/workspaces/default", relativePath),
      path.posix.join("/workspace", relativePath),
      relativePath,
    ];

    let lastResponse: FileReadResponse | null = null;
    for (const candidate of remoteCandidates) {
      const response = await apiJson<FileReadResponse>(
        page,
        "POST",
        `/api/agents/${remoteAgentId}/remote_agent/read-file`,
        { path: candidate },
      );
      if (response.ok) {
        return response;
      }
      lastResponse = response;
    }

    return lastResponse ?? { ok: false, content: null, path: relativePath };
  }

  return apiJson<FileReadResponse>(page, "POST", "/api/read-file", {
    path: path.join(rootPath, relativePath),
  });
}

function sumBuildAndTestSteps(outputs: Record<string, BenchmarkTaskOutput>) {
  return Object.values(outputs).reduce(
    (summary, output) => ({
      buildSteps: summary.buildSteps + (output.build_steps?.length ?? 0),
      testSteps: summary.testSteps + (output.test_steps?.length ?? 0),
    }),
    { buildSteps: 0, testSteps: 0 },
  );
}

function sumSessionTokens(sessions: BenchmarkSession[]) {
  return sessions.reduce(
    (summary, session) => ({
      input: summary.input + session.total_input_tokens,
      output: summary.output + session.total_output_tokens,
    }),
    { input: 0, output: 0 },
  );
}

async function collectRichSessionUsage(
  page: Page,
  sessions: BenchmarkSession[],
): Promise<RichSessionUsageSummary | null> {
  const storageUrl = process.env.AURA_EVAL_STORAGE_URL?.trim();
  if (!storageUrl) {
    return null;
  }

  const summaries = await Promise.all(sessions.map(async (session) => {
    const events = await authedAbsoluteJson<RawStorageSessionEvent[]>(
      page,
      "GET",
      `${storageUrl}/api/sessions/${session.session_id}/events`,
    );
    const summary = summarizeSessionUsage(events);
    return {
      summary,
      sessionBreakdown: {
        sessionId: session.session_id,
        source: summary.source,
        turnCount: summary.turnCount,
        inputTokens: summary.inputTokens,
        outputTokens: summary.outputTokens,
        cacheCreationInputTokens: summary.cacheCreationInputTokens,
        cacheReadInputTokens: summary.cacheReadInputTokens,
        maxEstimatedContextTokens: summary.maxEstimatedContextTokens,
        maxContextUtilization: summary.maxContextUtilization,
      },
    };
  }));

  const aggregate = aggregateUsageSummaries(summaries.map((entry) => entry.summary));

  return {
    richUsageSessions: aggregate.richUsageSessions,
    fallbackUsageSessions: aggregate.fallbackUsageSessions,
    richUsageTurns: aggregate.richUsageTurns,
    fallbackUsageTurns: aggregate.fallbackUsageTurns,
    totalInputTokens: aggregate.inputTokens,
    totalOutputTokens: aggregate.outputTokens,
    totalCacheCreationInputTokens: aggregate.cacheCreationInputTokens,
    totalCacheReadInputTokens: aggregate.cacheReadInputTokens,
    promptInputFootprintTokens: aggregate.promptInputFootprintTokens,
    maxEstimatedContextTokens: aggregate.maxEstimatedContextTokens,
    maxContextUtilization: aggregate.maxContextUtilization,
    fileChangeCount: aggregate.fileChangeCount,
    models: aggregate.models,
    providers: aggregate.providers,
    sessionBreakdown: summaries.map((entry) => entry.sessionBreakdown),
  };
}

async function timedStep<T>(
  results: RunStepResult[],
  label: string,
  action: () => Promise<T>,
): Promise<T> {
  const startedAt = Date.now();
  const value = await action();
  results.push({
    label,
    durationMs: Date.now() - startedAt,
  });
  return value;
}

function latestStepDuration(results: RunStepResult[]): number {
  return results[results.length - 1]?.durationMs ?? 0;
}

function collectSpecTitles(specs: unknown[]): string[] {
  return specs.flatMap((spec) => {
    if (!spec || typeof spec !== "object") return [];
    const title = (spec as { title?: unknown }).title;
    return typeof title === "string" && title.trim() ? [title] : [];
  });
}

function collectCleanupSummary(results: CleanupResult[]) {
  const removedCounts = results.reduce<Record<string, number>>((summary, result) => {
    if (result.ok && !result.skipped) {
      summary[result.resource] = (summary[result.resource] ?? 0) + 1;
    }
    return summary;
  }, {});

  const failures = results
    .filter((result) => !result.ok)
    .map((result) => `${result.resource}:${result.status ?? "unknown"}`);

  return { removedCounts, failures };
}

function formatMetricValue(value: number | undefined, decimals = 0): string {
  if (value == null || Number.isNaN(value)) return "n/a";
  return value.toFixed(decimals);
}

function formatBenchmarkRunLog(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const benchmark = payload as {
    title?: string;
    scenarioId?: string;
    runId?: string;
    story?: { actor?: string; goal?: string; benefit?: string };
    canonicalPrompts?: string[];
    operationLog?: BenchmarkOperationLogEntry[];
    metrics?: {
      totalDurationMs?: number;
      totalInputTokens?: number;
      totalOutputTokens?: number;
      totalTokens?: number;
      estimatedCostUsd?: number;
      totalCacheCreationInputTokens?: number;
      totalCacheReadInputTokens?: number;
      promptInputFootprintTokens?: number;
      maxEstimatedContextTokens?: number;
      maxContextUtilization?: number;
      richUsageTurns?: number;
      fallbackUsageTurns?: number;
      richUsageSessions?: number;
      fallbackUsageSessions?: number;
      fileChangeCount?: number;
      buildSteps?: number;
      testSteps?: number;
      artifactVerificationPassed?: number;
    };
    counts?: {
      specs?: number;
      tasks?: number;
      doneTasks?: number;
      failedTasks?: number;
      artifactChecks?: number;
    };
    cleanup?: {
      enabled?: boolean;
      results?: CleanupResult[];
      removedCounts?: Record<string, number>;
    };
    entities?: Record<string, unknown>;
    projectStats?: Record<string, unknown>;
  };

  if (!Array.isArray(benchmark.operationLog)) return null;

  const lines = [
    "AURA Benchmark Run Log",
    "======================",
    "",
    `Title: ${benchmark.title ?? benchmark.scenarioId ?? "unknown"}`,
    `Run ID: ${benchmark.runId ?? "unknown"}`,
  ];

  if (benchmark.story) {
    lines.push(`Actor: ${benchmark.story.actor ?? "unknown"}`);
    lines.push(`Goal: ${benchmark.story.goal ?? "unknown"}`);
    lines.push(`Benefit: ${benchmark.story.benefit ?? "unknown"}`);
  }

  if (Array.isArray(benchmark.canonicalPrompts) && benchmark.canonicalPrompts.length > 0) {
    lines.push("");
    lines.push("Canonical Prompts");
    lines.push("-----------------");
    benchmark.canonicalPrompts.forEach((prompt, index) => {
      lines.push(`${index + 1}. ${prompt}`);
    });
  }

  lines.push("");
  lines.push("Operation Log");
  lines.push("-------------");
  benchmark.operationLog.forEach((entry, index) => {
    const duration = entry.durationMs != null ? ` (${entry.durationMs}ms)` : "";
    lines.push(`${index + 1}. [${entry.step}] ${entry.summary}${duration}`);
    if (entry.details && Object.keys(entry.details).length > 0) {
      lines.push(`   details: ${JSON.stringify(entry.details)}`);
    }
  });

  lines.push("");
  lines.push("Metrics");
  lines.push("-------");
  lines.push(`Duration (ms): ${formatMetricValue(benchmark.metrics?.totalDurationMs)}`);
  lines.push(`Input tokens: ${formatMetricValue(benchmark.metrics?.totalInputTokens)}`);
  lines.push(`Output tokens: ${formatMetricValue(benchmark.metrics?.totalOutputTokens)}`);
  lines.push(`Total tokens: ${formatMetricValue(benchmark.metrics?.totalTokens)}`);
  lines.push(`Estimated cost (USD): ${formatMetricValue(benchmark.metrics?.estimatedCostUsd, 4)}`);
  lines.push(`Cache write tokens: ${formatMetricValue(benchmark.metrics?.totalCacheCreationInputTokens)}`);
  lines.push(`Cache read tokens: ${formatMetricValue(benchmark.metrics?.totalCacheReadInputTokens)}`);
  lines.push(`Prompt footprint tokens: ${formatMetricValue(benchmark.metrics?.promptInputFootprintTokens)}`);
  lines.push(`Max estimated context tokens: ${formatMetricValue(benchmark.metrics?.maxEstimatedContextTokens)}`);
  lines.push(`Max context utilization: ${formatMetricValue(benchmark.metrics?.maxContextUtilization, 3)}`);
  lines.push(`Rich usage turns: ${formatMetricValue(benchmark.metrics?.richUsageTurns)}`);
  lines.push(`Fallback usage turns: ${formatMetricValue(benchmark.metrics?.fallbackUsageTurns)}`);
  lines.push(`Rich usage sessions: ${formatMetricValue(benchmark.metrics?.richUsageSessions)}`);
  lines.push(`Fallback usage sessions: ${formatMetricValue(benchmark.metrics?.fallbackUsageSessions)}`);
  lines.push(`Files changed: ${formatMetricValue(benchmark.metrics?.fileChangeCount)}`);
  lines.push(`Build steps: ${formatMetricValue(benchmark.metrics?.buildSteps)}`);
  lines.push(`Test steps: ${formatMetricValue(benchmark.metrics?.testSteps)}`);
  lines.push(`Artifact checks passed: ${formatMetricValue(benchmark.metrics?.artifactVerificationPassed)}`);

  lines.push("");
  lines.push("Counts");
  lines.push("------");
  lines.push(`Specs: ${formatMetricValue(benchmark.counts?.specs)}`);
  lines.push(`Tasks: ${formatMetricValue(benchmark.counts?.tasks)}`);
  lines.push(`Done tasks: ${formatMetricValue(benchmark.counts?.doneTasks)}`);
  lines.push(`Failed tasks: ${formatMetricValue(benchmark.counts?.failedTasks)}`);

  if (benchmark.cleanup) {
    lines.push("");
    lines.push("Cleanup");
    lines.push("-------");
    lines.push(`Enabled: ${benchmark.cleanup.enabled ? "yes" : "no"}`);
    if (benchmark.cleanup.removedCounts) {
      lines.push(`Removed counts: ${JSON.stringify(benchmark.cleanup.removedCounts)}`);
    }
  }

  if (benchmark.entities) {
    lines.push("");
    lines.push("Entities");
    lines.push("--------");
    lines.push(JSON.stringify(benchmark.entities, null, 2));
  }

  return `${lines.join("\n")}\n`;
}

async function resolveEvalOrg(page: Page, preferredName: string): Promise<BenchmarkOrgResolution> {
  const orgs = await apiJson<BenchmarkOrg[]>(page, "GET", "/api/orgs");
  const existing = orgs.find((org) => org.name === preferredName);
  if (existing) {
    return { ...existing, created: false };
  }
  const created = await apiJson<BenchmarkOrg>(page, "POST", "/api/orgs", { name: preferredName });
  return { ...created, created: true };
}

async function cleanupLiveBenchmarkEntities(
  page: Page,
  ids: {
    projectId?: string | null;
    agentId?: string | null;
    agentInstanceId?: string | null;
  },
) {
  const results: CleanupResult[] = [];
  results.push(await deleteResource(
    page,
    "agent_instance",
    ids.agentInstanceId,
    ids.projectId && ids.agentInstanceId
      ? `/api/projects/${ids.projectId}/agents/${ids.agentInstanceId}`
      : "",
  ));
  results.push(await deleteResource(
    page,
    "project",
    ids.projectId,
    ids.projectId ? `/api/projects/${ids.projectId}` : "",
  ));
  results.push(await deleteResource(
    page,
    "agent",
    ids.agentId,
    ids.agentId ? `/api/agents/${ids.agentId}` : "",
  ));
  return results;
}

export async function runLiveBenchmarkScenario(
  page: Page,
  scenario: LiveBenchmarkScenario,
  auth: { email: string; password: string } | { accessToken: string },
) {
  const results: RunStepResult[] = [];
  const runId = `${scenario.id}-${Date.now()}`;
  const orgName = process.env.AURA_EVAL_ORG_NAME ?? "Aura Evaluations";
  const projectName = `${scenario.project.name} ${runId}`;
  const keepEntities = process.env.AURA_EVAL_KEEP_ENTITIES === "1";
  const agentMachineType = process.env.AURA_EVAL_AGENT_MACHINE_TYPE ?? scenario.agentTemplate.machineType ?? "local";

  let org: BenchmarkOrg | null = null;
  let agentTemplate: { agent_id: string } | null = null;
  let project: ImportedProject | null = null;
  let agentInstance: { agent_instance_id: string } | null = null;
  let specs: unknown[] = [];
  let tasks: BenchmarkTask[] = [];
  let completedTasks: BenchmarkTask[] = [];
  let outputs: Record<string, BenchmarkTaskOutput> = {};
  let projectStats: Record<string, number> = {};
  let sessions: BenchmarkSession[] = [];
  let richUsageSummary: RichSessionUsageSummary | null = null;
  let artifactChecks: Array<{ path: string; ok: boolean; matchedTexts: string[] }> = [];
  const operationLog: BenchmarkOperationLogEntry[] = [];

  try {
    await timedStep(results, "login", async () => {
      if ("accessToken" in auth) {
        await importAccessTokenForLiveEval(page, auth.accessToken, scenario.timeouts.loginMs);
        return;
      }
      await loginForLiveEval(page, auth.email, auth.password, scenario.timeouts.loginMs);
    });
    operationLog.push({
      step: "login",
      summary: "Authenticated benchmark session",
      durationMs: latestStepDuration(results),
    });
    await maybeShowDemoPage(page, "/projects");

    org = await timedStep(results, "resolve_org", () => resolveEvalOrg(page, orgName));
    operationLog.push({
      step: "resolve_org",
      summary: org.created
        ? `Created benchmark org "${org.name}"`
        : `Reused benchmark org "${org.name}"`,
      durationMs: latestStepDuration(results),
      details: { orgId: org.org_id, created: org.created },
    });

    agentTemplate = await timedStep(results, "create_agent", () =>
      apiJson<{ agent_id: string }>(page, "POST", "/api/agents", {
        name: scenario.agentTemplate.name,
        role: scenario.agentTemplate.role,
        personality: scenario.agentTemplate.personality,
        system_prompt: scenario.agentTemplate.systemPrompt,
        machine_type: agentMachineType,
        skills: [],
        icon: null,
      }),
    );
    operationLog.push({
      step: "create_agent",
      summary: `Created agent "${scenario.agentTemplate.name}"`,
      durationMs: latestStepDuration(results),
      details: {
        agentId: agentTemplate.agent_id,
        machineType: agentMachineType,
      },
    });
    await maybeShowDemoPage(page, "/projects");

    const files = await timedStep(results, "prepare_fixture", () =>
      collectFixtureFiles(scenario.project.fixtureDir),
    );
    operationLog.push({
      step: "prepare_fixture",
      summary: `Prepared fixture "${scenario.project.fixtureDir}"`,
      durationMs: latestStepDuration(results),
      details: { fileCount: files.length },
    });

    project = await timedStep(results, "create_project", () =>
      apiJson<ImportedProject>(page, "POST", "/api/projects/import", {
        org_id: org.org_id,
        name: projectName,
        description: scenario.project.description,
        files,
        build_command: scenario.project.buildCommand,
        test_command: scenario.project.testCommand,
      }),
    );
    operationLog.push({
      step: "create_project",
      summary: `Imported project "${projectName}"`,
      durationMs: latestStepDuration(results),
      details: { projectId: project.project_id },
    });
    await maybeShowDemoPage(page, `/projects/${project.project_id}`);

    agentInstance = await timedStep(results, "create_agent_instance", () =>
      apiJson<ImportedAgentInstance>(
        page,
        "POST",
        `/api/projects/${project.project_id}/agents`,
        { agent_id: agentTemplate.agent_id },
      ),
    );
    operationLog.push({
      step: "create_agent_instance",
      summary: "Attached the benchmark agent to the project",
      durationMs: latestStepDuration(results),
      details: { agentInstanceId: agentInstance.agent_instance_id },
    });
    await maybeShowDemoPage(
      page,
      `/projects/${project.project_id}/agents/${agentInstance.agent_instance_id}`,
      1800,
    );

    specs = await timedStep(results, "create_spec", () =>
      apiJson<unknown[]>(
        page,
        "POST",
        `/api/projects/${project.project_id}/specs/generate?agent_instance_id=${agentInstance.agent_instance_id}`,
      ),
    );
    if (specs.length === 0) {
      throw new Error(`Spec generation returned no specs for project ${project.project_id}`);
    }
    operationLog.push({
      step: "create_spec",
      summary: `Generated ${specs.length} spec${specs.length === 1 ? "" : "s"}`,
      durationMs: latestStepDuration(results),
      details: { titles: collectSpecTitles(specs) },
    });
    await maybeShowDemoPage(page, `/projects/${project.project_id}/agents/${agentInstance.agent_instance_id}`, 1800);

    tasks = await timedStep(results, "create_tasks", () =>
      apiJson<BenchmarkTask[]>(
        page,
        "POST",
        `/api/projects/${project.project_id}/tasks/extract?agent_instance_id=${agentInstance.agent_instance_id}`,
      ),
    );
    if (tasks.length === 0) {
      throw new Error(`Task extraction returned no tasks for project ${project.project_id}`);
    }
    operationLog.push({
      step: "create_tasks",
      summary: `Extracted ${tasks.length} task${tasks.length === 1 ? "" : "s"} from generated specs`,
      durationMs: latestStepDuration(results),
      details: { titles: tasks.map((task) => task.title) },
    });
    await maybeShowDemoPage(page, `/projects/${project.project_id}/agents/${agentInstance.agent_instance_id}`, 1800);

    await timedStep(results, "build_app", () =>
      apiJson(
        page,
        "POST",
        `/api/projects/${project.project_id}/loop/start?agent_instance_id=${agentInstance.agent_instance_id}`,
      ),
    );
    operationLog.push({
      step: "build_app",
      summary: "Started the autonomous build loop",
      durationMs: latestStepDuration(results),
      details: { projectId: project.project_id, agentInstanceId: agentInstance.agent_instance_id },
    });
    await maybeShowDemoPage(page, `/projects/${project.project_id}/agents/${agentInstance.agent_instance_id}`, 1800);

    completedTasks = await timedStep(results, "wait_for_completion", () =>
      pollForLoopCompletion(
        page,
        project.project_id,
        scenario.timeouts.loopCompletionMs,
        scenario.timeouts.pollIntervalMs,
      ),
    );
    operationLog.push({
      step: "wait_for_completion",
      summary: `Build loop completed with ${completedTasks.filter((task) => task.status === "done").length} done and ${completedTasks.filter((task) => task.status === "failed").length} failed tasks`,
      durationMs: latestStepDuration(results),
      details: {
        taskStatuses: completedTasks.map((task) => ({ title: task.title, status: task.status })),
      },
    });
    await maybeShowDemoPage(page, `/projects/${project.project_id}/stats`, 1800);

    outputs = await timedStep(results, "collect_outputs", () =>
      collectTaskOutputs(page, project.project_id, completedTasks),
    );
    const stepSummary = sumBuildAndTestSteps(outputs);
    operationLog.push({
      step: "collect_outputs",
      summary: "Collected task outputs and verification command evidence",
      durationMs: latestStepDuration(results),
      details: stepSummary,
    });

    projectStats = await timedStep(results, "collect_stats", () =>
      apiJson<Record<string, number>>(
        page,
        "GET",
        `/api/projects/${project.project_id}/stats`,
      ),
    );
    operationLog.push({
      step: "collect_stats",
      summary: "Collected project metrics",
      durationMs: latestStepDuration(results),
      details: {
        totalTokens: Number(projectStats.total_tokens ?? 0),
        estimatedCostUsd: Number(projectStats.estimated_cost_usd ?? 0),
        completionPercentage: Number(projectStats.completion_percentage ?? 0),
      },
    });

    sessions = await timedStep(results, "collect_sessions", () =>
      apiJson<BenchmarkSession[]>(
        page,
        "GET",
        `/api/projects/${project.project_id}/agents/${agentInstance.agent_instance_id}/sessions`,
      ),
    );
    operationLog.push({
      step: "collect_sessions",
      summary: `Collected ${sessions.length} session record${sessions.length === 1 ? "" : "s"}`,
      durationMs: latestStepDuration(results),
      details: sumSessionTokens(sessions),
    });

    richUsageSummary = await timedStep(results, "collect_rich_usage", async () => {
      try {
        return await collectRichSessionUsage(page, sessions);
      } catch (error) {
        return {
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
          models: [],
          providers: [],
          sessionBreakdown: [],
          error: error instanceof Error ? error.message : String(error),
        } as RichSessionUsageSummary & { error: string };
      }
    });
    operationLog.push({
      step: "collect_rich_usage",
      summary: richUsageSummary
        ? `Collected rich usage from ${richUsageSummary.richUsageSessions} rich and ${richUsageSummary.fallbackUsageSessions} fallback session${richUsageSummary.richUsageSessions + richUsageSummary.fallbackUsageSessions === 1 ? "" : "s"}`
        : "Skipped rich usage collection because storage access is unavailable",
      durationMs: latestStepDuration(results),
      details: richUsageSummary
        ? {
          richUsageTurns: richUsageSummary.richUsageTurns,
          fallbackUsageTurns: richUsageSummary.fallbackUsageTurns,
          cacheReadInputTokens: richUsageSummary.totalCacheReadInputTokens,
          cacheCreationInputTokens: richUsageSummary.totalCacheCreationInputTokens,
          maxContextUtilization: richUsageSummary.maxContextUtilization,
          models: richUsageSummary.models,
          providers: richUsageSummary.providers,
        }
        : { skipped: true },
    });

    if (agentMachineType === "remote") {
      operationLog.push({
        step: "verify_artifacts",
        summary: "Skipped artifact file readback for remote swarm workspace",
        durationMs: 0,
        details: { skipped: true, machineType: agentMachineType },
      });
    } else {
      const workspacePath = agentInstance.workspace_path?.trim();
      if (!workspacePath) {
        throw new Error(
          `Agent instance ${agentInstance.agent_instance_id} did not report a workspace path`,
        );
      }
      artifactChecks = await timedStep(results, "verify_artifacts", () =>
        verifyArtifactFiles(page, workspacePath, scenario.project.artifactChecks, {
          machineType: agentMachineType,
          remoteAgentId: agentTemplate?.agent_id,
        }),
      );
      operationLog.push({
        step: "verify_artifacts",
        summary: `Verified ${artifactChecks.length} artifact file${artifactChecks.length === 1 ? "" : "s"}`,
        durationMs: latestStepDuration(results),
        details: {
          artifacts: artifactChecks.map((check) => ({ path: check.path, ok: check.ok })),
        },
      });
    }

    await timedStep(results, "verify_build", async () => {
      await page.goto(`/projects/${project.project_id}/stats`);
      for (const text of scenario.verification.statsTexts) {
        await expect(page.getByText(text, { exact: true }).first()).toBeVisible();
      }
      await maybePauseForDemo(page, 2400);
    });

    if (demoModeEnabled) {
      await maybeShowDemoPage(page, `/api/projects/${project.project_id}/stats`, 3000);
    }

    const tokenSummary = sumSessionTokens(sessions);
    const doneTasks = completedTasks.filter((task) => task.status === "done");
    const failedTasks = completedTasks.filter((task) => task.status === "failed");

    if (scenario.verification.requireAnyDoneTasks) {
      expect(doneTasks.length).toBeGreaterThan(0);
    }
    if (scenario.verification.requireNoFailedTasks) {
      expect(failedTasks).toHaveLength(0);
    }
    if (scenario.verification.requireBuildSteps && agentMachineType === "local") {
      expect(stepSummary.buildSteps).toBeGreaterThan(0);
    }
    if (scenario.verification.requireTestSteps && agentMachineType === "local") {
      expect(stepSummary.testSteps).toBeGreaterThan(0);
    }

    const cleanupResults = keepEntities
      ? []
      : await cleanupLiveBenchmarkEntities(page, {
        projectId: project.project_id,
        agentId: agentTemplate.agent_id,
        agentInstanceId: agentInstance.agent_instance_id,
      });

    const cleanup = keepEntities ? {
      enabled: false,
      results: [] as CleanupResult[],
      removedCounts: {} as Record<string, number>,
    } : {
      enabled: true,
      ...collectCleanupSummary(cleanupResults),
      results: cleanupResults,
    };

    operationLog.push({
      step: "cleanup",
      summary: cleanup.enabled
        ? "Removed benchmark-created agent instance, project, and agent"
        : "Kept benchmark-created entities for debugging",
      details: cleanup.enabled
        ? { removedCounts: cleanup.removedCounts }
        : { keptEntities: true },
    });

    if (demoModeEnabled && cleanup.enabled) {
      await maybeShowDemoPage(page, "/projects", 1800);
    }

    return {
      scenarioId: scenario.id,
      title: scenario.title,
      runId,
      story: scenario.story,
      canonicalPrompts: scenario.canonicalPrompts,
      steps: results,
      operationLog,
      entities: {
        orgId: org.org_id,
        agentId: agentTemplate.agent_id,
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
        totalDurationMs: results.reduce((sum, step) => sum + step.durationMs, 0),
        totalInputTokens: tokenSummary.input,
        totalOutputTokens: tokenSummary.output,
        totalTokens: Number(projectStats.total_tokens ?? tokenSummary.input + tokenSummary.output),
        estimatedCostUsd: Number(projectStats.estimated_cost_usd ?? 0),
        totalCacheCreationInputTokens: richUsageSummary?.totalCacheCreationInputTokens ?? 0,
        totalCacheReadInputTokens: richUsageSummary?.totalCacheReadInputTokens ?? 0,
        promptInputFootprintTokens: richUsageSummary?.promptInputFootprintTokens ?? tokenSummary.input,
        maxEstimatedContextTokens: richUsageSummary?.maxEstimatedContextTokens ?? 0,
        maxContextUtilization: richUsageSummary?.maxContextUtilization ?? Math.max(
          ...sessions.map((session) => session.context_usage_estimate ?? 0),
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
    if (!keepEntities) {
      await cleanupLiveBenchmarkEntities(page, {
        projectId: project?.project_id,
        agentId: agentTemplate?.agent_id,
        agentInstanceId: agentInstance?.agent_instance_id,
      });
    }
    throw error;
  }
}
