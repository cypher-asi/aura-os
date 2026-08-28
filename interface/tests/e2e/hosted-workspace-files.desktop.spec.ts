import { expect, test } from "@playwright/test";
import { mockAuthenticatedApp } from "./helpers/mockAuthenticatedApp";

const hostedAgent = {
  agent_instance_id: "agent-inst-hosted",
  project_id: "proj-1",
  agent_id: "agent-1",
  name: "Builder Bot",
  role: "Engineer",
  personality: "Helpful",
  system_prompt: "Build features carefully.",
  skills: [],
  icon: null,
  machine_type: "local",
  workspace_path: null,
  environment: "local_host",
  auth_source: "aura_managed",
  adapter_type: "aura_harness",
  status: "idle",
  current_task_id: null,
  current_session_id: null,
  total_input_tokens: 0,
  total_output_tokens: 0,
  created_at: "2026-03-17T01:00:00.000Z",
  updated_at: "2026-03-17T01:00:00.000Z",
};

test("hosted web shows the authoritative agent file tree beside Preview", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    localStorage.setItem("aura-ui-mode", "standard");
    localStorage.setItem("aura-sidekick-active-tab", "browser");
  });
  await mockAuthenticatedApp(page, {
    agentInstances: [hostedAgent],
  });

  const workspaceEntries = [
    { name: "index.html", path: "index.html", is_dir: false },
    {
      name: "src",
      path: "src",
      is_dir: true,
      children: [
        { name: "app.ts", path: "src/app.ts", is_dir: false },
        { name: "styles.css", path: "src/styles.css", is_dir: false },
      ],
    },
    { name: "package.json", path: "package.json", is_dir: false },
  ];
  const workspaceFiles: Record<string, string> = {
    "index.html": "<!doctype html><title>Authoritative hosted file</title>",
    "src/app.ts": "export const source = 'hosted harness';",
    "src/styles.css": "body { color: white; }",
    "package.json": "{\"scripts\":{\"dev\":\"vite\"}}",
  };
  await page.route("**/api/system/runtime-capabilities", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        remoteOnly: false,
        localAgentRuntimeAvailable: true,
        hostedLocalHarness: true,
      }),
    }),
  );
  await page.route(
    "**/api/projects/proj-1/agents/agent-inst-hosted/workspace/files",
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, entries: workspaceEntries }),
      }),
  );
  await page.route(
    "**/api/projects/proj-1/agents/agent-inst-hosted/workspace/read-file?*",
    (route) => {
      const filePath = new URL(route.request().url()).searchParams.get("path") ?? "";
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          path: filePath,
          content: workspaceFiles[filePath] ?? "",
        }),
      });
    },
  );

  await page.goto("/projects/proj-1/agents/agent-inst-hosted");

  const previewTab = page.getByRole("button", { name: "Preview" });
  const filesTab = page.getByRole("button", { name: "Files" });
  await expect(previewTab).toBeVisible();
  await expect(filesTab).toBeVisible();

  const previewBox = await previewTab.boundingBox();
  const filesBox = await filesTab.boundingBox();
  expect(previewBox).not.toBeNull();
  expect(filesBox).not.toBeNull();
  expect(filesBox!.x).toBeGreaterThan(previewBox!.x);
  expect(filesBox!.x - (previewBox!.x + previewBox!.width)).toBeLessThan(20);

  await filesTab.click();
  await expect(page.getByText("Project files").first()).toBeVisible();
  await expect(page.getByText("index.html")).toBeVisible();
  await expect(page.getByText("src")).toBeVisible();
  await expect(page.getByText("app.ts")).toBeVisible();
  await expect(page.getByText("package.json")).toBeVisible();

  await page.screenshot({
    path: testInfo.outputPath("hosted-workspace-files.png"),
    fullPage: true,
  });

  await page.getByText("index.html").click();
  await expect(page).toHaveURL(/\/ide\?.*file=index\.html/);
  await expect(page.locator("textarea")).toHaveValue(
    "<!doctype html><title>Authoritative hosted file</title>",
  );
  await expect(page.getByText(/Hosted workspace preview is read-only/)).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("hosted-workspace-file-preview.png"),
    fullPage: true,
  });
});
