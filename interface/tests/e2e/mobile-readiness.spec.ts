import { expect, test } from "@playwright/test";
import { createServer } from "node:http";
import { mockAuthenticatedApp } from "./helpers/mockAuthenticatedApp";

test.use({ serviceWorkers: "block" });
test.beforeEach(async ({ page }) => { await mockAuthenticatedApp(page); });
test.afterEach(async ({ page }, testInfo) => {
  const screenshot = testInfo.outputPath("mobile-screen.png");
  await page.screenshot({ path: screenshot });
  await testInfo.attach("mobile-screen", { path: screenshot, contentType: "image/png" });
  if (testInfo.status !== testInfo.expectedStatus) {
    console.log("mobile overlay geometry", JSON.stringify(await page.evaluate(() => {
      const rows = [];
      let node = document.querySelector('[aria-label="Agent question"]');
      while (node && rows.length < 8) {
        const css = getComputedStyle(node);
        rows.push({ className: node.className, rect: node.getBoundingClientRect().toJSON(), overflow: css.overflow, visibility: css.visibility, maxHeight: css.maxHeight, bottom: css.bottom });
        node = node.parentElement;
      }
      return { width: innerWidth, height: innerHeight, rows };
    })));
  }
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

test("mobile keeps agent attention visible outside the conversation", async ({ page }) => {
  await page.route("**/api/streams/tool-approvals", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        approvals: [{
          request_id: "approval-mobile-1",
          tool_name: "run_command",
          agent_id: "agent-1",
          project_id: "proj-1",
          agent_instance_id: "agent-inst-1",
          session_id: "session-mobile-1",
          started_at_ms: 10,
        }],
      }),
    });
  });
  await page.route("**/api/streams/active", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: "{\"streams\":[]}" });
  });

  await page.goto("/projects/proj-1/files");
  const activity = page.getByRole("button", {
    name: "1 approval waiting. Open waiting approval",
  });
  await expect(activity).toBeInViewport();
  await activity.tap();
  await expect(page).toHaveURL(
    /\/projects\/proj-1\/agents\/agent-inst-1\?session=session-mobile-1$/,
  );
});

