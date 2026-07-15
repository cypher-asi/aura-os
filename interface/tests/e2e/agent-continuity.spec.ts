import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { mockAuthenticatedApp } from "./helpers/mockAuthenticatedApp";

test.use({ serviceWorkers: "block" });

const activeContinuity = {
  scope: "agent",
  status: "active",
  sensitivity: "normal",
  pinned: false,
  provenance: {
    session_id: "session-42",
    excerpt: "The test command is cargo nextest run.",
    extractor_model: "claude-haiku",
    project_id: "proj-1",
    contributor_agent_id: "agent-1",
  },
};

test("controls, approves, explains, and corrects agent memory", async ({ page }) => {
  mkdirSync("output/playwright", { recursive: true });
  await mockAuthenticatedApp(page, {
    memorySnapshots: {
      "agent-1": {
        facts: [
          {
            fact_id: "fact-active",
            agent_id: "agent-1",
            key: "test_command",
            value: "cargo nextest run",
            confidence: 0.94,
            source: "extracted",
            importance: 0.82,
            access_count: 3,
            last_accessed: "2026-07-10T14:00:00.000Z",
            created_at: "2026-07-08T12:00:00.000Z",
            updated_at: "2026-07-10T14:00:00.000Z",
            continuity: activeContinuity,
          },
          {
            fact_id: "fact-pending",
            agent_id: "agent-1",
            key: "deploy_region",
            value: "us-east-1",
            confidence: 0.78,
            source: "extracted",
            importance: 0.7,
            access_count: 0,
            last_accessed: "2026-07-10T14:00:00.000Z",
            created_at: "2026-07-10T14:00:00.000Z",
            updated_at: "2026-07-10T14:00:00.000Z",
            continuity: {
              ...activeContinuity,
              status: "pending",
              provenance: {
                session_id: "session-43",
                excerpt: "We may deploy to us-east-1.",
                extractor_model: "claude-haiku",
              },
            },
          },
        ],
        events: [
          {
            event_id: "event-1",
            agent_id: "agent-1",
            event_type: "task_run",
            summary: "Completed release verification",
            metadata: {},
            importance: 0.6,
            access_count: 1,
            last_accessed: "2026-07-10T14:00:00.000Z",
            timestamp: "2026-07-10T14:00:00.000Z",
            continuity: activeContinuity,
          },
        ],
        procedures: [
          {
            procedure_id: "procedure-1",
            agent_id: "agent-1",
            name: "release_deploy",
            trigger: "deploy release",
            steps: ["Build", "Run smoke tests", "Publish"],
            context_constraints: {},
            success_rate: 0.91,
            execution_count: 7,
            last_used: "2026-07-10T14:00:00.000Z",
            created_at: "2026-07-01T14:00:00.000Z",
            updated_at: "2026-07-10T14:00:00.000Z",
            skill_name: "deploy",
            skill_relevance: 0.94,
            continuity: { ...activeContinuity, pinned: true },
          },
        ],
      },
    },
    memoryConfigs: {
      "agent-1": {
        use_memory: true,
        generate_memory: true,
        write_policy: "approval",
        retrieval_mode: "query_aware",
        allow_user_scope: false,
        allow_project_scope: true,
      },
    },
    memoryTraces: {
      "agent-1": {
        candidate_count: 9,
        selected_count: 3,
        estimated_tokens: 86,
        duration_ms: 2,
        query_aware: true,
        selections: [
          {
            memory_id: "fact-active",
            kind: "fact",
            score: 0.91,
            relevance: 0.85,
            reason: "current_request",
            scope: "agent",
          },
        ],
      },
    },
  });

  await page.goto("/agents/agent-1");
  await expect(page.locator('[data-agent-surface="agent-detail-panel"]')).toBeVisible();
  const memoryTab = page.getByRole("button", { name: "Memory" });
  if (await memoryTab.isVisible()) {
    await memoryTab.click();
  } else {
    await page.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: "Memory" }).click();
  }

  await expect(page.getByText("Agent Continuity")).toBeVisible();
  await expect(page.getByTestId("memory-scope-map")).toContainText("Three memory layers");
  await expect(page.getByRole("combobox", { name: "Memory available in this project" })).toHaveValue("proj-1");
  await expect(page.getByRole("checkbox", { name: /use project-wide memory/i })).toBeChecked();
  await expect(page.getByRole("button", { name: "Project agents" })).toBeVisible();
  await expect(page.getByTestId("continuity-trace").getByText("Request-aware")).toBeVisible();
  await expect(page.getByText("86")).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve memory" })).toBeVisible();
  await page.screenshot({
    path: "output/playwright/agent-continuity-controls.png",
    fullPage: true,
  });
  // Stay one pixel above the app's mobile-shell breakpoint so this exercises
  // the compact desktop continuity panel instead of navigating to mobile IA.
  await page.setViewportSize({ width: 901, height: 844 });
  await expect(page.getByTestId("memory-scope-map")).toBeVisible();
  await expect(page.getByRole("button", { name: "Personal" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({
    path: "output/playwright/agent-continuity-controls-narrow.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 900 });

  const configRequest = page.waitForRequest((request) =>
    request.method() === "PUT" && request.url().endsWith("/memory/continuity"));
  await page.getByRole("checkbox", { name: /use memory/i }).click();
  expect((await configRequest).postDataJSON()).toMatchObject({ use_memory: false });

  const approvalRequest = page.waitForRequest((request) =>
    request.method() === "PUT"
      && new URL(request.url()).pathname.endsWith("/memory/facts/fact-pending"));
  await page.getByRole("button", { name: "Approve memory" }).click();
  expect((await approvalRequest).postDataJSON()).toMatchObject({
    continuity: { status: "active" },
  });
  expect(new URL((await approvalRequest).url()).searchParams.get("project_id")).toBe("proj-1");
  await expect(page.getByRole("button", { name: "Pin memory" })).toHaveCount(2);

  const scopeRequest = page.waitForRequest((request) =>
    request.method() === "PUT"
      && new URL(request.url()).pathname.endsWith("/memory/facts/fact-active"));
  await page.getByRole("combobox", { name: "Memory scope for test_command" }).selectOption("project");
  const promoted = await scopeRequest;
  expect(promoted.postDataJSON()).toMatchObject({ continuity: { scope: "project" } });
  expect(new URL(promoted.url()).searchParams.get("project_id")).toBe("proj-1");

  await page.getByText("test_command", { exact: true }).click();
  await expect(page.getByText("Source session")).toBeVisible();
  await expect(page.getByText("session-42")).toBeVisible();
  await expect(page.getByText("The test command is cargo nextest run.")).toBeVisible();
  await page.getByRole("button", { name: "Correct" }).click();
  await page.getByRole("textbox", { name: "Memory value" }).fill("cargo test --workspace");

  const correctionRequest = page.waitForRequest((request) =>
    request.method() === "PUT"
      && new URL(request.url()).pathname.endsWith("/memory/facts/fact-active"));
  await page.getByRole("button", { name: "Save correction" }).click();
  expect((await correctionRequest).postDataJSON()).toMatchObject({
    value: "cargo test --workspace",
    confidence: 1,
    source: "user_provided",
    continuity: { status: "active", sensitivity: "normal" },
  });
  await expect(page.getByText("cargo test --workspace")).toBeVisible();
  await page.screenshot({
    path: "output/playwright/agent-continuity-correction.png",
    fullPage: true,
  });
});
