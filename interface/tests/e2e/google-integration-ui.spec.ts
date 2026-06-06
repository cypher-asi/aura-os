import { expect, test } from "@playwright/test";

import { mockAuthenticatedApp } from "./helpers/mockAuthenticatedApp";
import { installChatCoreMockApp } from "./evals/chatCoreMockApp";

test.use({ serviceWorkers: "block" });

const googleIntegration = {
  integration_id: "int-google-1",
  org_id: "org-1",
  name: "Google",
  provider: "google",
  kind: "workspace_integration",
  default_model: null,
  has_secret: true,
  secret_last4: null,
  enabled: true,
  provider_config: {
    accountEmail: "google-user@example.com",
    ownerUserId: "user-1",
  },
  created_at: "2026-06-06T01:00:00.000Z",
  updated_at: "2026-06-06T01:00:00.000Z",
};

async function mockGoogleOAuthStart(page: import("@playwright/test").Page) {
  await page.route("**/api/orgs/org-1/integrations/oauth/google/start", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        authorization_url: "http://127.0.0.1:4173/oauth/google/mock?client_id=aura-test",
      }),
    });
  });
}

test("Google integration setup screen has a focused OAuth flow", async ({ page }, testInfo) => {
  await mockAuthenticatedApp(page, { integrations: [], lastAppId: "integrations" });
  await mockGoogleOAuthStart(page);

  await page.goto("/integrations/google");

  await expect(page.getByRole("heading", { name: "Google" })).toBeVisible();
  await expect(page.getByText("Your Google account", { exact: true })).toBeVisible();
  await expect(page.getByText("Not connected")).toBeVisible();
  await expect(page.getByText("Gmail", { exact: true })).toBeVisible();
  await expect(page.getByText("Search, read, and send mail from your account")).toBeVisible();
  await expect(page.getByText("Calendar", { exact: true })).toBeVisible();
  await expect(page.getByText("List calendars and manage events on your account")).toBeVisible();
  await expect(page.getByLabel("Integration name for Google")).toHaveCount(0);

  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Connect Google" }).click();
  const popup = await popupPromise;
  await expect(popup).toHaveURL(/\/oauth\/google\/mock\?client_id=aura-test/);
  await popup.close();

  await expect(page.getByRole("button", { name: "Connect Google" })).toBeEnabled();
  await page.screenshot({
    path: testInfo.outputPath("google-integration-oauth-start.png"),
    fullPage: true,
  });
});

