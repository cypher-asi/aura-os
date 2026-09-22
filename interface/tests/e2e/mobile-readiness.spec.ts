import { expect, test } from "@playwright/test";
import { mockAuthenticatedApp } from "./helpers/mockAuthenticatedApp";

test.use({ serviceWorkers: "block" });
test.beforeEach(async ({ page }) => { await mockAuthenticatedApp(page); });
test.afterEach(async ({ page }, testInfo) => {
  await testInfo.attach("mobile-screen", { body: await page.screenshot(), contentType: "image/png" });
});

test("mobile navigation keeps all five tabs visible and exposes Process and Stats under More", async ({ page }) => {
  await page.goto("/projects/proj-1/agents");
  const nav = page.getByRole("navigation", { name: "Project sections" });
  await expect(nav.getByRole("button")).toHaveText(["Agents", "Files", "Tasks", "Run", "More"]);
  for (const button of await nav.getByRole("button").all()) await expect(button).toBeInViewport();
  await nav.getByRole("button", { name: "More", exact: true }).tap();
  const menu = page.getByRole("menu", { name: "More project sections" });
  await menu.getByRole("menuitem", { name: "Process" }).tap();
  await expect(page.getByText("Project automations")).toBeVisible();
  await expect(menu).toBeVisible();
  await menu.getByRole("menuitem", { name: "Stats" }).tap();
  await expect(page).toHaveURL(/\/stats$/);
  await nav.getByRole("button", { name: "Agents", exact: true }).tap();
  await expect(menu).toHaveCount(0);
  await nav.getByRole("button", { name: "More", exact: true }).tap();
  await page.goto("/projects/proj-1/files");
  await expect(menu).toHaveCount(0);
});

