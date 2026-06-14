#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildStatusSnapshot } from "./lib/status-policy.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..", "..");

function parseArgs(argv) {
  const output = resolveSnapshotOutput();
  const args = {
    checksDir: process.env.AURA_STATUS_CHECKS_DIR || path.join(repoRoot, "infra/evals/reports/status/checks"),
    checksFile: process.env.AURA_STATUS_CHECKS_FILE || "",
    investigationsDir: process.env.AURA_STATUS_INVESTIGATIONS_DIR || path.join(repoRoot, "infra/evals/reports/status/investigations"),
    investigationsFile: process.env.AURA_STATUS_INVESTIGATIONS_FILE || "",
    previousSnapshot: process.env.AURA_STATUS_PREVIOUS_SNAPSHOT || "",
    registry: process.env.AURA_STATUS_FEATURES_FILE || path.join(__dirname, "features.json"),
    out: output,
    environment: process.env.AURA_STATUS_ENVIRONMENT || "unknown",
    source: process.env.AURA_STATUS_SOURCE || "aura-status",
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
    else if (arg === "--previous-snapshot") args.previousSnapshot = path.resolve(next());
    else if (arg === "--registry") args.registry = path.resolve(next());
    else if (arg === "--out") args.out = path.resolve(next());
    else if (arg === "--report-out") args.out = path.resolve(next());
    else if (arg === "--environment") args.environment = next();
    else if (arg === "--source") args.source = next();
    else if (arg === "--help") {
      process.stdout.write("Usage: node infra/evals/status/build-status-snapshot.mjs [--checks-dir DIR] [--checks-file FILE] [--investigations-dir DIR] [--previous-snapshot FILE] [--out FILE]\n");
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (args.previousSnapshot) args.previousSnapshot = path.resolve(args.previousSnapshot);
  return args;
}

function resolveSnapshotOutput() {
  const canonicalOutput = path.join(repoRoot, "infra/evals/reports/status/status.json");
  const output = process.env.AURA_STATUS_OUTPUT || "";
  const reportOutput = process.env.AURA_STATUS_REPORT_OUTPUT || "";
  if (output && reportOutput && path.resolve(output) !== path.resolve(reportOutput)) {
    throw new Error("AURA_STATUS_OUTPUT and AURA_STATUS_REPORT_OUTPUT must point to the same snapshot file.");
  }
  return output || reportOutput || canonicalOutput;
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
    if (entry.isDirectory()) {
      files.push(...await walkJsonFiles(entryPath));
    } else if (entry.isFile() && entry.name.endsWith(".json")) {
      files.push(entryPath);
    }
  }
  return files;
}

async function readChecks(args) {
  const checks = [];
  if (args.previousSnapshot) {
    try {
      checks.push(...checksFromSnapshot(await readJson(args.previousSnapshot)));
    } catch {
      // A missing previous public snapshot is expected on first publish.
    }
  }

  if (args.checksFile) {
    const payload = await readJson(args.checksFile);
    if (Array.isArray(payload)) return [...checks, ...payload];
    if (Array.isArray(payload.checks)) {
      return [...checks, ...payload.checks.map((check) => ({
        ...check,
        runGeneratedAt: payload.generatedAt ?? check.runGeneratedAt,
      }))];
    }
    return checks;
  }

  const files = await walkJsonFiles(args.checksDir);
  for (const file of files) {
    try {
      const payload = await readJson(file);
      if (Array.isArray(payload)) checks.push(...payload);
      else if (Array.isArray(payload.checks)) {
        checks.push(...payload.checks.map((check) => ({
          ...check,
          runGeneratedAt: payload.generatedAt ?? check.runGeneratedAt,
        })));
      }
      else if (payload.checkId) checks.push(payload);
    } catch {
      // Ignore unrelated JSON artifacts.
    }
  }
  return checks;
}

async function readInvestigations(args) {
  if (args.investigationsFile) {
    try {
      const payload = await readJson(args.investigationsFile);
      if (Array.isArray(payload)) return payload;
      if (Array.isArray(payload.investigations)) return payload.investigations;
    } catch {
      return [];
    }
  }

  const investigations = [];
  for (const file of await walkJsonFiles(args.investigationsDir)) {
    try {
      const payload = await readJson(file);
      if (Array.isArray(payload)) investigations.push(...payload);
      else if (Array.isArray(payload.investigations)) investigations.push(...payload.investigations);
      else if (payload.checkId) investigations.push(payload);
    } catch {
      // Ignore unrelated JSON artifacts.
    }
  }
  return investigations;
}

function checksFromSnapshot(snapshot) {
  if (!Array.isArray(snapshot?.features)) return [];
  const snapshotGeneratedAt = normalizeSnapshotGeneratedAt(snapshot);
  const checks = [];
  for (const feature of snapshot.features) {
    for (const check of feature?.checks ?? []) {
      if (!check?.id || !check?.checkedAt || check.status === "unknown") continue;
      checks.push({
        checkId: check.id,
        featureId: feature.id ?? null,
        label: check.id,
        status: check.status,
        message: check.message ?? "",
        startedAt: check.checkedAt,
        endedAt: check.checkedAt,
        runGeneratedAt: snapshotGeneratedAt ?? check.checkedAt,
        latencyMs: check.latencyMs ?? null,
        environment: snapshot.environment ?? null,
        evidence: check.evidence ?? {},
      });
    }
  }
  return checks;
}

function normalizeSnapshotGeneratedAt(snapshot) {
  if (typeof snapshot?.generatedAt !== "string" || snapshot.generatedAt.length === 0) return null;
  const date = new Date(snapshot.generatedAt);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

async function writeJson(filePath, payload) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

const args = parseArgs(process.argv.slice(2));
const registry = await readJson(args.registry);
const checks = await readChecks(args);
const investigations = await readInvestigations(args);
const snapshot = buildStatusSnapshot({
  registry,
  checks,
  investigations,
  environment: args.environment,
  source: args.source,
});

await writeJson(args.out, snapshot);

process.stdout.write(`${path.relative(repoRoot, args.out)}\n`);