test("connected Google integration clearly shows account, capabilities, and reconnect", async ({
  page,
}, testInfo) => {
  await mockAuthenticatedApp(page, {
    integrations: [googleIntegration],
    lastAppId: "integrations",
  });
  await mockGoogleOAuthStart(page);

  await page.goto("/integrations/google");

  await expect(page.getByRole("heading", { name: "Google" })).toBeVisible();
  await expect(page.getByText("Connected Account")).toBeVisible();
  await expect(page.getByText("google-user@example.com").first()).toBeVisible();
  await expect(page.getByText("Enabled")).toBeVisible();
  await expect(page.getByRole("button", { name: "Reconnect Google" })).toBeVisible();
  await expect(page.getByText("Gmail", { exact: true })).toBeVisible();
  await expect(page.getByText("Calendar", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Integration name for Google")).toBeVisible();

  await page.screenshot({
    path: testInfo.outputPath("google-integration-connected.png"),
    fullPage: true,
  });
});

test("chat renders Google Gmail and Calendar tool usage with readable labels", async ({
  page,
}, testInfo) => {
  const assistantContentBlocks = [
    { type: "text", text: "I will check Gmail and Calendar." },
    {
      type: "tool_use",
      id: "gmail-search-1",
      name: "gmail_search_messages",
      input: { query: "newer_than:7d", max_results: 2 },
    },
    {
      type: "tool_result",
      tool_use_id: "gmail-search-1",
      content: JSON.stringify({ messages: [{ subject: "Project sync" }] }),
      is_error: false,
    },
    {
      type: "tool_use",
      id: "calendar-events-1",
      name: "google_calendar_list_events",
      input: { calendar_id: "primary", max_results: 1, single_events: true },
    },
    {
      type: "tool_result",
      tool_use_id: "calendar-events-1",
      content: JSON.stringify({ events: [{ summary: "Planning review" }] }),
      is_error: false,
    },
    { type: "text", text: " Here are the latest Google results." },
  ];

  const scenario = {
    id: "google-chat-tool-ui",
    suite: "chat-core",
    kind: "agent_chat_core_loop",
    title: "Google chat tool UI",
    devices: ["eval-chat-core-desktop", "eval-chat-core-mobile"],
    project: {
      projectId: "proj-google-ui",
      orgId: "org-google-ui",
      name: "Google UI Project",
      description: "Google tool rendering project",
    },
    agent: {
      agentId: "agent-google-ui",
      agentInstanceId: "agent-inst-google-ui",
      name: "Google Assistant",
      role: "Assistant",
      personality: "Helpful",
      systemPrompt: "Use connected Google tools when needed.",
      machineType: "remote",
      adapterType: "aura_harness",
      defaultModel: "aura-gpt-5-4-mini",
    },
    initialHistory: [],
    turn: {
      input: "Show my recent Gmail and next calendar event.",
      expectedAction: null,
      expectedModel: "aura-gpt-5-4-mini",
      streamEvents: [
        {
          event: "text_delta",
          data: { text: "I will check Gmail and Calendar." },
        },
        {
          event: "tool_use_start",
          data: { id: "gmail-search-1", name: "gmail_search_messages" },
        },
        {
          event: "tool_call",
          data: {
            id: "gmail-search-1",
            name: "gmail_search_messages",
            input: { query: "newer_than:7d", max_results: 2 },
          },
        },
        {
          event: "tool_result",
          data: {
            id: "gmail-search-1",
            name: "gmail_search_messages",
            result: JSON.stringify({ messages: [{ subject: "Project sync" }] }),
            is_error: false,
          },
        },
        {
          event: "tool_use_start",
          data: { id: "calendar-events-1", name: "google_calendar_list_events" },
        },
        {
          event: "tool_call",
          data: {
            id: "calendar-events-1",
            name: "google_calendar_list_events",
            input: { calendar_id: "primary", max_results: 1, single_events: true },
          },
        },
        {
          event: "tool_result",
          data: {
            id: "calendar-events-1",
            name: "google_calendar_list_events",
            result: JSON.stringify({ events: [{ summary: "Planning review" }] }),
            is_error: false,
          },
        },
        {
          event: "text_delta",
          data: { text: " Here are the latest Google results." },
        },
        {
          event: "assistant_message_end",
          data: {
            message_id: "msg-google-ui",
            stop_reason: "end_turn",
            usage: {
              input_tokens: 120,
              output_tokens: 80,
              context_utilization: 0.12,
              estimated_context_tokens: 200,
            },
          },
        },
        {
          event: "message_end",
          data: {
            message_id: "msg-google-ui",
            event: {
              event_id: "evt-google-ui-assistant",
              agent_instance_id: "agent-inst-google-ui",
              project_id: "proj-google-ui",
              role: "assistant",
              content: "I will check Gmail and Calendar. Here are the latest Google results.",
              content_blocks: assistantContentBlocks,
              thinking: null,
              thinking_duration_ms: 0,
              created_at: "2026-06-06T00:00:01.000Z",
            },
          },
        },
        { event: "done", data: { message_id: "msg-google-ui" } },
      ],
      persistedHistory: [
        {
          event_id: "evt-google-ui-user",
          agent_instance_id: "agent-inst-google-ui",
          project_id: "proj-google-ui",
          role: "user",
          content: "Show my recent Gmail and next calendar event.",
          content_blocks: [],
          created_at: "2026-06-06T00:00:00.000Z",
        },
        {
          event_id: "evt-google-ui-assistant",
          agent_instance_id: "agent-inst-google-ui",
          project_id: "proj-google-ui",
          role: "assistant",
          content: "I will check Gmail and Calendar. Here are the latest Google results.",
          content_blocks: assistantContentBlocks,
          thinking: null,
          thinking_duration_ms: 0,
          created_at: "2026-06-06T00:00:01.000Z",
        },
      ],
    },
    verification: {
      visibleTexts: [],
      expectedStreamEventTypes: [],
      expectedStreamRequestCount: 1,
      expectedHistoryRequestMinimum: 1,
      expectedContextUtilization: 0.12,
    },
  } as const;

  const harness = await installChatCoreMockApp(page, scenario as never);

  await page.goto("/projects/proj-google-ui/agents/agent-inst-google-ui");
  const input = page.locator('[data-agent-field="chat-input"]');
  await expect(input).toBeVisible();
  await input.fill("Show my recent Gmail and next calendar event.");

  if (testInfo.project.name.includes("mobile")) {
    await input.press("Enter");
  } else {
    await page.locator('button[aria-label="Send"]:visible').click();
  }

  await expect(page.getByText("Search Gmail")).toBeVisible();
  await expect(page.getByText("List calendar events")).toBeVisible();
  await expect(page.getByText("Here are the latest Google results.")).toBeVisible();
  expect(harness.streamRequests).toHaveLength(1);
  expect(harness.unhandledApiRequests).toEqual([]);

  await page.screenshot({
    path: testInfo.outputPath("google-chat-tool-labels.png"),
    fullPage: true,
  });
});
