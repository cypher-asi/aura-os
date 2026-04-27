#!/usr/bin/env node
/**
 * Aggregate Terminal-Bench output + per-task AURA telemetry into score.json.
 *
 * CLI:
 *   node infra/evals/external/tbench/bin/aggregate-score.mjs \
 *     --out <run-dir> [--subset smoke|full] [--dataset name] \
 *     [--wallclock seconds] [--git-sha sha]
 *
 * Reads:
 *   <run-dir>/tb-output/**\/results.json (or any *.json TB happens to write)
 *   <run-dir>/runs/*.json                (per-task AURA records)
 *
 * Writes:
 *   <run-dir>/score.json
 */

import { promises as fs } from "node:fs";
import path from "node:path";

const SMOKE_CONFIDENCE_NOTE_TEMPLATE = (n) =>
  `Smoke run with ${n} task${n === 1 ? "" : "s"} has low statistical power. ` +
  `Not a leaderboard-defensible number; the full T-Bench run is required for that.`;

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const value = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : "";
    if (value !== "") {
      args[key] = value;
      i += 1;
    } else {
      args[key] = "true";
    }
  }
  return args;
}

async function pathExists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function readJsonSafe(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function walkJsonFiles(rootDir) {
  const collected = [];
  if (!(await pathExists(rootDir))) return collected;
  const stack = [rootDir];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const absolutePath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(absolutePath);
        continue;
      }
      if (entry.isFile() && entry.name.toLowerCase().endsWith(".json")) {
        collected.push(absolutePath);
      }
    }
  }
  return collected;
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function asNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function deriveStatusFromTbEntry(entry) {
  if (!isRecord(entry)) return null;
  const explicit =
    entry.status
    ?? entry.outcome
    ?? entry.result
    ?? (typeof entry.passed === "boolean"
      ? entry.passed
        ? "passed"
        : "failed"
      : null);
  if (typeof explicit !== "string" || explicit.length === 0) return null;
  const normalized = explicit.toLowerCase();
  if (normalized.includes("pass")) return "passed";
  if (normalized.includes("fail")) return "failed";
  if (normalized.includes("timeout")) return "agent_timeout";
  if (normalized.includes("error")) return "agent_error";
  return normalized;
}