test("mobile answers a question raised by a desktop-started agent", async ({ page }) => {
  let pending = true;
  let submittedAnswers: Record<string, unknown> | null = null;
  await page.route("**/api/streams/user-input", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        requests: pending ? [{
          request_id: "input-mobile-1",
          agent_id: "agent-1",
          project_id: "proj-1",
          agent_instance_id: "agent-inst-1",
          session_id: "session-mobile-1",
          started_at_ms: 10,
          questions: [{
            id: "release_scope",
            header: "Release scope",
            question: "Should I include the API changes?",
            options: [
              { label: "Include API", description: "Ship both client and server changes" },
              { label: "Client only", description: "Limit this run to the interface" },
            ],
            multi_select: false,
          }],
        }] : [],
      }),
    });
  });
  await page.route("**/api/streams/user-input/input-mobile-1/respond", async (route) => {
    submittedAnswers = route.request().postDataJSON() as Record<string, unknown>;
    pending = false;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ accepted: true }),
    });
  });
  await page.route("**/api/streams/tool-approvals", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: "{\"approvals\":[]}" });
  });
  await page.route("**/api/streams/active", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: "{\"streams\":[]}" });
  });

  await page.goto("/projects/proj-1/files");
  const activity = page.getByRole("button", {
    name: "1 answer needed. Open agent question",
  });
  await expect(activity).toBeInViewport();
  await activity.tap();
  await expect(page).toHaveURL(
    /\/projects\/proj-1\/agents\/agent-inst-1\?session=session-mobile-1$/,
  );

  const questionCard = page.getByRole("region", { name: "Agent question" });
  // Navigation commits before the cold conversation finishes mounting on
  // slower WebKit runners. Check placement after the form is actually ready.
  await expect(questionCard).toBeVisible({ timeout: 15_000 });
  await expect(questionCard).toBeInViewport();
  await page.getByRole("radio", { name: /Include API/ }).tap();
  await page.getByRole("button", { name: "Continue agent" }).tap();
  await expect.poll(() => submittedAnswers).toEqual({
    answers: { release_scope: "Include API" },
  });
  await expect(page.getByRole("region", { name: "Agent question" })).toHaveCount(0);
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
      Object.defineProperty(window, "androidBridge", { configurable: true, value: {} });
      Object.defineProperty(window, "Capacitor", {
        configurable: true,
        writable: true,
        value: { isNativePlatform: () => true, getPlatform: () => "ios" },
      });
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
    Object.defineProperty(window, "androidBridge", { configurable: true, value: {} });
    Object.defineProperty(window, "Capacitor", {
      configurable: true,
      writable: true,
      value: { isNativePlatform: () => true, getPlatform: () => "ios" },
    });
    Object.defineProperty(window, "webkitSpeechRecognition", { value: class {}, configurable: true });
  });
  await page.goto("/projects/proj-1/agents/agent-inst-1");
  await expect(page.getByRole("textbox", { name: "Message agent" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start voice dictation" })).toHaveCount(0);
});

test("mobile fits a real photo to the upload byte limit before sending it", async ({ page }) => {
  const uploads: Array<{ bytes: number; type: string; magic: string }> = [];
  // WebKit's automation protocol omits binary Blob request bodies. A real
  // local receiver verifies bytes on the wire for both browser engines.
  const receiver = createServer((request, response) => {
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Access-Control-Allow-Methods", "PUT");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (request.method === "OPTIONS") { response.writeHead(204).end(); return; }
    const chunks: Buffer[] = [];
    request.on("data", chunk => chunks.push(Buffer.from(chunk)));
    request.on("end", () => {
      const body = Buffer.concat(chunks);
      uploads.push({ bytes: body.length, type: String(request.headers["content-type"]), magic: body.subarray(0, 2).toString("hex") });
      response.writeHead(200).end();
    });
  });
  await new Promise<void>(resolve => receiver.listen(0, "127.0.0.1", resolve));
  try {
    const address = receiver.address();
    if (!address || typeof address === "string") throw new Error("No photo receiver port");
    await page.route("**/api/upload/presign", async (route) => {
      await route.fulfill({ json: {
        upload_url: `http://127.0.0.1:${address.port}/photo`,
        file_url: "https://files.example/photo.jpg", key: "photo", expires_in: 300,
      } });
    });
    await page.goto("/projects/proj-1/agents/agent-inst-1");
    await expect(page.getByRole("textbox", { name: "Message agent" })).toBeVisible();
    // Real browser PNG decoding and canvas encoding: random opaque pixels
    // produce a photo whose first dimension-limited JPEG can still be too big.
    const data = await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1536;
      const context = canvas.getContext("2d")!;
      const image = context.createImageData(canvas.width, canvas.height);
      let seed = 42;
      for (let i = 0; i < image.data.length; i++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        image.data[i] = i % 4 === 3 ? 255 : seed >>> 24;
      }
      context.putImageData(image, 0, 0);
      return canvas.toDataURL("image/png").split(",")[1];
    });
    const original = Buffer.from(data, "base64");
    expect(original.length).toBeGreaterThan(1_100_000);
    expect(original.length).toBeLessThan(10 * 1024 * 1024);
    await page.locator('[data-agent-surface="mobile-chat-input-bar"] input[type="file"]').setInputFiles({ name: "photo.png", mimeType: "image/png", buffer: original });
    await expect.poll(() => uploads.length).toBe(1);
    expect(uploads[0].bytes).toBeLessThanOrEqual(1_100_000);
    expect(uploads[0].type).toBe("image/jpeg");
    expect(uploads[0].magic).toBe("ffd8");
  } finally {
    receiver.closeAllConnections();
    await new Promise<void>(resolve => receiver.close(() => resolve()));
  }
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
    Object.defineProperty(window, "androidBridge", { configurable: true, value: {} });
    Object.defineProperty(window, "Capacitor", {
      configurable: true,
      writable: true,
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
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "temporary connection failure" }),
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
    client_command_id: expect.any(String),
  });

  // The same environment-owned agent remains useful on a lossy mobile
  // connection: an unacknowledged send stays explicit and controllable.
  const deferredStatus = page.getByRole("status").filter({ hasText: "Waiting to resend" });
  await expect(deferredStatus).toBeVisible();
  const retryNow = page.getByRole("button", { name: "Retry now" });
  const stopRetrying = page.getByRole("button", { name: "Stop retrying" });
  await expect(retryNow).toBeInViewport();
  await expect(stopRetrying).toBeInViewport();

  // Leave the conversation entirely. The command must remain inspectable
  // from the mobile agent library even though its optimistic bubble unmounted.
  await page.goto("/agents");
  const pendingSends = page.getByRole("region", { name: "Unconfirmed agent sends" });
  await expect(pendingSends).toContainText("1 message to check");
  const removePending = pendingSends.getByRole("button", {
    name: "Stop retrying: Reply with Android hosted runtime ready",
  });
  await expect(removePending).toBeInViewport();
  await removePending.tap();
  await expect(pendingSends).toHaveCount(0);

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
