#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  INVESTIGATION_CONFIDENCE,
  INVESTIGATION_STATUS,
  investigationKey,
  latestInvestigationsByCheck,
  recordRuntimeEnvironment,
} from "./lib/status-investigations.mjs";
import { normalizeCheckResult } from "./lib/status-policy.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..", "..");
const CONFIDENCE_SCORE = Object.freeze({
  [INVESTIGATION_CONFIDENCE.LOW]: 1,
  [INVESTIGATION_CONFIDENCE.MEDIUM]: 2,
  [INVESTIGATION_CONFIDENCE.HIGH]: 3,
});

function parseArgs(argv) {
  const args = {
    checksDir: process.env.AURA_STATUS_CHECKS_DIR || path.join(repoRoot, "infra/evals/reports/status/checks"),
    checksFile: process.env.AURA_STATUS_CHECKS_FILE || "",
    investigationsDir: process.env.AURA_STATUS_INVESTIGATIONS_DIR || path.join(repoRoot, "infra/evals/reports/status/investigations"),
    investigationsFile: process.env.AURA_STATUS_INVESTIGATIONS_FILE || "",
    outFile: process.env.AURA_STATUS_REPAIR_DISPATCH_PLAN_FILE || "",
    githubOutput: process.env.GITHUB_OUTPUT || "",
    minConfidence: process.env.AURA_STATUS_REPAIR_MIN_INVESTIGATION_CONFIDENCE || "medium",
    maxChecks: Number(process.env.AURA_STATUS_REPAIR_DISPATCH_MAX_CHECKS || 3),
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      i += 1;
      if (i >= argv.length) throw new Error(`Missing value for ${arg}`);
      return argv[i];
    };
    if (arg === "--checks-dir") args.checksDir = path.resolve(next());
    else if (arg === "--checks-file") args.checksFile = path.resolve(next());
    else if (arg === "--investigations-dir") args.investigationsDir = path.resolve(next());
    else if (arg === "--investigations-file") args.investigationsFile = path.resolve(next());
    else if (arg === "--out-file") args.outFile = path.resolve(next());
    else if (arg === "--github-output") args.githubOutput = path.resolve(next());
    else if (arg === "--min-confidence") args.minConfidence = next();
    else if (arg === "--max-checks") args.maxChecks = Number(next());
    else if (arg === "--help") {
      process.stdout.write("Usage: node infra/evals/status/plan-status-repair-dispatch.mjs [--checks-dir DIR] [--investigations-dir DIR]\n");
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isFinite(args.maxChecks) || args.maxChecks <= 0) args.maxChecks = 3;
  if (!CONFIDENCE_SCORE[args.minConfidence]) args.minConfidence = "medium";
  return args;
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function walkJsonFiles(dir) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walkJsonFiles(entryPath));
    else if (entry.isFile() && entry.name.endsWith(".json")) files.push(entryPath);
  }
  return files;
}

async function readCheckRecords(args, generatedAt) {
  if (args.checksFile) return checksFromPayload(await readJson(args.checksFile), generatedAt);
  const checks = [];
  for (const file of await walkJsonFiles(args.checksDir)) {
    try {
      checks.push(...checksFromPayload(await readJson(file), generatedAt));
    } catch {
      // Ignore unrelated JSON artifacts.
    }
  }
  return checks;
}

function checksFromPayload(payload, generatedAt) {
  const rawChecks = Array.isArray(payload) ? payload : Array.isArray(payload?.checks) ? payload.checks : payload?.checkId ? [payload] : [];
  return rawChecks.map((check) => normalizeCheckResult({
    ...check,
    runGeneratedAt: payload?.generatedAt ?? check.runGeneratedAt,
  }, generatedAt));
}

