import process from "node:process";

import { loadEvalLane, listEvalLaneIds, laneWorkingDirectory } from "./lib/eval-lanes.mjs";
import {
  assertEvalsRuntime,
  playwrightInstallArgs,
  run,
} from "./lib/utils.mjs";

const [lane] = process.argv.slice(2);

if (!lane) {
  console.error(`Usage: node scripts/ci/verify-evals.mjs <${listEvalLaneIds().join("|")}>`);
  process.exit(1);
}

let config;
try {
  config = loadEvalLane(lane);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

assertEvalsRuntime();

const cwd = laneWorkingDirectory(config);

if (config.install === "npm-ci") {
  run("npm", ["ci"], { cwd, label: "evals:npm-ci", retries: 1 });
}

if (
  Array.isArray(config.playwrightBrowsers)
  && config.playwrightBrowsers.length > 0
  && process.env.AURA_SKIP_PLAYWRIGHT_INSTALL !== "1"
) {
  run("npx", playwrightInstallArgs(config.playwrightBrowsers), {
    cwd,
    label: "evals:playwright-install",
    retries: 1,
  });
} else if (Array.isArray(config.playwrightBrowsers) && config.playwrightBrowsers.length > 0) {
  console.log(
    `\n> [evals:playwright-install] skipping install; AURA_SKIP_PLAYWRIGHT_INSTALL=1 for ${config.playwrightBrowsers.join(", ")}`,
  );
}

run(config.testCommand[0], config.testCommand.slice(1), {
  cwd,
  label: `evals:${lane}`,
  env: {
    ...process.env,
    ...(config.env ?? {}),
  },
});

if (config.report) {
  run("npm", ["run", "test:evals:report"], { cwd, label: "evals:report" });
}

if (config.baseline) {
  run(
    "npm",
    [
      "run",
      "test:evals:compare",
      "--",
      "test-results/aura-evals-summary.json",
      `../${config.baseline}`,
      config.compareOutput ?? `${lane}-compare`,
    ],
    { cwd, label: "evals:compare" },
  );
}
