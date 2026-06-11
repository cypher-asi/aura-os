import { test } from "@playwright/test";

import {
  bootstrapScenarioPage,
  loadBrowserScenarios,
  runBrowserScenario,
  scenarioSupportsDevice,
  writeEvalArtifacts,
} from "./helpers";

test.use({ serviceWorkers: "block" });

const scenarios = await loadBrowserScenarios();

for (const scenario of scenarios) {
  test(`${scenario.title} @smoke`, async ({ page }, testInfo) => {
    test.skip(
      !scenarioSupportsDevice(scenario.devices, testInfo.project.name),
      `Scenario ${scenario.id} does not target ${testInfo.project.name}`,
    );

    // Smoke tests that navigate to project routes require the full
    // standard DesktopShell. Seed the persisted mode before any
    // navigation to keep behaviour deterministic across runs.
    await page.addInitScript(() => {
      localStorage.setItem("aura-ui-mode", "standard");
      localStorage.setItem("aura-sidekick-active-tab", "run");
    });

    await bootstrapScenarioPage(page, scenario);
    const steps = await runBrowserScenario(page, scenario);

    await writeEvalArtifacts(page, testInfo, scenario.id, {
      scenarioId: scenario.id,
      title: scenario.title,
      suite: scenario.suite,
      kind: scenario.kind,
      device: testInfo.project.name,
      bundleId: "browser-smoke-default",
      steps,
      metrics: {
        totalDurationMs: steps.reduce((sum, step) => sum + step.durationMs, 0),
        totalSteps: steps.length,
      },
      finalUrl: page.url(),
    });
  });
}
