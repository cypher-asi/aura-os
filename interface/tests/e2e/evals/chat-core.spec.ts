import { expect, test, type Page } from "@playwright/test";

import {
  loadChatCoreScenarios,
  scenarioSupportsDevice,
  writeEvalArtifacts,
} from "./helpers";
import { installChatCoreMockApp } from "./chatCoreMockApp";

test.use({ serviceWorkers: "block" });
test.describe.configure({ mode: "serial" });

const scenarios = await loadChatCoreScenarios();

async function selectConfiguredSlashCommands(page: Page, scenario: (typeof scenarios)[number]) {
  const input = page.locator('[data-agent-field="chat-input"]');
  for (const command of scenario.turn.slashCommands ?? []) {
    await input.fill(`/${command.query}`);
    await expect(page.getByRole("button", { name: new RegExp(command.label) })).toBeVisible();
    await input.press("Enter");
    await expect(page.locator('[data-agent-surface="command-chips-stacked"]')).toContainText(
      `/${command.label}`,
    );
  }
}

for (const scenario of scenarios) {
  test(`${scenario.title} @chat-core`, async ({ page }, testInfo) => {
    test.skip(
      !scenarioSupportsDevice(scenario.devices, testInfo.project.name),
      `Scenario ${scenario.id} does not target ${testInfo.project.name}`,
    );

    const harness = await installChatCoreMockApp(page, scenario);
    const steps: Array<{ label: string; durationMs: number }> = [];
    const timed = async <T>(label: string, action: () => Promise<T>) => {
      const startedAt = Date.now();
      const value = await action();
      steps.push({ label, durationMs: Date.now() - startedAt });
      return value;
    };

    await timed("open_project_agent_chat", () =>
      page.goto(`/projects/${scenario.project.projectId}/agents/${scenario.agent.agentInstanceId}`),
    );

    await timed("wait_for_empty_chat", async () => {
      await expect(page.locator('[data-agent-field="chat-input"]')).toBeVisible();
      await expect(page.getByRole("button", { name: "Send", exact: true })).toBeDisabled();
    });

    await timed("send_chat_turn", async () => {
      const input = page.locator('[data-agent-field="chat-input"]');
      await selectConfiguredSlashCommands(page, scenario);
      await input.fill(scenario.turn.input);
      if (testInfo.project.name.includes("mobile")) {
        await input.press("Enter");
      } else {
        await page.locator('button[aria-label="Send"]:visible').click();
      }
    });

    await timed("wait_for_assistant_response", async () => {
      for (const text of scenario.verification.visibleTexts) {
        await expect(page.getByText(text, { exact: true }).first()).toBeVisible();
      }
    });

    await timed("verify_contract", async () => {
      expect(harness.streamRequests).toHaveLength(scenario.verification.expectedStreamRequestCount);
      expect(harness.historyRequests.length).toBeGreaterThanOrEqual(
        scenario.verification.expectedHistoryRequestMinimum,
      );
      expect(harness.streamEventTypes).toEqual(scenario.verification.expectedStreamEventTypes);
      const [request] = harness.streamRequests;
      expect(request.content).toBe(scenario.turn.input);
      expect(request.action).toBe(scenario.turn.expectedAction);
      expect(request.model).toBe(scenario.turn.expectedModel);
      if (scenario.turn.expectedCommands) {
        expect(request.commands).toEqual(scenario.turn.expectedCommands);
      }
      expect(harness.getHistorySnapshot()).toHaveLength(scenario.turn.persistedHistory.length);
      expect(harness.unhandledApiRequests).toEqual([]);
    });

    await writeEvalArtifacts(page, testInfo, scenario.id, {
      scenarioId: scenario.id,
      title: scenario.title,
      suite: scenario.suite,
      kind: scenario.kind,
      device: testInfo.project.name,
      bundleId: "chat-core-fixture-v1",
      bundle: "deterministic-chat-core-mock",
      steps,
      counts: {
        streamRequests: harness.streamRequests.length,
        streamEvents: harness.streamEventTypes.length,
        historyRequests: harness.historyRequests.length,
        persistedEvents: harness.getHistorySnapshot().length,
        unhandledApiRequests: harness.unhandledApiRequests.length,
      },
      metrics: {
        totalDurationMs: steps.reduce((sum, step) => sum + step.durationMs, 0),
        totalSteps: steps.length,
        totalTokens: 148,
        totalInputTokens: 96,
        totalOutputTokens: 52,
        maxContextUtilization: scenario.verification.expectedContextUtilization,
      },
      request: harness.streamRequests[0],
      streamEventTypes: harness.streamEventTypes,
      persistedHistory: harness.getHistorySnapshot(),
    });
  });
}

const attachExistingScenario = scenarios.find(
  (scenario) => scenario.id === "project-agent-attach-existing-chat",
);

const createRemoteScenario = scenarios.find(
  (scenario) => scenario.id === "project-agent-create-remote-chat",
);

