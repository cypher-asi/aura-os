import { expect, test } from "@playwright/test";

import {
  collectFixtureFiles,
  loadWorkflowE2EScenarios,
  scenarioSupportsDevice,
  writeEvalArtifacts,
} from "./helpers";
import { browserApiFetch, installWorkflowMockApp } from "./workflowMockApp";

test.use({ serviceWorkers: "block" });
test.describe.configure({ mode: "serial" });

const scenarios = await loadWorkflowE2EScenarios();

for (const scenario of scenarios) {
  test(`${scenario.title} @workflow`, async ({ page }, testInfo) => {
    test.skip(
      !scenarioSupportsDevice(scenario.devices, testInfo.project.name),
      `Scenario ${scenario.id} does not target ${testInfo.project.name}`,
    );

    const harness = await installWorkflowMockApp(page, scenario);
    const importedFiles = await collectFixtureFiles(scenario.fixtureDir);
    const steps: Array<{ label: string; durationMs: number }> = [];
    const timed = async <T>(label: string, action: () => Promise<T>) => {
      const startedAt = Date.now();
      const value = await action();
      steps.push({
        label,
        durationMs: Date.now() - startedAt,
      });
      return value;
    };

    await timed("open_projects", () => page.goto("/projects"));

    const org = await timed("create_org", () => browserApiFetch<{ org_id: string }>(page, "POST", "/api/orgs", {
      name: scenario.org.name,
    }));
    const agent = await timed("create_agent", () => browserApiFetch<{ agent_id: string }>(page, "POST", "/api/agents", {
      name: scenario.agentTemplate.name,
      role: scenario.agentTemplate.role,
      personality: scenario.agentTemplate.personality,
      system_prompt: scenario.agentTemplate.systemPrompt,
      machine_type: "local",
      skills: [],
      icon: null,
    }));
    const project = await timed("create_project", () => browserApiFetch<{ project_id: string }>(page, "POST", "/api/projects/import", {
      org_id: org.org_id,
      name: scenario.project.name,
      description: scenario.project.description,
      files: importedFiles,
      build_command: scenario.project.buildCommand,
      test_command: scenario.project.testCommand,
    }));
    const agentInstance = await timed("create_agent_instance", () => browserApiFetch<{ agent_instance_id: string }>(
      page,
      "POST",
      `/api/projects/${project.project_id}/agents`,
      { agent_id: agent.agent_id },
    ));
    const specs = await timed("generate_specs", () => browserApiFetch<Array<{ title: string }>>(
      page,
      "POST",
      `/api/projects/${project.project_id}/specs/generate?agent_instance_id=${agentInstance.agent_instance_id}`,
    ));
    const tasks = await timed("extract_tasks", () => browserApiFetch<Array<{ task_id: string; title: string; status: string }>>(
      page,
      "POST",
      `/api/projects/${project.project_id}/tasks/extract?agent_instance_id=${agentInstance.agent_instance_id}`,
    ));

    await timed("open_workbench", () => page.goto(`/projects/${project.project_id}/work`));
    await expect(page.getByRole("heading", { name: /Task Feed/i })).toBeVisible();
    await expect(page.getByRole("button", { name: "Specs", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Tasks", exact: true })).toBeVisible();
    await expect(page.getByText(tasks[0].title, { exact: true })).toBeVisible();

    await timed("start_loop", async () => {
      await page.getByRole("button", { name: "Start", exact: true }).first().click();
    });

    await timed("wait_for_loop_completion", async () => {
      await expect
        .poll(async () => {
          const status = await browserApiFetch<{ running: boolean; paused: boolean }>(
            page,
            "GET",
            `/api/projects/${project.project_id}/loop/status`,
          );
          return status.running === false && status.paused === false;
        })
        .toBe(true);
    });

    await timed("open_stats", () => page.goto(`/projects/${project.project_id}/stats`));
    for (const text of scenario.verification.statsTexts) {
      await expect(page.getByText(text, { exact: true }).first()).toBeVisible();
    }
    await expect(page.getByText("100%", { exact: true })).toBeVisible();
    await expect(page.getByText(String(tasks.length), { exact: true }).first()).toBeVisible();

    const projectStats = await timed("collect_stats", () => browserApiFetch<{
      total_tasks: number;
      done_tasks: number;
      failed_tasks: number;
      total_tokens: number;
      estimated_cost_usd: number;
      total_time_seconds: number;
      total_specs: number;
      completion_percentage: number;
    }>(
      page,
      "GET",
      `/api/projects/${project.project_id}/stats`,
    ));

    const taskOutputs = await timed("collect_task_outputs", () => Promise.all(
      tasks.map(async (task) => {
        const output = await browserApiFetch<{ output: string; build_steps?: unknown[]; test_steps?: unknown[] }>(
          page,
          "GET",
          `/api/projects/${project.project_id}/tasks/${task.task_id}/output`,
        );
        return { taskId: task.task_id, title: task.title, output };
      }),
    ));

    for (const expectedText of scenario.verification.taskOutputContains) {
      expect(taskOutputs.some((entry) => entry.output.output.includes(expectedText))).toBe(true);
    }

    expect(specs.map((spec) => spec.title)).toContain(scenario.generatedSpec.title);
    expect(tasks.map((task) => task.title)).toEqual(scenario.extractedTasks.map((task) => task.title));

    const buildSteps = taskOutputs.reduce((sum, entry) => sum + (entry.output.build_steps?.length ?? 0), 0);
    const testSteps = taskOutputs.reduce((sum, entry) => sum + (entry.output.test_steps?.length ?? 0), 0);

    await writeEvalArtifacts(page, testInfo, scenario.id, {
      scenarioId: scenario.id,
      title: scenario.title,
      suite: scenario.suite,
      kind: scenario.kind,
      device: testInfo.project.name,
      bundleId: "workflow-mock-default",
      bundle: "deterministic-workflow-mock",
      steps,
      entities: {
        orgId: org.org_id,
        agentId: agent.agent_id,
        projectId: project.project_id,
        agentInstanceId: agentInstance.agent_instance_id,
      },
      counts: {
        specs: specs.length,
        tasks: tasks.length,
        doneTasks: projectStats.done_tasks,
        failedTasks: projectStats.failed_tasks,
      },
      metrics: {
        totalDurationMs: steps.reduce((sum, step) => sum + step.durationMs, 0),
        totalTokens: projectStats.total_tokens,
        estimatedCostUsd: projectStats.estimated_cost_usd,
        buildSteps,
        testSteps,
        completionPercentage: projectStats.completion_percentage,
        totalTimeSeconds: projectStats.total_time_seconds,
      },
      projectStats,
      specs,
      tasks,
      taskOutputs,
      fixtureFileCount: importedFiles.length,
      stateSnapshot: harness.getStateSnapshot(),
    });
  });
}
