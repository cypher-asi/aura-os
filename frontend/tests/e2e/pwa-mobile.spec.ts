import { expect, test } from "@playwright/test";
import { mockAuthenticatedApp } from "./helpers/mockAuthenticatedApp";

test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ page }) => {
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
});

const tasks = [
      {
        task_id: "task-1",
        project_id: "proj-1",
        spec_id: "spec-1",
        dependency_ids: [],
        parent_task_id: null,
        session_id: null,
        user_id: "user-1",
        assigned_agent_instance_id: "agent-inst-1",
        title: "Patch auth flow",
        description: "Verify mobile preview parity",
        status: "ready",
        execution_notes: "",
        files_changed: [{ op: "modify", path: "src/auth.ts" }],
        build_steps: [],
        test_steps: [],
        order_index: 0,
        total_input_tokens: 0,
        total_output_tokens: 0,
        model: null,
        live_output: "",
        created_at: "2026-03-17T01:00:00.000Z",
        updated_at: "2026-03-17T01:00:00.000Z",
      },
];

const specs = [
      {
        spec_id: "spec-1",
        project_id: "proj-1",
        title: "Mobile parity spec",
        markdown_contents: "# Mobile parity",
        order_index: 0,
        created_at: "2026-03-17T01:00:00.000Z",
        updated_at: "2026-03-17T01:00:00.000Z",
      },
];

async function mockAuthenticatedMobileApp(page: import("@playwright/test").Page) {
  const agentInstance = {
    agent_instance_id: "agent-inst-1",
    project_id: "proj-1",
    agent_id: "agent-1",
    name: "Builder Bot",
    role: "Engineer",
    personality: "Helpful",
    system_prompt: "Build features carefully.",
    skills: [],
    icon: null,
    status: "idle",
    current_task_id: null,
    current_session_id: null,
    total_input_tokens: 0,
    total_output_tokens: 0,
    created_at: "2026-03-17T01:00:00.000Z",
    updated_at: "2026-03-17T01:00:00.000Z",
  };

  const agents = [
    {
      agent_id: "agent-1",
      user_id: "user-1",
      name: "Builder Bot",
      role: "Engineer",
      personality: "Helpful",
      system_prompt: "Build features carefully.",
      skills: [],
      icon: null,
      created_at: "2026-03-17T01:00:00.000Z",
      updated_at: "2026-03-17T01:00:00.000Z",
    },
    {
      agent_id: "agent-2",
      user_id: "user-1",
      name: "Research Bot",
      role: "Analyst",
      personality: "Curious",
      system_prompt: "Research carefully.",
      skills: [],
      icon: null,
      created_at: "2026-03-17T01:00:00.000Z",
      updated_at: "2026-03-17T01:00:00.000Z",
    },
  ];

  await mockAuthenticatedApp(page, {
    agentInstances: [agentInstance],
    agents,
    tasks,
    specs,
  });
}

test("mobile login page renders with PWA metadata", async ({ page }) => {
  await page.goto("/login");

  await expect(page).toHaveTitle(/AURA/);
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#05070d");
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", "/manifest.webmanifest");
  await expect(page.getByText("Sign in required")).toBeVisible();
  await expect(page.getByRole("button", { name: "Change host" })).toBeVisible();
  await expect(page.getByPlaceholder("Email")).toBeVisible();
  await expect(page.locator("form").getByRole("button", { name: "Sign In" })).toBeVisible();
});

test("mobile login page can open host settings", async ({ page }) => {
  await page.goto("/login");

  await page.getByRole("button", { name: "Change host" }).click();

  await expect(page.getByRole("heading", { name: "Host Connection" })).toBeVisible();
  await expect(page.getByPlaceholder("192.168.1.20:5173")).toBeVisible();
});

test("mobile project header can switch between execution and chat", async ({ page }) => {
  await mockAuthenticatedMobileApp(page);

  await page.goto("/projects/proj-1/agents/agent-inst-1");

  await expect(page.getByText("Demo Project")).toBeVisible();
  await expect(page.getByRole("button", { name: "Chat" })).toBeVisible({ timeout: 10000 });
  await expect(page.getByText("Send a message or use a quick action to get started")).toBeVisible();

  await page.getByRole("button", { name: "Execution" }).click();
  await expect(page).toHaveURL(/\/projects\/proj-1\/execution$/);
});

test("mobile projects route keeps the welcome view and opens project navigation", async ({ page }) => {
  await mockAuthenticatedMobileApp(page);

  await page.goto("/projects");

  await expect(page.getByText("Pick up work without hunting through the app.")).toBeVisible();
  await expect(page.getByText("Recent projects")).toBeVisible();
  await expect(page.getByRole("button", { name: "Execution" })).toHaveCount(0);

  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(page.getByPlaceholder("Search Projects...")).toBeVisible();
  await expect(page.getByRole("button", { name: "Team settings" })).toBeVisible();
});

test("mobile drawer exposes team and app settings", async ({ page }) => {
  await mockAuthenticatedMobileApp(page);

  await page.goto("/projects/proj-1/execution");

  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(page.getByRole("button", { name: "Team settings" })).toBeVisible();
  await expect(page.getByRole("button", { name: "App settings" })).toBeVisible();
  await page.getByRole("button", { name: "App settings" }).dispatchEvent("click");
  await expect(page.getByRole("dialog").filter({ hasText: "Claude API Key" })).toBeVisible();
  await expect(page.getByText("Claude API Key")).toBeVisible();
  await expect(page.getByText("Updates")).toHaveCount(0);
});