test("Attach existing project agent and chat @chat-core", async ({ page }, testInfo) => {
  test.skip(!attachExistingScenario, "Missing project-agent-attach-existing-chat scenario");
  const scenario = attachExistingScenario!;
  test.skip(
    !scenarioSupportsDevice(scenario.devices, testInfo.project.name),
    `Scenario ${scenario.id} does not target ${testInfo.project.name}`,
  );

  const harness = await installChatCoreMockApp(page, scenario, {
    startWithAttachedAgent: false,
  });
  const steps: Array<{ label: string; durationMs: number }> = [];
  const timed = async <T>(label: string, action: () => Promise<T>) => {
    const startedAt = Date.now();
    const value = await action();
    steps.push({ label, durationMs: Date.now() - startedAt });
    return value;
  };

  await timed("open_project_agents", () =>
    page.goto(`/projects/${scenario.project.projectId}/agents`),
  );

  await timed("open_attach_existing", async () => {
    await expect(page.getByText("No agents attached yet", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Add Agent", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Add project agent" })).toBeVisible();
    await page.getByRole("button", { name: /Attach Existing Agent/ }).click();
  });

  await timed("attach_agent", async () => {
    await expect(page).toHaveURL(new RegExp(`/projects/${scenario.project.projectId}/agents/attach$`));
    await expect(page.getByText(scenario.agent.name, { exact: true })).toBeVisible();
    await page.getByRole("button", { name: new RegExp(scenario.agent.name) }).click();
    await expect(page).toHaveURL(
      new RegExp(`/projects/${scenario.project.projectId}/agents/${scenario.agent.agentInstanceId}(?:\\?session=[^#]+)?$`),
    );
    await expect(page.locator('[data-agent-field="chat-input"]')).toBeVisible();
  });

  await timed("send_attached_agent_chat_turn", async () => {
    const input = page.locator('[data-agent-field="chat-input"]');
    await input.fill(scenario.turn.input);
    if (testInfo.project.name.includes("mobile")) {
      await input.press("Enter");
    } else {
      await page.locator('button[aria-label="Send"]:visible').click();
    }
  });

  await timed("wait_for_attached_agent_response", async () => {
    for (const text of scenario.verification.visibleTexts) {
      await expect(page.getByText(text, { exact: true }).first()).toBeVisible();
    }
  });

  await timed("verify_attach_contract", async () => {
    expect(harness.agentAttachRequests).toHaveLength(1);
    expect(harness.agentAttachRequests[0]?.agentId).toBe(scenario.agent.agentId);
    expect(harness.getAttachedAgentsSnapshot()).toHaveLength(1);
    expect(harness.streamRequests).toHaveLength(scenario.verification.expectedStreamRequestCount);
    expect(harness.historyRequests.length).toBeGreaterThanOrEqual(
      scenario.verification.expectedHistoryRequestMinimum,
    );
    expect(harness.streamEventTypes).toEqual(scenario.verification.expectedStreamEventTypes);
    expect(harness.streamRequests[0]?.content).toBe(scenario.turn.input);
    expect(harness.streamRequests[0]?.model).toBe(scenario.turn.expectedModel);
    expect(harness.unhandledApiRequests).toEqual([]);
  });

  await writeEvalArtifacts(page, testInfo, `${scenario.id}-attach-flow`, {
    scenarioId: `${scenario.id}-attach-flow`,
    title: "Attach existing project agent and chat",
    suite: scenario.suite,
    kind: "agent_attach_chat_core_loop",
    device: testInfo.project.name,
    bundleId: "chat-core-fixture-v1",
    bundle: "deterministic-chat-core-mock",
    steps,
    counts: {
      agentAttachRequests: harness.agentAttachRequests.length,
      attachedAgents: harness.getAttachedAgentsSnapshot().length,
      streamRequests: harness.streamRequests.length,
      streamEvents: harness.streamEventTypes.length,
      historyRequests: harness.historyRequests.length,
      persistedEvents: harness.getHistorySnapshot().length,
      unhandledApiRequests: harness.unhandledApiRequests.length,
    },
    metrics: {
      totalDurationMs: steps.reduce((sum, step) => sum + step.durationMs, 0),
      totalSteps: steps.length,
      totalTokens: 137,
      totalInputTokens: 88,
      totalOutputTokens: 49,
      maxContextUtilization: scenario.verification.expectedContextUtilization,
    },
    attachRequests: harness.agentAttachRequests,
    request: harness.streamRequests[0],
    streamEventTypes: harness.streamEventTypes,
    persistedHistory: harness.getHistorySnapshot(),
  });
});

