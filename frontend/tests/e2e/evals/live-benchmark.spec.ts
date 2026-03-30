import { test } from "@playwright/test";

import {
  loadLiveBenchmarkScenarios,
  runLiveBenchmarkScenario,
  scenarioSupportsDevice,
  writeEvalArtifacts,
} from "./helpers";

test.use({ serviceWorkers: "block" });
test.describe.configure({ mode: "serial" });

const scenarios = await loadLiveBenchmarkScenarios();

for (const scenario of scenarios) {
  test(`${scenario.title} @benchmark`, async ({ page }, testInfo) => {
    test.setTimeout(Math.max(10 * 60_000, scenario.timeouts.loopCompletionMs + 180_000));
    test.skip(process.env.AURA_EVAL_LIVE !== "1", "Live benchmark lane runs only when AURA_EVAL_LIVE=1.");
    test.skip(
      !scenarioSupportsDevice(scenario.devices, testInfo.project.name),
      `Scenario ${scenario.id} does not target ${testInfo.project.name}`,
    );

    const accessToken = process.env.AURA_EVAL_ACCESS_TOKEN;
    const email = process.env.AURA_EVAL_USER_EMAIL;
    const password = process.env.AURA_EVAL_USER_PASSWORD;
    test.skip(
      !accessToken && (!email || !password),
      "Set AURA_EVAL_ACCESS_TOKEN or AURA_EVAL_USER_EMAIL and AURA_EVAL_USER_PASSWORD to run live benchmarks.",
    );

    const summary = accessToken
      ? await runLiveBenchmarkScenario(page, scenario, { accessToken })
      : await runLiveBenchmarkScenario(page, scenario, {
          email: email!,
          password: password!,
        });

    await writeEvalArtifacts(page, testInfo, scenario.id, {
      ...summary,
      suite: scenario.suite,
      kind: scenario.kind,
      device: testInfo.project.name,
      bundleId: process.env.AURA_EVAL_BUNDLE_ID ?? "live-default",
    });
  });
}