test.describe("tablet reporting a desktop user agent", () => {
  test.use({ viewport: { width: 1024, height: 768 }, hasTouch: true, isMobile: false,
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15" });
  test("can open the project create screen and create from the agent library", async ({ page }) => {
    await page.goto("/projects/proj-1/agents/create");
    await expect(page.getByLabel("Name", { exact: true })).toBeVisible();
    await expect(page).toHaveURL(/\/agents\/create$/);
    await page.goto("/agents");
    await page.getByRole("button", { name: "Create Agent", exact: true }).click();
    await expect(page.getByLabel("Name", { exact: true })).toBeVisible();
  });
});

for (const native of [false, true]) {
  test(`${native ? "native" : "web"} billing preserves the intended purchase controls`, async ({ page }) => {
    if (native) await page.addInitScript(() => {
      Object.defineProperty(window, "Capacitor", { value: { isNativePlatform: () => true, getPlatform: () => "ios" }, configurable: true });
    });
    await page.goto("/projects/organization");
    await page.getByRole("button", { name: "Team settings", exact: true }).click();
    await page.getByRole("button", { name: "Billing", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Billing", exact: true })).toBeInViewport();
    await expect(page.getByText("Current Balance", { exact: true })).toBeVisible();
    if (native) {
      await expect(page.getByRole("button", { name: "Change Plan" })).toHaveCount(0);
      await expect(page.getByText("Credit purchases aren't available in the mobile app.")).toBeVisible();
      await page.getByRole("button", { name: "Rewards", exact: true }).click();
      await expect(page.getByRole("button", { name: "Upgrade", exact: true })).toHaveCount(0);
      await expect(page.getByText("Your Invite Code", { exact: true })).toBeVisible();
    } else {
      await page.getByRole("button", { name: "Change Plan" }).click();
      await expect(page.getByText("CHOOSE YOUR PLAN", { exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Upgrade", exact: true })).toHaveCount(3);
    }
  });
}

test("native chat hides browser dictation even when the WebView exposes the API", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "Capacitor", { value: { isNativePlatform: () => true, getPlatform: () => "ios" }, configurable: true });
    Object.defineProperty(window, "webkitSpeechRecognition", { value: class {}, configurable: true });
  });
  await page.goto("/projects/proj-1/agents/agent-inst-1");
  await expect(page.getByRole("textbox", { name: "Message agent" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start voice dictation" })).toHaveCount(0);
});

test("native mobile creates a hosted web agent without provisioning a remote VM", async ({ page }) => {
  const hostedAgent = {
    agent_id: "agent-mobile-hosted",
    user_id: "user-1",
    org_id: "org-1",
    name: "mobile_hosted_test",
    role: "Engineer",
    personality: "Helpful",
    system_prompt: "Build carefully.",
    skills: [],
    icon: null,
    machine_type: "local",
    adapter_type: "aura_harness",
    environment: "local_host",
    auth_source: "aura_managed",
    created_at: "2026-03-17T01:00:00.000Z",
    updated_at: "2026-03-17T01:00:00.000Z",
  };
  const hostedInstance = {
    agent_instance_id: "agent-inst-mobile-hosted",
    project_id: "proj-1",
    agent_id: hostedAgent.agent_id,
    name: hostedAgent.name,
    role: hostedAgent.role,
    personality: hostedAgent.personality,
    system_prompt: hostedAgent.system_prompt,
    skills: [],
    icon: null,
    machine_type: "local",
    workspace_path: null,
    status: "idle",
    current_task_id: null,
    current_session_id: null,
    total_input_tokens: 0,
    total_output_tokens: 0,
    created_at: "2026-03-17T01:00:00.000Z",
    updated_at: "2026-03-17T01:00:00.000Z",
  };

  await mockAuthenticatedApp(page, {
    agents: [hostedAgent],
    agentInstances: [],
    hostedLocalHarness: true,
  });
  await page.addInitScript(() => {
    Object.defineProperty(window, "Capacitor", {
      configurable: true,
      value: { isNativePlatform: () => true, getPlatform: () => "android" },
    });
  });

  let createPayload: Record<string, unknown> | null = null;
  let promptPayload: Record<string, unknown> | null = null;
  let remoteProvisioningRequests = 0;
  await page.route("**/api/agents/*/remote_agent/**", async (route) => {
    remoteProvisioningRequests += 1;
    await route.fallback();
  });
  await page.route("**/api/agents", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    createPayload = JSON.parse(route.request().postData() || "{}");
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(hostedAgent) });
  });
  await page.route("**/api/projects/proj-1/agents", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(hostedInstance) });
  });
  await page.route("**/api/projects/proj-1/agents/agent-inst-mobile-hosted**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.endsWith("/events/stream") && route.request().method() === "POST") {
      promptPayload = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: "event: done\ndata: {}\n\n",
      });
      return;
    }
    const isCollection = /\/(messages|events|sessions)$/.test(pathname);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(isCollection ? [] : hostedInstance),
    });
  });

  // Agents created on web use the same hosted Harness runtime. Android must
  // show and attach them without trying to provision a confidential VM.
  await page.goto("/projects/proj-1/agents/attach");
  const availableAgents = page.locator(
    '[data-agent-surface="available-agent-list"][data-agent-list-state="ready"]',
  );
  await expect(availableAgents).toBeVisible();
  const hostedAgentCard = availableAgents.locator(
    `[data-agent-action="attach-existing-agent"][data-agent-agent-id="${hostedAgent.agent_id}"]`,
  );
  await expect(hostedAgentCard).toBeVisible();
  // WebKit can detach this card while the capability/list projections settle.
  // Resolve the semantic locator and invoke its native click in one browser
  // task so a transient React replacement cannot split actionability checks
  // from the actual activation.
  await hostedAgentCard.evaluate((button: HTMLButtonElement) => button.click());
  await expect(page).toHaveURL(/\/projects\/proj-1\/agents\/agent-inst-mobile-hosted$/);
  const chatInput = page.getByRole("textbox", { name: "Message agent" });
  await chatInput.fill("Reply with Android hosted runtime ready");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect.poll(() => promptPayload).toMatchObject({
    content: "Reply with Android hosted runtime ready",
  });

  await page.goto("/projects/proj-1/agents/create");
  const hostedButton = page.getByRole("button", { name: "Hosted", exact: true });
  await expect(hostedButton).toBeVisible();
  await expect(hostedButton).toHaveClass(/envOptionActive/);
  await expect(page.getByText("Runs on AURA's server. No desktop connection required.")).toBeVisible();

  await page.getByLabel("Name", { exact: true }).fill(hostedAgent.name);
  await page.getByRole("button", { name: "Create Agent", exact: true }).click();

  await expect(page).toHaveURL(/\/projects\/proj-1\/agents\/agent-inst-mobile-hosted$/);
  await expect(page.getByRole("textbox", { name: "Message agent" })).toBeEnabled();
  expect(createPayload).toMatchObject({
    machine_type: "local",
    environment: "local_host",
    adapter_type: "aura_harness",
  });
  expect(remoteProvisioningRequests).toBe(0);
});
