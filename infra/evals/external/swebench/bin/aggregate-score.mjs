#!/usr/bin/env node
// Fold the SWE-bench Verified harness output and AURA driver telemetry into a
// normalized score.json under the run directory.

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentFile = fileURLToPath(import.meta.url);

function parseArgs(argv) {
  const args = { out: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const value = argv[i + 1];
      if (value === undefined) {
        throw new Error(`Missing value for ${arg}`);
      }
      i += 1;
      return value;
    };
    switch (arg) {
      case "--out":
        args.out = next();
        break;
      case "--help":
      case "-h":
        args.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function printHelp() {
  process.stdout.write(
    `Usage: node infra/evals/external/swebench/bin/aggregate-score.mjs --out <run-dir>\n` +
      `\n` +
      `Reads driver-summary.json, runs/*.json, and harness-report/*.json from <run-dir>\n` +
      `and writes <run-dir>/score.json.\n`,
  );
}

async function readJsonIfExists(filePath) {
  try {
    const text = await fs.readFile(filePath, "utf8");
    return JSON.parse(text);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function listJsonFiles(dirPath) {
  let entries;
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => path.join(dirPath, entry.name));
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  return [value];
}

function looksLikeTopLevelReport(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const hasKey = (k) => Object.prototype.hasOwnProperty.call(value, k);
  return (
    hasKey("total_instances")
    || hasKey("resolved_instances")
    || hasKey("resolved")
    || hasKey("submitted_instances")
  );
}

function normalizeStatus(harnessEntry, driverRecord) {
  if (driverRecord && driverRecord.status === "clone_error") return "clone_error";
  if (driverRecord && driverRecord.status === "skipped_cost_cap") {
    return "skipped_cost_cap";
  }
  if (harnessEntry && typeof harnessEntry.resolved === "boolean") {
    return harnessEntry.resolved ? "resolved" : "not_resolved";
  }
  if (harnessEntry && harnessEntry.status === "resolved") return "resolved";
  if (harnessEntry && harnessEntry.error) return "harness_error";
  if (driverRecord && driverRecord.status === "agent_error") return "agent_error";
  if (driverRecord && driverRecord.patch?.empty) return "not_resolved";
  return "not_resolved";
}

async function loadHarnessReport(runDir) {
  // Look for a top-level report.json in harness-report/, or fall back to a
  // walk over per-instance JSON files.
  const harnessDir = path.join(runDir, "harness-report");
  const topLevel = await readJsonIfExists(path.join(harnessDir, "report.json"));
  if (looksLikeTopLevelReport(topLevel)) {
    return { report: topLevel, perInstance: {} };
  }

  const perInstance = {};
  let aggregate = topLevel ?? {};
  const candidates = await listJsonFiles(harnessDir);
  for (const file of candidates) {
    if (path.basename(file) === "report.json") continue;
    const content = await readJsonIfExists(file);
    if (!content || typeof content !== "object") continue;
    if (looksLikeTopLevelReport(content) && !looksLikeTopLevelReport(aggregate)) {
      aggregate = content;
      continue;
    }
    const id = content.instance_id ?? path.basename(file, ".json");
    if (id) perInstance[id] = content;
  }

  // Some harness layouts produce <run-dir>/harness-report/<run_id>/report.json.
  if (!looksLikeTopLevelReport(aggregate)) {
    let nestedEntries = [];
    try {
      nestedEntries = await fs.readdir(harnessDir, { withFileTypes: true });
    } catch {
      nestedEntries = [];
    }
    for (const entry of nestedEntries) {
      if (!entry.isDirectory()) continue;
      const candidate = await readJsonIfExists(
        path.join(harnessDir, entry.name, "report.json"),
      );
      if (looksLikeTopLevelReport(candidate)) {
        aggregate = candidate;
        break;
      }
    }
  }

  return { report: aggregate ?? {}, perInstance };
}

function buildHarnessIndex(report, perInstance) {
  // The official report.json contains arrays of instance ids per outcome.
  const index = new Map();
  const upsert = (id, payload) => {
    if (!id) return;
    const existing = index.get(id) ?? {};
    index.set(id, { ...existing, ...payload });
  };

  if (report && typeof report === "object") {
    const buckets = {
      resolved: report.resolved_ids ?? report.resolved ?? [],
      not_resolved: report.unresolved_ids ?? report.unresolved ?? [],
      error: report.error_ids ?? report.error ?? [],
      submitted: report.submitted_ids ?? report.submitted_instances ?? [],
    };

    for (const id of asArray(buckets.resolved)) {
      upsert(typeof id === "string" ? id : id?.instance_id, { resolved: true });
    }
    for (const id of asArray(buckets.not_resolved)) {
      upsert(typeof id === "string" ? id : id?.instance_id, { resolved: false });
    }
    for (const id of asArray(buckets.error)) {
      const entry = typeof id === "string" ? { instance_id: id } : id;
      upsert(entry?.instance_id, { error: true });
    }
    for (const id of asArray(buckets.submitted)) {
      upsert(typeof id === "string" ? id : id?.instance_id, { submitted: true });
    }
  }

  for (const [id, content] of Object.entries(perInstance)) {
    upsert(id, {
      resolved:
        typeof content.resolved === "boolean"
          ? content.resolved
          : content.status === "resolved"
            ? true
            : undefined,
      failed_to_pass_results:
        content.tests_status?.FAIL_TO_PASS
          ?? content.FAIL_TO_PASS
          ?? content.failed_to_pass_results
          ?? null,
      passed_to_pass_results:
        content.tests_status?.PASS_TO_PASS
          ?? content.PASS_TO_PASS
          ?? content.passed_to_pass_results
          ?? null,
      error: content.error ?? null,
    });
  }

  return index;
}

async function loadDriverRecords(runDir) {
  const runsDir = path.join(runDir, "runs");
  const files = await listJsonFiles(runsDir);
  const out = new Map();
  for (const file of files) {
    const content = await readJsonIfExists(file);
    if (!content || !content.instance_id) continue;
    out.set(content.instance_id, content);
  }
  return out;
}

function buildConfidenceNote(subset, instanceCount) {
  if (subset === "verified") return "";
  if (instanceCount <= 50) {
    return (
      `Smoke run with ${instanceCount} instances has only ~5% granularity. ` +
      `Not a leaderboard-defensible number; the full 500-instance Verified run is required for that.`
    );
  }
  return "";
}

async function main(rawArgv) {
  let args;
  try {
    args = parseArgs(rawArgv ?? process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`Error: ${error.message}\n\n`);
    printHelp();
    process.exit(2);
    return;
  }

  if (args.help) {
    printHelp();
    return;
  }

  if (!args.out) {
    process.stderr.write(`Error: --out is required.\n\n`);
    printHelp();
    process.exit(2);
    return;
  }

  const runDir = path.resolve(args.out);
  const summary = await readJsonIfExists(path.join(runDir, "driver-summary.json"));
  if (!summary) {
    process.stderr.write(
      `Error: ${path.join(runDir, "driver-summary.json")} is missing; cannot aggregate.\n`,
    );
    process.exit(1);
    return;
  }

  const driverRecords = await loadDriverRecords(runDir);
  const { report, perInstance } = await loadHarnessReport(runDir);
  const harnessIndex = buildHarnessIndex(report, perInstance);

  const ids = new Set([
    ...driverRecords.keys(),
    ...harnessIndex.keys(),
  ]);

  const instances = [];
  let resolvedCount = 0;
  let totalCost = 0;
  let totalTokens = 0;
  for (const id of ids) {
    const driver = driverRecords.get(id) ?? null;
    const harness = harnessIndex.get(id) ?? null;
    const status = normalizeStatus(harness, driver);
    if (status === "resolved") resolvedCount += 1;

    const auraMetrics = driver?.aura_payload?.metrics ?? {};
    const cost = Number(driver?.cost_usd ?? auraMetrics.estimatedCostUsd ?? 0);
    const tokens = Number(driver?.total_tokens ?? auraMetrics.totalTokens ?? 0);
    totalCost += cost;
    totalTokens += tokens;

    instances.push({
      instance_id: id,
      repo: driver?.repo ?? null,
      base_commit: driver?.base_commit ?? null,
      status,
      model_patch_lines: driver?.patch?.lines ?? 0,
      files_changed: driver?.patch?.files_changed ?? 0,
      tests_directory_hits_stripped:
        driver?.patch?.tests_directory_hits_stripped ?? 0,
      harness_run_id: summary.run_id ?? null,
      failed_to_pass_results: harness?.failed_to_pass_results ?? null,
      passed_to_pass_results: harness?.passed_to_pass_results ?? null,
      aura_run_id: driver?.aura_payload?.runId ?? null,
      cost_usd: cost,
      total_tokens: tokens,
      wallclock_seconds: Number(driver?.wallclock_seconds ?? 0),
      max_context_utilization: Number(auraMetrics.maxContextUtilization ?? 0),
      file_change_count: Number(auraMetrics.fileChangeCount ?? 0),
    });
  }

  instances.sort((a, b) => a.instance_id.localeCompare(b.instance_id));

  const instanceCount = summary.instance_count ?? instances.length;
  const resolvedPct = instanceCount > 0 ? (resolvedCount / instanceCount) * 100 : 0;

  const score = {
    benchmark: "swebench_verified",
    subset: summary.subset ?? "custom",
    instance_count: instanceCount,
    aura_version: summary.aura_version ?? null,
    claude_model: summary.claude_model ?? null,
    cost_usd: Number((summary.cost_usd ?? totalCost).toFixed(6)),
    total_tokens: Number(summary.total_tokens ?? totalTokens),
    wallclock_seconds: Number(summary.wallclock_seconds ?? 0),
    score: Number(resolvedPct.toFixed(2)),
    resolved: resolvedCount,
    not_resolved: instances.length - resolvedCount,
    confidence_note: buildConfidenceNote(summary.subset, instanceCount),
    tests_directory_hits_stripped_total:
      summary.tests_directory_hits_stripped_total ?? 0,
    instances,
  };

  const scorePath = path.join(runDir, "score.json");
  await fs.writeFile(scorePath, JSON.stringify(score, null, 2), "utf8");

  process.stdout.write(
    `subset=${score.subset} instances=${instanceCount} resolved=${resolvedCount} ` +
      `resolved_pct=${score.score}% cost=$${score.cost_usd} tokens=${score.total_tokens} ` +
      `wallclock=${score.wallclock_seconds}s -> ${scorePath}\n`,
  );
}

const isDirect = (() => {
  try {
    return process.argv[1] && path.resolve(process.argv[1]) === currentFile;
  } catch {
    return false;
  }
})();

if (isDirect) {
  main().catch((error) => {
    process.stderr.write(
      `[aggregate-score] fatal: ${error?.stack ?? error?.message ?? String(error)}\n`,
    );
    process.exit(1);
  });
}

export {
  main,
  buildConfidenceNote,
  buildHarnessIndex,
  loadHarnessReport,
  loadDriverRecords,
  normalizeStatus,
};
