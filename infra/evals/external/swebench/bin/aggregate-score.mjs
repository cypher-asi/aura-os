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
  if (driverRecord && driverRecord.status === "agent_patch_polluted") {
    return "agent_patch_polluted";
  }
  if (driverRecord && driverRecord.status === "verification_environment_blocked") {
    return "verification_environment_blocked";
  }
  if (harnessEntry && harnessEntry.error) return "harness_error";
  if (driverRecord && driverRecord.status === "agent_error") return "agent_error";
  if (driverRecord && driverRecord.patch?.empty) return "not_resolved";
  return "not_resolved";
}

async function loadHarnessReport(runDir) {
  // Look for a top-level report.json in harness-report/, or fall back to a
  // walk over per-instance JSON files.
  const harnessDir = path.join(runDir, "harness-report");
  let foundHarnessOutput = false;
  const topLevel = await readJsonIfExists(path.join(harnessDir, "report.json"));
  if (topLevel) foundHarnessOutput = true;
  if (looksLikeTopLevelReport(topLevel)) {
    return { report: topLevel, perInstance: {}, foundHarnessOutput };
  }

  const perInstance = {};
  let aggregate = topLevel ?? {};
  const candidates = await listJsonFiles(harnessDir);
  for (const file of candidates) {
    if (path.basename(file) === "report.json") continue;
    const content = await readJsonIfExists(file);
    if (!content || typeof content !== "object") continue;
    foundHarnessOutput = true;
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
      if (candidate) foundHarnessOutput = true;
      if (looksLikeTopLevelReport(candidate)) {
        aggregate = candidate;
        break;
      }
    }
  }

  return { report: aggregate ?? {}, perInstance, foundHarnessOutput };
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
      resolved: report.resolved_ids ?? report.resolved_instances ?? report.resolved ?? [],
      not_resolved:
        report.unresolved_ids
        ?? report.unresolved_instances
        ?? report.not_resolved_instances
        ?? report.unresolved
        ?? [],
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

