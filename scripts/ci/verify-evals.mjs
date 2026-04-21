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
    run("npm", ["ci"], { cwd: interfaceDir, label: "evals:npm-ci", retries: 1 });
    run("npx", playwrightInstallArgs(["chromium", "webkit"]), {
      cwd: interfaceDir,
      label: "evals:playwright-install",
      retries: 1,
    });
    run("npm", ["run", "test:evals:smoke", "--", "--retries=1"], {
      cwd: interfaceDir,
      label: "evals:smoke",
    });
    run("npm", ["run", "test:evals:report"], { cwd: interfaceDir, label: "evals:report" });
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
      { cwd: interfaceDir, label: "evals:compare" },
    );
    break;
  case "workflow":
    assertEvalsRuntime();
    run("npm", ["ci"], { cwd: interfaceDir, label: "evals:npm-ci", retries: 1 });
    run("npx", playwrightInstallArgs(["chromium"]), {
      cwd: interfaceDir,
      label: "evals:playwright-install",
      retries: 1,
    });
    run("npm", ["run", "test:evals:workflow", "--", "--retries=1"], {
      cwd: interfaceDir,
      label: "evals:workflow",
    });
    run("npm", ["run", "test:evals:report"], { cwd: interfaceDir, label: "evals:report" });
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
      { cwd: interfaceDir, label: "evals:compare" },
    );
    break;
  case "behavior":
    assertEvalsRuntime();
    run("npm", ["ci"], { cwd: promptfooDir, label: "evals:npm-ci", retries: 1 });
    run("npm", ["run", "eval:ci"], { cwd: promptfooDir, label: "evals:behavior" });
    break;
  case "live-benchmark":
    assertEvalsRuntime();
    run("npm", ["ci"], { cwd: interfaceDir, label: "evals:npm-ci", retries: 1 });
    run("npx", playwrightInstallArgs(["chromium"]), {
      cwd: interfaceDir,
      label: "evals:playwright-install",
      retries: 1,
    });
    run("npm", ["run", "test:evals:benchmark"], {
      cwd: interfaceDir,
      label: "evals:live-benchmark",
      env: {
        ...process.env,
        AURA_EVAL_LIVE: "1",
      },
    });
    run("npm", ["run", "test:evals:report"], { cwd: interfaceDir, label: "evals:report" });
    break;
  default:
    console.error(`Unknown eval lane "${lane}".`);
    process.exit(1);
}
