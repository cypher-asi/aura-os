import path from "node:path";
import {
  getHarnessBenchmarkScenario,
  prepareHarnessBenchmarkWorkspace,
} from "../../lib/harness-benchmark-scenarios.mjs";

function buildScenario(interfaceRoot, definition) {
  const baseScenario = getHarnessBenchmarkScenario(interfaceRoot, definition.baseScenarioId);
  if (!baseScenario) {
    throw new Error(`Unknown base scenario: ${definition.baseScenarioId}`);
  }

  return {
    id: definition.id,
    title: definition.title,
    adapterMode: definition.adapterMode ?? "single-shot",
    baseScenarioId: definition.baseScenarioId,
    prompt: definition.prompt,
    fixtureDir: baseScenario.fixtureDir ?? null,
    requiredFiles: baseScenario.requiredFiles ?? [],
    validationCommand: baseScenario.validationCommand ?? null,
    expectedTerms: baseScenario.expectedTerms ?? [],
    preferredTools: baseScenario.preferredTools ?? [],
  };
}

export function getExternalAgentScenarios(interfaceRoot) {
  return {
    "external-static-site": buildScenario(interfaceRoot, {
      id: "external-static-site",
      title: "External Agent Static Site",
      baseScenarioId: "harness-fixture-static-site",
      prompt: [
        "Read `requirements.md` and inspect the current files in this workspace.",
        "Implement the required static page exactly as specified.",
        "Keep the project dependency-free.",
        "Do not add build tooling.",
        "Before finishing, verify the required strings are present and summarize the exact files you changed.",
      ].join("\n"),
    }),
    "external-node-server-patch": buildScenario(interfaceRoot, {
      id: "external-node-server-patch",
      title: "External Agent Node Server Patch",
      baseScenarioId: "harness-fixture-node-server-patch",
      prompt: [
        "Read `requirements.md` and inspect the current project files, especially `server.js`.",
        "Patch the existing server so it satisfies the requirements while keeping the project dependency-free.",
        "Preserve `process.env.PORT` support.",
        "Before finishing, verify the homepage strings and `/health` route behavior, then summarize the exact files you changed.",
      ].join("\n"),
    }),
  };
}

export function getExternalAgentScenario(interfaceRoot, scenarioId) {
  const scenarios = getExternalAgentScenarios(interfaceRoot);
  return scenarios[scenarioId] ?? scenarios["external-static-site"];
}

export async function prepareExternalAgentWorkspace(interfaceRoot, scenario, workspaceDir) {
  const baseScenario = getHarnessBenchmarkScenario(interfaceRoot, scenario.baseScenarioId);
  await prepareHarnessBenchmarkWorkspace(interfaceRoot, baseScenario, workspaceDir);
}

export function defaultExternalAgentResultsDir(interfaceRoot) {
  return path.join(interfaceRoot, "test-results");
}