export function synthesizeSummaryFromRecords(runDir, recordsMap) {
  // Best-effort reconstruction used when the driver was killed before writing
  // driver-summary.json. We pull totals out of runs/*.json (which the driver
  // writes incrementally) and fill in defaults for fields we cannot recover.
  const records = Array.from(recordsMap.values());
  const statusCounts = {
    agent_complete: 0,
    agent_error: 0,
    agent_patch_polluted: 0,
    verification_environment_blocked: 0,
    clone_error: 0,
    skipped_cost_cap: 0,
  };
  let totalCost = 0;
  let totalTokens = 0;
  let totalStripped = 0;
  let started = null;
  let finished = null;
  const claudeModels = new Set();
  let inferredSubset = null;
  for (const record of records) {
    const status = record.status ?? "";
    statusCounts[status] = (statusCounts[status] ?? 0) + 1;
    totalCost += Number(record.cost_usd ?? 0);
    totalTokens += Number(record.total_tokens ?? 0);
    totalStripped += Number(record.patch?.tests_directory_hits_stripped ?? 0);
    if (record.started_at) {
      const t = Date.parse(record.started_at);
      if (Number.isFinite(t) && (started === null || t < started)) started = t;
    }
    if (record.finished_at) {
      const t = Date.parse(record.finished_at);
      if (Number.isFinite(t) && (finished === null || t > finished)) finished = t;
    }
    const richModels = record.aura_payload?.richUsageSummary?.models ?? [];
    for (const m of richModels) claudeModels.add(m);
    if (!inferredSubset && typeof record.scenario?.kind === "string") {
      inferredSubset = "custom";
    }
  }
  const wallclock = started !== null && finished !== null && finished >= started
    ? (finished - started) / 1000
    : 0;
  return {
    run_id: path.basename(runDir),
    subset: inferredSubset ?? "custom",
    instance_count: records.length,
    started_at: started !== null ? new Date(started).toISOString() : null,
    finished_at: finished !== null ? new Date(finished).toISOString() : null,
    wallclock_seconds: wallclock,
    aura_version: null,
    claude_model: Array.from(claudeModels).sort().join(",") || null,
    cost_usd: totalCost,
    total_tokens: totalTokens,
    status_counts: statusCounts,
    tests_directory_hits_stripped_total: totalStripped,
    aborted_due_to_cost_cap: false,
    out_dir: runDir,
    synthesized: true,
  };
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

export function failureBucket(instance) {
  if (instance.status === "resolved") return "resolved";
  if (instance.status === "agent_patch_polluted") return "agent_patch_polluted";
  if (instance.status === "verification_environment_blocked") {
    return "verification_environment_blocked";
  }
  if (instance.status === "agent_error" || instance.failed_tasks > 0) {
    return "dev_loop_failure";
  }
  if (instance.files_changed === 0) return "empty_or_filtered_patch";
  if (instance.tests_directory_hits_stripped > 0) return "test_edit_stripped";
  if (instance.failed_to_pass_results) return "hidden_test_failure";
  return "unresolved_patch_quality";
}

export function buildPostmortem(score) {
  const buckets = {};
  const unresolved = [];
  for (const instance of score.instances ?? []) {
    const bucket = failureBucket(instance);
    buckets[bucket] = (buckets[bucket] ?? 0) + 1;
    if (bucket !== "resolved") {
      unresolved.push({
        instance_id: instance.instance_id,
        status: instance.status,
        bucket,
        files_changed: instance.files_changed,
        model_patch_lines: instance.model_patch_lines,
        task_count: instance.task_count,
        done_tasks: instance.done_tasks,
        failed_tasks: instance.failed_tasks,
        tests_directory_hits_stripped: instance.tests_directory_hits_stripped,
        failed_to_pass_results: instance.failed_to_pass_results,
      });
    }
  }
  return {
    benchmark: score.benchmark,
    subset: score.subset,
    scoring_mode: score.scoring_mode,
    official_harness_ran: score.official_harness_ran,
    resolved: score.resolved,
    not_resolved: score.not_resolved,
    score: score.score,
    buckets,
    unresolved,
  };
}

function renderPostmortemMarkdown(postmortem) {
  const lines = [
    "# SWE-bench Postmortem",
    "",
    `Score: ${postmortem.resolved}/${postmortem.resolved + postmortem.not_resolved} (${postmortem.score}%)`,
    `Mode: ${postmortem.scoring_mode}`,
    "",
    "## Buckets",
    "",
    "| Bucket | Count |",
    "| --- | ---: |",
  ];
  for (const [bucket, count] of Object.entries(postmortem.buckets)) {
    lines.push(`| ${bucket} | ${count} |`);
  }
  lines.push(
    "",
    "## Unresolved Instances",
    "",
    "| Instance | Bucket | Status | Files | Lines | Tasks | Failed Tasks |",
    "| --- | --- | --- | ---: | ---: | ---: | ---: |",
  );
  for (const entry of postmortem.unresolved) {
    lines.push(
      `| ${entry.instance_id} | ${entry.bucket} | ${entry.status} | ${entry.files_changed ?? 0} | ${entry.model_patch_lines ?? 0} | ${entry.task_count ?? 0} | ${entry.failed_tasks ?? 0} |`,
    );
  }
  lines.push("");
  return lines.join("\n");
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
  let summary = await readJsonIfExists(path.join(runDir, "driver-summary.json"));
  const driverRecords = await loadDriverRecords(runDir);
  if (!summary) {
    if (driverRecords.size === 0) {
      process.stderr.write(
        `Error: ${path.join(runDir, "driver-summary.json")} is missing and ${path.join(runDir, "runs")} has no records; cannot aggregate.\n`,
      );
      process.exit(1);
      return;
    }
    summary = synthesizeSummaryFromRecords(runDir, driverRecords);
    await fs.writeFile(
      path.join(runDir, "driver-summary.json"),
      JSON.stringify(summary, null, 2),
      "utf8",
    );
    process.stderr.write(
      `[aggregate-score] driver-summary.json was missing; synthesized from ${driverRecords.size} runs/*.json file(s)\n`,
    );
  }
  const { report, perInstance, foundHarnessOutput } = await loadHarnessReport(runDir);
  const harnessIndex = buildHarnessIndex(report, perInstance);
  const officialHarnessRan = foundHarnessOutput;
  const nativeWindowsDriverOnly = !officialHarnessRan && process.platform === "win32";

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
      task_count: Number(driver?.aura_payload?.counts?.tasks ?? 0),
      done_tasks: Number(driver?.aura_payload?.counts?.doneTasks ?? 0),
      failed_tasks: Number(driver?.aura_payload?.counts?.failedTasks ?? 0),
      patch_pollution_guard: driver?.patch?.pollution_guard ?? null,
      verification_environment: driver?.patch?.verification_environment ?? null,
    });
  }

  instances.sort((a, b) => a.instance_id.localeCompare(b.instance_id));

  const instanceCount = summary.instance_count ?? instances.length;
  const resolvedPct = instanceCount > 0 ? (resolvedCount / instanceCount) * 100 : 0;

  const score = {
    benchmark: "swebench_verified",
    subset: summary.subset ?? "custom",
    scoring_mode: officialHarnessRan
      ? "official_harness"
      : nativeWindowsDriverOnly
        ? "driver_only_native_windows"
        : "driver_predictions_only",
    official_harness_ran: officialHarnessRan,
    official_results_available: officialHarnessRan,
    scoring_note: officialHarnessRan
      ? ""
      : nativeWindowsDriverOnly
        ? "Native Windows run is driver-only plumbing validation. It is not an official SWE-bench resolved/not_resolved score; run predictions.jsonl through the official SWE-bench harness under WSL, Linux, or macOS."
        : "Official SWE-bench hidden-test scoring did not run; this score only reflects AURA driver output and generated predictions. Run predictions.jsonl through the official SWE-bench harness on Linux, WSL, or macOS for resolved/not_resolved results.",
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
  const postmortem = buildPostmortem(score);
  await fs.writeFile(
    path.join(runDir, "postmortem.json"),
    JSON.stringify(postmortem, null, 2),
    "utf8",
  );
  await fs.writeFile(
    path.join(runDir, "postmortem.md"),
    renderPostmortemMarkdown(postmortem),
    "utf8",
  );

  process.stdout.write(
    `subset=${score.subset} instances=${instanceCount} resolved=${resolvedCount} ` +
      `mode=${score.scoring_mode} ` +
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