test("Create remote project agent and chat @chat-core", async ({ page }, testInfo) => {
  test.skip(!createRemoteScenario, "Missing project-agent-create-remote-chat scenario");
  const scenario = createRemoteScenario!;
  test.skip(
    !scenarioSupportsDevice(scenario.devices, testInfo.project.name),
    `Scenario ${scenario.id} does not target ${testInfo.project.name}`,
  );

  const harness = await installChatCoreMockApp(page, scenario, {
    startWithAttachedAgent: false,
  });
  const steps: Array<{ label: string; durationMs: number }> = [];
  const timed = async <T>(label: string, action: () => Promise<T>) => {
    const startedAt = Date.now();
    const value = await action();
    steps.push({ label, durationMs: Date.now() - startedAt });
    return value;
  };

  await timed("open_project_agents", () =>
    page.goto(`/projects/${scenario.project.projectId}/agents`),
  );

  await timed("open_create_remote_agent", async () => {
    await expect(page.getByText("No agents attached yet", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Add Agent", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Add project agent" })).toBeVisible();
    await page.getByRole("button", { name: /Create Remote Agent/ }).click();
  });

  await timed("create_and_attach_agent", async () => {
    await expect(page).toHaveURL(new RegExp(`/projects/${scenario.project.projectId}/agents/create$`));
    await expect(page.getByLabel("Name")).toBeVisible();
    await page.getByLabel("Name").fill(scenario.agent.name);
    await page.getByLabel("Role").fill(scenario.agent.role);
    await page.getByLabel("Personality").fill(scenario.agent.personality);
    await page.getByLabel("System Prompt").fill(scenario.agent.systemPrompt);
    await page.getByRole("button", { name: "Create Agent", exact: true }).click();
    await expect.poll(() => harness.agentCreateRequests.length).toBe(1);
    await expect.poll(() => harness.remoteAgentStateRequests.length).toBeGreaterThanOrEqual(1);
    await expect.poll(() => harness.agentAttachRequests.length).toBe(1);
    expect(harness.unhandledApiRequests).toEqual([]);
    await expect(page).toHaveURL(
      new RegExp(`/projects/${scenario.project.projectId}/agents/${scenario.agent.agentInstanceId}(?:\\?session=[^#]+)?$`),
    );
    await expect(page.locator('[data-agent-field="chat-input"]')).toBeVisible();
  });

  await timed("send_created_agent_chat_turn", async () => {
    const input = page.locator('[data-agent-field="chat-input"]');
    await input.fill(scenario.turn.input);
    if (testInfo.project.name.includes("mobile")) {
      await input.press("Enter");
    } else {
      await page.locator('button[aria-label="Send"]:visible').click();
    }
  });

  await timed("wait_for_created_agent_response", async () => {
    for (const text of scenario.verification.visibleTexts) {
      await expect(page.getByText(text, { exact: true }).first()).toBeVisible();
    }
  });

  await timed("verify_create_contract", async () => {
    expect(harness.agentCreateRequests).toHaveLength(1);
    expect(harness.agentCreateRequests[0]?.name).toBe(scenario.agent.name);
    expect(harness.agentCreateRequests[0]?.machineType).toBe("remote");
    expect(harness.remoteAgentStateRequests.length).toBeGreaterThanOrEqual(1);
    expect(harness.agentAttachRequests).toHaveLength(1);
    expect(harness.agentAttachRequests[0]?.agentId).toBe(scenario.agent.agentId);
    expect(harness.getAttachedAgentsSnapshot()).toHaveLength(1);
    expect(harness.streamRequests).toHaveLength(scenario.verification.expectedStreamRequestCount);
    expect(harness.historyRequests.length).toBeGreaterThanOrEqual(
      scenario.verification.expectedHistoryRequestMinimum,
    );
    expect(harness.streamEventTypes).toEqual(scenario.verification.expectedStreamEventTypes);
    expect(harness.streamRequests[0]?.content).toBe(scenario.turn.input);
    expect(harness.streamRequests[0]?.model).toBe(scenario.turn.expectedModel);
    expect(harness.unhandledApiRequests).toEqual([]);
  });

  await writeEvalArtifacts(page, testInfo, `${scenario.id}-create-flow`, {
    scenarioId: `${scenario.id}-create-flow`,
    title: "Create remote project agent and chat",
    suite: scenario.suite,
    kind: "agent_create_chat_core_loop",
    device: testInfo.project.name,
    bundleId: "chat-core-fixture-v1",
    bundle: "deterministic-chat-core-mock",
    steps,
    counts: {
      agentCreateRequests: harness.agentCreateRequests.length,
      remoteAgentStateRequests: harness.remoteAgentStateRequests.length,
      agentAttachRequests: harness.agentAttachRequests.length,
      attachedAgents: harness.getAttachedAgentsSnapshot().length,
      streamRequests: harness.streamRequests.length,
      streamEvents: harness.streamEventTypes.length,
      historyRequests: harness.historyRequests.length,
      persistedEvents: harness.getHistorySnapshot().length,
      unhandledApiRequests: harness.unhandledApiRequests.length,
    },
    metrics: {
      totalDurationMs: steps.reduce((sum, step) => sum + step.durationMs, 0),
      totalSteps: steps.length,
      totalTokens: 138,
      totalInputTokens: 91,
      totalOutputTokens: 47,
      maxContextUtilization: scenario.verification.expectedContextUtilization,
    },
    createRequests: harness.agentCreateRequests,
    attachRequests: harness.agentAttachRequests,
    request: harness.streamRequests[0],
    streamEventTypes: harness.streamEventTypes,
    persistedHistory: harness.getHistorySnapshot(),
  });
});