test("mobile new project modal presents local file actions", async ({ page, browserName }) => {
  test.skip(browserName === "webkit", "Headless WebKit is flaky opening the drawer-triggered modal; Chromium covers the local file flow.");
  await mockAuthenticatedMobileApp(page);

  await page.goto("/projects");

  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(page.getByTitle("New Project")).toBeVisible();
  await page.getByTitle("New Project").click({ force: true });

  await expect(page.getByPlaceholder("Project name")).toBeVisible();
  await expect(page.getByText("Choose a folder or files from this device to start a project.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Open folder" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Choose files" })).toBeVisible();
  await expect(page.getByText("Aura prepares a workspace from the selected local files on the connected host so you can keep working from the browser.")).toBeVisible();
});

test("mobile file selection keeps the new project modal open", async ({ page, browserName }) => {
  test.skip(browserName === "webkit", "Headless WebKit is flaky opening the drawer-triggered modal; Chromium covers the local file flow.");
  await mockAuthenticatedMobileApp(page);

  await page.goto("/projects");

  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByTitle("New Project").click({ force: true });

  await expect(page.getByPlaceholder("Project name")).toBeVisible();

  await page.locator('input[type="file"]').nth(1).setInputFiles({
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("hello aura"),
  });

  await expect(page.getByPlaceholder("Project name")).toBeVisible();
  await expect(page.getByText("1 file selected")).toBeVisible();
  await expect(page.getByText("notes.txt")).toBeVisible();
});

test("mobile new project modal restores after a reload-like remount", async ({ page, browserName }) => {
  test.skip(browserName === "webkit", "Headless WebKit is flaky opening the drawer-triggered modal; Chromium covers the local file flow.");
  await mockAuthenticatedMobileApp(page);

  await page.goto("/projects");

  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByTitle("New Project").click({ force: true });

  await page.getByPlaceholder("Project name").fill("Restore me");
  await page.getByPlaceholder("Description (optional)").fill("Android lifecycle check");
  await page.locator('input[type="file"]').nth(1).setInputFiles({
    name: "restore.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("persist me"),
  });

  await page.reload();

  await expect(page.getByPlaceholder("Project name")).toHaveValue("Restore me");
  await expect(page.getByPlaceholder("Description (optional)")).toHaveValue("Android lifecycle check");
  await expect(page.getByText("1 file selected")).toBeVisible();
  await expect(page.getByText("restore.txt")).toBeVisible();
});

test("mobile details selection auto-opens preview", async ({ page }) => {
  await mockAuthenticatedMobileApp(page);

  await page.goto("/projects/proj-1/execution");

  await page.getByRole("button", { name: "Open details" }).click();
  await expect(page.getByRole("treeitem", { name: "Patch auth flow" })).toBeVisible();
  await page.getByRole("treeitem", { name: "Patch auth flow" }).dispatchEvent("click");

  await expect(page.getByText("Open changed files from a linked desktop workspace.")).toBeVisible();
});

test("mobile team settings opens above the closed navigation drawer", async ({ page }) => {
  await mockAuthenticatedMobileApp(page);

  await page.goto("/projects/proj-1/execution");

  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(page.getByRole("button", { name: "Team settings" })).toBeVisible();
  await page.getByRole("button", { name: "Team settings" }).dispatchEvent("click");

  await expect(page.getByRole("dialog").filter({ hasText: "Team Settings" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Team Settings" })).toBeVisible();
});

test("mobile agent header can switch between agents", async ({ page }) => {
  await mockAuthenticatedMobileApp(page);

  await page.goto("/agents/agent-1");

  const agentSelect = page.getByRole("combobox", { name: "Choose agent" });
  await expect(agentSelect).toBeVisible();
  await expect(agentSelect).toHaveValue("agent-1");
  await expect(page.getByText("Engineer").first()).toBeVisible();
  await expect(page.getByText("Chat with Builder Bot")).toBeVisible();

  await agentSelect.selectOption({ label: "Research Bot" });

  await expect(page).toHaveURL(/\/agents\/agent-2$/);
  await expect(page.getByText("Chat with Research Bot")).toBeVisible();
});

test("manifest and service worker assets are reachable", async ({ page }) => {
  const manifestResponse = await page.request.get("/manifest.webmanifest");
  expect(manifestResponse.ok()).toBeTruthy();

  const manifest = await manifestResponse.json();
  expect(manifest.name).toBe("Aura Mobile Companion");
  expect(manifest.display).toBe("standalone");
  expect(manifest.icons).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ src: "/pwa-192.png" }),
      expect.objectContaining({ src: "/pwa-512.png" }),
    ]),
  );

  const swResponse = await page.request.get("/sw.js");
  expect(swResponse.ok()).toBeTruthy();
  expect(await swResponse.text()).toContain("STATIC_CACHE");
});

test("service worker registers in chromium", async ({ page, context, browserName }) => {
  test.skip(browserName !== "chromium", "Playwright only exposes service workers in Chromium.");

  await page.goto("/login");
  await page.evaluate(async () => {
    if (!("serviceWorker" in navigator)) return;
    await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;
  });

  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  expect(worker.url()).toContain("/sw.js");
});
