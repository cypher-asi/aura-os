import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { interfaceDir, promptfooDir, repoRoot } from "./utils.mjs";

const lanesPath = resolve(repoRoot, "infra", "evals", "lanes.json");

export function loadEvalLaneRegistry() {
  const registry = JSON.parse(readFileSync(lanesPath, "utf8"));
  if (registry?.schemaVersion !== 1 || !registry?.lanes || typeof registry.lanes !== "object") {
    throw new Error(`Invalid eval lane registry at ${lanesPath}`);
  }
  return registry;
}

export function loadEvalLane(laneId) {
  const registry = loadEvalLaneRegistry();
  const lane = registry.lanes[laneId];
  if (!lane) {
    const valid = Object.keys(registry.lanes).sort().join("|");
    throw new Error(`Unknown eval lane "${laneId}". Expected one of: ${valid}`);
  }
  return lane;
}

export function listEvalLaneIds() {
  return Object.keys(loadEvalLaneRegistry().lanes).sort();
}

export function laneWorkingDirectory(lane) {
  switch (lane.cwd) {
    case "interface":
      return interfaceDir;
    case "promptfoo":
      return promptfooDir;
    case undefined:
    case "repo":
      return repoRoot;
    default:
      return resolve(repoRoot, lane.cwd);
  }
}
