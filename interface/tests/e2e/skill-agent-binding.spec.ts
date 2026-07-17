import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { mockAuthenticatedApp } from "./helpers/mockAuthenticatedApp";

test.use({ serviceWorkers: "block" });

test("custom skill binds and submits an exact collaborating agent", async ({
  page,
}, testInfo) => {
  mkdirSync("test-artifacts/review-shots", { recursive: true });
  const sourceAgentId = "00000000-0000-0000-0000-000000000001";
  const targetAgentId = "00000000-0000-0000-0000-000000000002";
  const baseAgent = {
    user_id: "user-1",
    personality: "Helpful",
    system_prompt: "Help with the project.",
    skills: [],
    icon: null,
    machine_type: "local",
    adapter_type: "aura_harness",
    environment: "desktop",
    auth_source: "user",
    tags: [],
    is_pinned: false,
    permissions: { capabilities: [], scope: {} },
    created_at: "2026-03-17T01:00:00.000Z",
    updated_at: "2026-03-17T01:00:00.000Z",
  };
  await mockAuthenticatedApp(page, {
    agents: [
      {
        ...baseAgent,
        agent_id: sourceAgentId,
        name: "Builder Bot",
        role: "Engineer",
      },
      {
        ...baseAgent,
        agent_id: targetAgentId,
        name: "Research Bot",
        role: "Analyst",
      },
    ],
  });

  const mySkills: Array<Record<string, unknown>> = [];
  let createBody: Record<string, unknown> | null = null;
  await page.route("**/api/harness/skills/mine", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(mySkills),
    });
  });
  await page.route("**/api/harness/skills", async (route) => {
    if (route.request().method() !== "POST") {
      return route.fallback();
    }
    createBody = route.request().postDataJSON() as Record<string, unknown>;
    mySkills.push({
      name: createBody.name,
      description: createBody.description,
      path: `/skills/${createBody.name}/SKILL.md`,
      user_invocable: true,
      model_invocable: false,
    });
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        name: createBody.name,
        path: `/skills/${createBody.name}/SKILL.md`,
        created: true,
        registered: true,
        installed_on_agent: true,
      }),
    });
  });

  await page.goto(`/agents/${sourceAgentId}`);
  await page.getByTitle("Skills").click();
  await expect(page.getByText("My Skills (0)")).toBeVisible();
  await page.getByTitle("Create skill").click();

  const dialog = page.getByRole("dialog");
  await dialog.getByPlaceholder("e.g. deploy", { exact: true }).fill("request-review");
  await dialog
    .getByPlaceholder("e.g. Deploy the application to production")
    .fill("Request a research review");
  await dialog
    .getByPlaceholder("Markdown instructions for this skill...")
    .fill("Send the current proposal to the collaborating agent for review.");
  await dialog.getByRole("button", { name: "Collaborating agent" }).click();
  await page.getByRole("option", { name: "Research Bot — Analyst" }).click();
  await expect(dialog.getByPlaceholder("e.g. deploy", { exact: true })).toHaveValue(
    "request-review",
  );
  await expect(dialog.getByText("Research Bot — Analyst")).toBeVisible();
  await page.waitForTimeout(500);

  const projectName = testInfo.project.name.replace(/\s+/g, "-");
  await page.screenshot({
    path: `test-artifacts/review-shots/${projectName}-skill-agent-binding.png`,
    fullPage: true,
  });

  await dialog.getByRole("button", { name: "Create Skill" }).click();
  await expect.poll(() => createBody).not.toBeNull();
  expect(createBody).toMatchObject({
    name: "request-review",
    description: "Request a research review",
    body: "Send the current proposal to the collaborating agent for review.",
    agent_id: sourceAgentId,
    agent_target: {
      agent_id: targetAgentId,
      name: "Research Bot",
    },
  });
  await expect(page.getByText("My Skills (1)")).toBeVisible();
  await expect(page.getByText("request-review")).toBeVisible();
});