function pickTaskId(entry) {
  if (!isRecord(entry)) return null;
  for (const key of ["task_id", "taskId", "id", "name", "task"]) {
    const value = entry[key];
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  return null;
}

function flattenTbEntries(payload) {
  if (Array.isArray(payload)) return payload;
  if (!isRecord(payload)) return [];
  for (const key of ["results", "tasks", "instances", "items"]) {
    const value = payload[key];
    if (Array.isArray(value)) return value;
  }
  if (pickTaskId(payload)) return [payload];
  return [];
}

async function loadTbResults(tbOutputDir) {
  const files = await walkJsonFiles(tbOutputDir);
  // Prefer files literally named results.json — TB often emits one canonical
  // file at the top of its output dir.
  const preferred = files.filter((file) => path.basename(file) === "results.json");
  const ordered = preferred.length > 0 ? preferred : files;

  const collected = new Map();
  for (const file of ordered) {
    const parsed = await readJsonSafe(file);
    if (parsed === null) continue;
    const entries = flattenTbEntries(parsed);
    for (const entry of entries) {
      const taskId = pickTaskId(entry) ?? path.basename(file, ".json");
      if (!collected.has(taskId)) {
        collected.set(taskId, { source: file, entry });
      }
    }
  }
  return collected;
}

async function loadAuraRuns(runsDir) {
  const files = await walkJsonFiles(runsDir);
  const collected = new Map();
  for (const file of files) {
    const parsed = await readJsonSafe(file);
    if (!isRecord(parsed)) continue;
    const taskId = pickTaskId(parsed) ?? path.basename(file, ".json");
    collected.set(taskId, parsed);
  }
  return collected;
}

function deriveAuraStatus(record) {
  if (!isRecord(record)) return null;
  if (typeof record.status === "string" && record.status.length > 0) {
    return record.status;
  }
  if (typeof record.ok === "boolean") {
    return record.ok ? "agent_complete" : "agent_error";
  }
  return null;
}

function combineStatuses(tbStatus, auraStatus) {
  if (tbStatus === "passed" || tbStatus === "failed") {
    return tbStatus;
  }
  if (
    auraStatus === "agent_timeout"
    || auraStatus === "agent_error"
    || auraStatus === "workspace_unavailable"
  ) {
    return auraStatus;
  }
  if (typeof tbStatus === "string" && tbStatus.length > 0) {
    return tbStatus;
  }
  if (typeof auraStatus === "string" && auraStatus.length > 0) {
    return auraStatus;
  }
  return "unknown";
}

function deriveTbFailureMode(entry) {
  if (!isRecord(entry)) return null;
  for (const key of [
    "failure_mode",
    "failureMode",
    "tb_failure_mode",
    "error_class",
    "errorClass",
  ]) {
    const value = entry[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return null;
}

function deriveBridgeMetrics(record) {
  const fallback = {
    aura_run_id: null,
    cost_usd: 0,
    total_tokens: 0,
    file_change_count: 0,
    max_context_utilization: 0,
    wallclock_seconds: 0,
  };
  if (!isRecord(record)) return fallback;
  const bridgeResult = isRecord(record.bridge_result) ? record.bridge_result : {};
  const wallclock =
    asNumber(record.wallclock_seconds) ?? asNumber(bridgeResult.wallclock_seconds) ?? 0;
  return {
    aura_run_id:
      typeof bridgeResult.runId === "string" && bridgeResult.runId.length > 0
        ? bridgeResult.runId
        : null,
    cost_usd: asNumber(bridgeResult.costUsd) ?? 0,
    total_tokens: asNumber(bridgeResult.totalTokens) ?? 0,
    file_change_count: asNumber(bridgeResult.fileChangeCount) ?? 0,
    max_context_utilization: asNumber(bridgeResult.maxContextUtilization) ?? 0,
    wallclock_seconds: wallclock,
  };
}

function dedupeModelSet(records) {
  const models = new Set();
  for (const record of records.values()) {
    const bridgeResult = isRecord(record?.bridge_result) ? record.bridge_result : null;
    const candidate =
      bridgeResult?.model
      ?? bridgeResult?.claude_model
      ?? record?.claude_model
      ?? null;
    if (typeof candidate === "string" && candidate.length > 0) {
      models.add(candidate);
    }
  }
  return Array.from(models).sort().join(",");
}

async function aggregate({ outDir, subset, dataset, wallclockSeconds, gitSha }) {
  const tbOutputDir = path.join(outDir, "tb-output");
  const runsDir = path.join(outDir, "runs");

  const tbEntries = await loadTbResults(tbOutputDir);
  const auraRuns = await loadAuraRuns(runsDir);

  const allTaskIds = new Set([...tbEntries.keys(), ...auraRuns.keys()]);

  const instances = [];
  let costSum = 0;
  let tokenSum = 0;
  let passed = 0;

  for (const taskId of Array.from(allTaskIds).sort()) {
    const tb = tbEntries.get(taskId)?.entry ?? null;
    const aura = auraRuns.get(taskId) ?? null;

    const tbStatus = deriveStatusFromTbEntry(tb);
    const auraStatus = deriveAuraStatus(aura);
    const status = combineStatuses(tbStatus, auraStatus);

    if (status === "passed") passed += 1;

    const metrics = deriveBridgeMetrics(aura);
    costSum += metrics.cost_usd;
    tokenSum += metrics.total_tokens;

    instances.push({
      task_id: taskId,
      dataset,
      status,
      tb_failure_mode: deriveTbFailureMode(tb),
      aura_run_id: metrics.aura_run_id,
      cost_usd: metrics.cost_usd,
      total_tokens: metrics.total_tokens,
      wallclock_seconds: metrics.wallclock_seconds,
      max_context_utilization: metrics.max_context_utilization,
      file_change_count: metrics.file_change_count,
    });
  }

  const instanceCount = instances.length;
  const score = instanceCount > 0 ? (passed / instanceCount) * 100 : 0;

  const confidenceNote =
    subset === "smoke" || instanceCount <= 30
      ? SMOKE_CONFIDENCE_NOTE_TEMPLATE(instanceCount)
      : "";

  const composite = {
    benchmark: "tbench_2_core",
    subset,
    instance_count: instanceCount,
    aura_version: gitSha || null,
    claude_model: dedupeModelSet(auraRuns) || null,
    cost_usd: Number(costSum.toFixed(6)),
    total_tokens: tokenSum,
    wallclock_seconds: wallclockSeconds,
    score: Number(score.toFixed(4)),
    confidence_note: confidenceNote,
    instances,
  };

  const scorePath = path.join(outDir, "score.json");
  await fs.writeFile(scorePath, `${JSON.stringify(composite, null, 2)}\n`, "utf8");

  process.stdout.write(
    `aggregate-score: instances=${instanceCount} passed=${passed} ` +
      `score=${composite.score} cost_usd=${composite.cost_usd} ` +
      `path=${scorePath}\n`,
  );
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.out) {
    process.stderr.write("aggregate-score: --out <run-dir> is required\n");
    process.exit(2);
  }
  const outDir = path.resolve(args.out);
  if (!(await pathExists(outDir))) {
    process.stderr.write(`aggregate-score: --out path does not exist: ${outDir}\n`);
    process.exit(2);
  }
  const subset = args.subset || "smoke";
  const dataset = args.dataset || "terminal-bench-core==head";
  const wallclockRaw = Number(args.wallclock ?? 0);
  const wallclockSeconds = Number.isFinite(wallclockRaw) ? wallclockRaw : 0;
  const gitSha = args["git-sha"] || "";

  await aggregate({
    outDir,
    subset,
    dataset,
    wallclockSeconds,
    gitSha,
  });
}

await main();
