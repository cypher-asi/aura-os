import { expect, type AriaRole, type Locator, type Page, type TestInfo } from "@playwright/test";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
  total_input_tokens: number;
  total_output_tokens: number;
}

interface BenchmarkTaskOutput {
  output: string;
  build_steps?: unknown[];
  test_steps?: unknown[];
}

interface ImportedProject {
  project_id: string;
  linked_folder_path?: string;
}

interface FileReadResponse {
  ok: boolean;
  path?: string;
  content?: string;
  error?: string;
}

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

  const screenshotPath = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  await testInfo.attach(`${name}.png`, {
    path: screenshotPath,
    contentType: "image/png",
  });
}

async function apiJson<T>(page: Page, method: "GET" | "POST", url: string, body?: unknown): Promise<T> {
  const response = method === "GET"
    ? await page.request.get(url)
    : await page.request.post(url, { data: body });
  const text = await response.text();
  if (!response.ok()) {
    throw new Error(`${method} ${url} failed with ${response.status()}: ${text}`);
  }
  if (!text) {
    return undefined as T;
  }
  return JSON.parse(text) as T;
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
      const response = await page.request.get("/api/auth/session");
      return response.ok();
    }, { timeout: timeoutMs })
    .toBe(true);
}

export async function importAccessTokenForLiveEval(
  page: Page,
  accessToken: string,
  timeoutMs: number,
) {
  await apiJson(page, "POST", "/api/auth/import-access-token", {
    access_token: accessToken,
  });
  await expect
    .poll(async () => {
      const response = await page.request.get("/api/auth/session");
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
) {
  const results = [];

  for (const check of checks ?? []) {
    const response = await apiJson<FileReadResponse>(page, "POST", "/api/read-file", {
      path: path.join(rootPath, check.path),
    });

    expect(response.ok, `Expected ${check.path} to be readable`).toBe(true);
    const content = response.content ?? "";
    for (const text of check.mustContain) {
      expect(content).toContain(text);
    }

    results.push({
      path: check.path,
      ok: response.ok,
      matchedTexts: check.mustContain,
    });
  }

  return results;
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

export async function runLiveBenchmarkScenario(
  page: Page,
  scenario: LiveBenchmarkScenario,
  auth: { email: string; password: string } | { accessToken: string },
) {
  const results: RunStepResult[] = [];
  const runId = `${scenario.id}-${Date.now()}`;
  const orgName = `Aura Eval ${scenario.story.goal} ${runId}`;
  const projectName = `${scenario.project.name} ${runId}`;

  await timedStep(results, "login", async () => {
    if ("accessToken" in auth) {
      await importAccessTokenForLiveEval(page, auth.accessToken, scenario.timeouts.loginMs);
      return;
    }
    await loginForLiveEval(page, auth.email, auth.password, scenario.timeouts.loginMs);
  });

  const org = await timedStep(results, "create_org", () =>
    apiJson<{ org_id: string }>(page, "POST", "/api/orgs", { name: orgName }),
  );

  const agentTemplate = await timedStep(results, "create_agent", () =>
    apiJson<{ agent_id: string }>(page, "POST", "/api/agents", {
      name: scenario.agentTemplate.name,
      role: scenario.agentTemplate.role,
      personality: scenario.agentTemplate.personality,
      system_prompt: scenario.agentTemplate.systemPrompt,
      machine_type: scenario.agentTemplate.machineType ?? "local",
      skills: [],
      icon: null,
    }),
  );

  const files = await timedStep(results, "prepare_fixture", () =>
    collectFixtureFiles(scenario.project.fixtureDir),
  );

  const project = await timedStep(results, "create_project", () =>
    apiJson<ImportedProject>(page, "POST", "/api/projects/import", {
      org_id: org.org_id,
      name: projectName,
      description: scenario.project.description,
      files,
      build_command: scenario.project.buildCommand,
      test_command: scenario.project.testCommand,
    }),
  );

  const agentInstance = await timedStep(results, "create_agent_instance", () =>
    apiJson<{ agent_instance_id: string }>(
      page,
      "POST",
      `/api/projects/${project.project_id}/agents`,
      { agent_id: agentTemplate.agent_id },
    ),
  );

  const specs = await timedStep(results, "create_spec", () =>
    apiJson<unknown[]>(
      page,
      "POST",
      `/api/projects/${project.project_id}/specs/generate?agent_instance_id=${agentInstance.agent_instance_id}`,
    ),
  );
  if (specs.length === 0) {
    throw new Error(`Spec generation returned no specs for project ${project.project_id}`);
  }

  const tasks = await timedStep(results, "create_tasks", () =>
    apiJson<BenchmarkTask[]>(
      page,
      "POST",
      `/api/projects/${project.project_id}/tasks/extract?agent_instance_id=${agentInstance.agent_instance_id}`,
    ),
  );
  if (tasks.length === 0) {
    throw new Error(`Task extraction returned no tasks for project ${project.project_id}`);
  }

  await timedStep(results, "build_app", () =>
    apiJson(
      page,
      "POST",
      `/api/projects/${project.project_id}/loop/start?agent_instance_id=${agentInstance.agent_instance_id}`,
    ),
  );

  const completedTasks = await timedStep(results, "wait_for_completion", () =>
    pollForLoopCompletion(
      page,
      project.project_id,
      scenario.timeouts.loopCompletionMs,
      scenario.timeouts.pollIntervalMs,
    ),
  );

  const outputs = await timedStep(results, "collect_outputs", () =>
    collectTaskOutputs(page, project.project_id, completedTasks),
  );

  const projectStats = await timedStep(results, "collect_stats", () =>
    apiJson<Record<string, number>>(
      page,
      "GET",
      `/api/projects/${project.project_id}/stats`,
    ),
  );

  const sessions = await timedStep(results, "collect_sessions", () =>
    apiJson<BenchmarkSession[]>(
      page,
      "GET",
      `/api/projects/${project.project_id}/agents/${agentInstance.agent_instance_id}/sessions`,
    ),
  );

  const artifactChecks = await timedStep(results, "verify_artifacts", () =>
    verifyArtifactFiles(page, project.linked_folder_path ?? "", scenario.project.artifactChecks),
  );

  await timedStep(results, "verify_build", async () => {
    await page.goto(`/projects/${project.project_id}/stats`);
    for (const text of scenario.verification.statsTexts) {
      await expect(page.getByText(text, { exact: true }).first()).toBeVisible();
    }
  });

  const tokenSummary = sumSessionTokens(sessions);
  const stepSummary = sumBuildAndTestSteps(outputs);
  const doneTasks = completedTasks.filter((task) => task.status === "done");
  const failedTasks = completedTasks.filter((task) => task.status === "failed");

  if (scenario.verification.requireAnyDoneTasks) {
    expect(doneTasks.length).toBeGreaterThan(0);
  }
  if (scenario.verification.requireNoFailedTasks) {
    expect(failedTasks).toHaveLength(0);
  }
  if (scenario.verification.requireBuildSteps) {
    expect(stepSummary.buildSteps).toBeGreaterThan(0);
  }
  if (scenario.verification.requireTestSteps) {
    expect(stepSummary.testSteps).toBeGreaterThan(0);
  }

  return {
    scenarioId: scenario.id,
    title: scenario.title,
    runId,
    story: scenario.story,
    canonicalPrompts: scenario.canonicalPrompts,
    steps: results,
    entities: {
      orgId: org.org_id,
      agentId: agentTemplate.agent_id,
      projectId: project.project_id,
      agentInstanceId: agentInstance.agent_instance_id,
      linkedFolderPath: project.linked_folder_path ?? null,
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
      buildSteps: stepSummary.buildSteps,
      testSteps: stepSummary.testSteps,
      artifactVerificationPassed: artifactChecks.length,
    },
    projectStats,
    artifactChecks,
    taskStatuses: completedTasks.map((task) => ({
      taskId: task.task_id,
      title: task.title,
      status: task.status,
      totalInputTokens: task.total_input_tokens,
      totalOutputTokens: task.total_output_tokens,
    })),
    taskOutputs: outputs,
  };
}
