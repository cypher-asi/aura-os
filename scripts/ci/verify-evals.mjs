import process from "node:process";

import {
  assertEvalsRuntime,
  interfaceDir,
  playwrightInstallArgs,
  promptfooDir,
  run,
} from "./lib/utils.mjs";

const [lane] = process.argv.slice(2);

if (!lane) {
  console.error("Usage: node scripts/ci/verify-evals.mjs <smoke|workflow|behavior|live-benchmark>");
  process.exit(1);
}

switch (lane) {
  case "smoke":
    assertEvalsRuntime();
    run("npm", ["ci"], { cwd: interfaceDir });
    run("npx", playwrightInstallArgs(["chromium", "webkit"]), { cwd: interfaceDir });
    run("npm", ["run", "test:evals:smoke"], { cwd: interfaceDir });
    run("npm", ["run", "test:evals:report"], { cwd: interfaceDir });
    run(
      "npm",
      [
        "run",
        "test:evals:compare",
        "--",
        "test-results/aura-evals-summary.json",
        "../infra/evals/reports/baselines/smoke-summary.json",
        "smoke-compare",
      ],
      { cwd: interfaceDir },
    );
    break;
  case "workflow":
    assertEvalsRuntime();
    run("npm", ["ci"], { cwd: interfaceDir });
    run("npx", playwrightInstallArgs(["chromium"]), { cwd: interfaceDir });
    run("npm", ["run", "test:evals:workflow"], { cwd: interfaceDir });
    run("npm", ["run", "test:evals:report"], { cwd: interfaceDir });
    run(
      "npm",
      [
        "run",
        "test:evals:compare",
        "--",
        "test-results/aura-evals-summary.json",
        "../infra/evals/reports/baselines/workflow-summary.json",
        "workflow-compare",
      ],
      { cwd: interfaceDir },
    );
    break;
  case "behavior":
    assertEvalsRuntime();
    run("npm", ["ci"], { cwd: promptfooDir });
    run("npm", ["run", "eval:ci"], { cwd: promptfooDir });
    break;
  case "live-benchmark":
    assertEvalsRuntime();
    run("npm", ["ci"], { cwd: interfaceDir });
    run("npx", playwrightInstallArgs(["chromium"]), { cwd: interfaceDir });
    run("npm", ["run", "test:evals:benchmark"], {
      cwd: interfaceDir,
      env: {
        ...process.env,
        AURA_EVAL_LIVE: "1",
      },
    });
    run("npm", ["run", "test:evals:report"], { cwd: interfaceDir });
    break;
  default:
    console.error(`Unknown eval lane "${lane}".`);
    process.exit(1);
}
