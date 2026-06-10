import { existsSync } from "node:fs";
import path from "node:path";

import { loadEvalLaneRegistry, laneWorkingDirectory } from "./lib/eval-lanes.mjs";
import { fail, repoRoot } from "./lib/utils.mjs";

const VALID_INSTALLS = new Set([undefined, "npm-ci"]);
const VALID_BROWSERS = new Set(["chromium", "firefox", "webkit"]);

function assert(condition, message) {
  if (!condition) {
    fail(message);
  }
}

function isStringArray(value) {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string" && entry.length > 0);
}

const registry = loadEvalLaneRegistry();
const laneEntries = Object.entries(registry.lanes);

assert(laneEntries.length > 0, "Eval lane registry must define at least one lane.");

for (const [laneId, lane] of laneEntries) {
  assert(/^[a-z0-9-]+$/.test(laneId), `Eval lane id "${laneId}" must be lowercase kebab-case.`);
  assert(typeof lane.label === "string" && lane.label.length > 0, `Eval lane "${laneId}" is missing label.`);
  assert(isStringArray(lane.riskAreas), `Eval lane "${laneId}" must list riskAreas.`);
  assert(VALID_INSTALLS.has(lane.install), `Eval lane "${laneId}" has unsupported install "${lane.install}".`);
  assert(isStringArray(lane.testCommand), `Eval lane "${laneId}" must define a non-empty testCommand string array.`);
  assert(isStringArray(lane.artifacts), `Eval lane "${laneId}" must define artifact paths.`);

  const cwd = laneWorkingDirectory(lane);
  assert(existsSync(cwd), `Eval lane "${laneId}" cwd does not exist: ${cwd}`);

  if (lane.playwrightBrowsers !== undefined) {
    assert(isStringArray(lane.playwrightBrowsers), `Eval lane "${laneId}" playwrightBrowsers must be strings.`);
    for (const browser of lane.playwrightBrowsers) {
      assert(VALID_BROWSERS.has(browser), `Eval lane "${laneId}" has unsupported browser "${browser}".`);
    }
  }

  if (lane.baseline !== undefined) {
    assert(typeof lane.baseline === "string" && lane.baseline.endsWith(".json"), `Eval lane "${laneId}" baseline must be a JSON path.`);
    assert(existsSync(path.resolve(repoRoot, lane.baseline)), `Eval lane "${laneId}" baseline does not exist: ${lane.baseline}`);
    assert(typeof lane.compareOutput === "string" && lane.compareOutput.length > 0, `Eval lane "${laneId}" with a baseline must set compareOutput.`);
  }

  if (lane.env !== undefined) {
    assert(lane.env && typeof lane.env === "object" && !Array.isArray(lane.env), `Eval lane "${laneId}" env must be an object.`);
  }
}

console.log(`Validated ${laneEntries.length} eval lane(s).`);