function latestByCheckId(checks, generatedAt) {
  const map = new Map();
  for (const check of checks) {
    if (!check.checkId) continue;
    const key = checkRuntimeKey(check);
    const existing = map.get(key);
    const endedAt = new Date(check.endedAt ?? generatedAt).getTime();
    const existingEndedAt = new Date(existing?.endedAt ?? 0).getTime();
    if (!existing || endedAt > existingEndedAt) map.set(key, check);
  }
  return [...map.values()];
}

function checkRuntimeKey(check) {
  const runtimeEnvironment = recordRuntimeEnvironment(check);
  return runtimeEnvironment ? `${runtimeEnvironment}::${check.checkId}` : check.checkId;
}

async function readInvestigations(args, generatedAt) {
  const investigations = [];
  if (args.investigationsFile) return investigationsFromPayload(await readJson(args.investigationsFile), generatedAt);
  for (const file of await walkJsonFiles(args.investigationsDir)) {
    try {
      investigations.push(...investigationsFromPayload(await readJson(file), generatedAt));
    } catch {
      // Ignore unrelated JSON artifacts.
    }
  }
  return investigations;
}

function investigationsFromPayload(payload) {
  return Array.isArray(payload) ? payload : Array.isArray(payload?.investigations) ? payload.investigations : payload?.checkId ? [payload] : [];
}

function shouldRepairCheck(check, investigation, minConfidence) {
  if (!check || !["fail", "warn"].includes(check.status)) return false;
  if (!investigation || investigation.status !== INVESTIGATION_STATUS.READY) return false;
  return CONFIDENCE_SCORE[investigation.confidence] >= CONFIDENCE_SCORE[minConfidence];
}

function buildPlan({ checks, investigationMap, minConfidence, maxChecks, generatedAt }) {
  const eligible = [];
  for (const check of checks) {
    const runtimeEnvironment = recordRuntimeEnvironment(check);
    const investigation = investigationMap.get(investigationKey(check.featureId, check.checkId, runtimeEnvironment))
      ?? investigationMap.get(investigationKey(null, check.checkId, runtimeEnvironment))
      ?? investigationMap.get(investigationKey(check.featureId, check.checkId))
      ?? investigationMap.get(investigationKey(null, check.checkId));
    if (!shouldRepairCheck(check, investigation, minConfidence)) continue;
    eligible.push({
      checkId: check.checkId,
      featureId: check.featureId,
      runtimeEnvironment,
      status: check.status,
      investigationId: investigation.id,
      investigationConfidence: investigation.confidence,
      investigationTitle: investigation.title,
    });
  }
  const selected = eligible.slice(0, maxChecks);
  return {
    schemaVersion: 1,
    generatedAt,
    minConfidence,
    maxChecks,
    shouldDispatch: selected.length > 0,
    checks: selected.map((check) => check.checkId),
    checksCsv: selected.map((check) => check.checkId).join(","),
    selected,
    skippedEligibleCount: Math.max(0, eligible.length - selected.length),
  };
}

async function writeOutputs(args, plan) {
  if (args.outFile) {
    await fs.mkdir(path.dirname(args.outFile), { recursive: true });
    await fs.writeFile(args.outFile, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
  }
  if (args.githubOutput) {
    await fs.appendFile(args.githubOutput, [
      `should_dispatch=${plan.shouldDispatch ? "true" : "false"}`,
      `checks=${plan.checksCsv}`,
      `count=${plan.checks.length}`,
      "",
    ].join("\n"), "utf8");
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const generatedAt = new Date().toISOString();
  const checks = latestByCheckId(await readCheckRecords(args, generatedAt), generatedAt);
  const investigationMap = latestInvestigationsByCheck(await readInvestigations(args, generatedAt), generatedAt);
  const plan = buildPlan({
    checks,
    investigationMap,
    minConfidence: args.minConfidence,
    maxChecks: args.maxChecks,
    generatedAt,
  });
  await writeOutputs(args, plan);
  process.stdout.write(`Repair dispatch plan: ${plan.shouldDispatch ? `dispatch ${plan.checksCsv}` : "no eligible failures"}\n`);
}

await main();
