import { expect, test } from "@playwright/test";

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
  await page.unroute("**/api/auth/session");
  await page.unroute("**/api/auth/validate");

  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const path = `${url.pathname}${url.search}`;

    const session = {
      user_id: "user-1",
      display_name: "Test User",
      profile_image: "",
      primary_zid: "0://test-user",
      zero_wallet: "0x123",
      wallets: ["0x123"],
      created_at: "2026-03-17T01:00:00.000Z",
      validated_at: "2026-03-17T01:00:00.000Z",
    };

    const project = {
      project_id: "proj-1",
      org_id: "org-1",
      name: "Demo Project",
      description: "Parity test project",
      linked_folder_path: "/tmp/demo-project",
      current_status: "active",
      created_at: "2026-03-17T01:00:00.000Z",
      updated_at: "2026-03-17T01:00:00.000Z",
    };

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

    const json = (body: unknown) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(body),
      });

    if (path === "/api/auth/session") return json(session);
    if (path === "/api/auth/validate") return json(session);
    if (path === "/api/update-status") {
      return json({ update: { status: "idle" }, channel: "stable", current_version: "0.0.0" });
    }
    if (path === "/api/orgs") {
      return json([
        {
          org_id: "org-1",
          name: "Test Org",
          owner_user_id: "user-1",
          billing: null,
          github: null,
          created_at: "2026-03-17T01:00:00.000Z",
          updated_at: "2026-03-17T01:00:00.000Z",
        },
      ]);
    }
    if (path === "/api/orgs/org-1/members") {
      return json([
        {
          org_id: "org-1",
          user_id: "user-1",
          display_name: "Test User",
          role: "owner",
          joined_at: "2026-03-17T01:00:00.000Z",
        },
      ]);
    }
    if (path === "/api/orgs/org-1/credits/balance") {
      return json({ total_credits: 1200, purchases: [] });
    }
    if (path === "/api/projects?org_id=org-1") {
      return json([project]);
    }
    if (path === "/api/projects/proj-1") return json(project);
    if (path === "/api/projects/proj-1/specs") return json([]);
    if (path === "/api/projects/proj-1/tasks") return json([]);
    if (path === "/api/projects/proj-1/agents") return json([agentInstance]);
    if (path === "/api/projects/proj-1/agents/agent-inst-1") return json(agentInstance);
    if (path === "/api/projects/proj-1/agents/agent-inst-1/messages") return json([]);
    if (path === "/api/projects/proj-1/agents/agent-inst-1/sessions") return json([]);
    if (path === "/api/projects/proj-1/loop/status") {
      return json({ running: false, paused: false, project_id: "proj-1", active_agent_instances: [] });
    }
    if (path === "/api/projects/proj-1/progress") {
      return json({
        project_id: "proj-1",
        total_tasks: 0,
        pending_tasks: 0,
        ready_tasks: 0,
        in_progress_tasks: 0,
        blocked_tasks: 0,
        done_tasks: 0,
        failed_tasks: 0,
        completion_percentage: 0,
        total_tokens: 0,
        total_cost: 0,
        lines_changed: 0,
        lines_of_code: 0,
        total_commits: 0,
        total_pull_requests: 0,
        total_messages: 0,
        total_agents: 1,
        total_sessions: 0,
        total_tests: 0,
      });
    }

    return route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ error: `Unhandled route: ${path}` }),
    });
  });

  await page.goto("/projects/proj-1/execution");

  await expect(page.getByText("Demo Project")).toBeVisible();
  await page.getByRole("button", { name: "Chat" }).click();
  await expect(page).toHaveURL(/\/projects\/proj-1\/agents\/agent-inst-1$/);
  await expect(page.getByText("Send a message or use a quick action to get started")).toBeVisible();

  await page.getByRole("button", { name: "Execution" }).click();
  await expect(page).toHaveURL(/\/projects\/proj-1\/execution$/);
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
