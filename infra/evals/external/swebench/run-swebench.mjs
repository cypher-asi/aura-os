#!/usr/bin/env node
// SWE-bench Verified driver for AURA.
//
// Runs the AURA pipeline (org -> agent -> project import -> spec -> tasks ->
// autonomous loop) against SWE-bench Verified instances, captures the
// resulting `git diff` against the instance's `base_commit`, strips edits
// that touch test files, and emits a `predictions.jsonl` that the official
// `python -m swebench.harness.run_evaluation` harness can score.
//
// The library at interface/scripts/lib/benchmark-api-runner.mjs owns all
// backend interaction. This driver only orchestrates filesystem state, diff
// extraction, and per-instance bookkeeping.

import { spawnSync } from "node:child_process";
import { promises as fs, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createBenchmarkClient,
  runScenario,
} from "../../../../interface/scripts/lib/benchmark-api-runner.mjs";

const currentFile = fileURLToPath(import.meta.url);
const driverDir = path.dirname(currentFile);
const repoRoot = path.resolve(driverDir, "..", "..", "..", "..");

const PYTHON_FIXTURE_IGNORE = Object.freeze([
  "**/__pycache__/**",
  "**/*.pyc",
  "**/.pytest_cache/**",
]);

export const BENCHMARK_DIRECTIVES = `## Benchmark constraints

- Do not modify or delete any existing test files (anything under \`tests/\`, \`test/\`, or files matching \`test_*.py\` / \`*_test.py\`). The reviewer applies a hidden test patch and will fail the run if existing tests are altered.
- Do not add new dependencies; install only what is already declared in the repo.
- Make the smallest viable change. Most fixes are 1-3 files and under ~30 lines.
- The local test environment is NOT pre-configured. Do not run pytest unless you can confirm the dependencies are installed. Reason from the codebase instead.
`;

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export function parseArgs(argv) {
  const args = {
    subset: "smoke",
    limit: null,
    offset: 0,
    instanceIds: null,
    out: null,
    keepEntities: false,
    stripTestEdits: true,
    concurrency: 1,
  };

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
      case "--subset":
        args.subset = next();
        break;
      case "--limit":
        args.limit = Number(next());
        if (!Number.isFinite(args.limit) || args.limit < 0) {
          throw new Error("--limit must be a non-negative integer");
        }
        break;
      case "--offset":
        args.offset = Number(next());
        if (!Number.isFinite(args.offset) || args.offset < 0) {
          throw new Error("--offset must be a non-negative integer");
        }
        break;
      case "--instance-ids": {
        const value = next();
        args.instanceIds = value
          .split(",")
          .map((part) => part.trim())
          .filter((part) => part.length > 0);
        break;
      }
      case "--out":
        args.out = next();
        break;
      case "--keep-entities":
        args.keepEntities = true;
        break;
      case "--no-strip-test-edits":
        args.stripTestEdits = false;
        break;
      case "--concurrency": {
        const value = Number(next());
        if (!Number.isFinite(value) || value < 1) {
          throw new Error("--concurrency must be >= 1");
        }
        args.concurrency = Math.min(4, Math.floor(value));
        break;
      }
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
    `Usage: node infra/evals/external/swebench/run-swebench.mjs [options]\n` +
      `\n` +
      `Options:\n` +
      `  --subset NAME           smoke (default), verified, or a custom name matching\n` +
      `                          infra/evals/external/swebench/datasets/<NAME>.jsonl\n` +
      `  --limit N               only run the first N matching instances\n` +
      `  --offset N              skip the first N matching instances\n` +
      `  --instance-ids id1,id2  only run the listed instance ids\n` +
      `  --out DIR               write predictions/runs/driver-summary into DIR\n` +
      `  --keep-entities         do not delete the AURA entities after each instance\n` +
      `  --no-strip-test-edits   keep hunks under tests/, test/, test_*.py, *_test.py\n` +
      `  --concurrency N         run up to N (max 4) instances in parallel\n` +
      `  -h, --help              print this help\n`,
  );
}

// ---------------------------------------------------------------------------
// requirements.md
// ---------------------------------------------------------------------------

export function buildRequirementsMd(instance) {
  if (!instance || typeof instance !== "object") {
    throw new Error("buildRequirementsMd: instance is required");
  }
  const id = instance.instance_id ?? "<unknown>";
  const repo = instance.repo ?? "<unknown>";
  const baseCommit = instance.base_commit ?? "<unknown>";
  const problemStatement = (instance.problem_statement ?? "").trim();
  const hintsText = (instance.hints_text ?? "").trim();

  const sections = [
    `# SWE-bench instance: ${id}`,
    "",
    `Repo: ${repo}`,
    `Base commit: ${baseCommit}`,
    "",
    "## Problem statement",
    "",
    problemStatement.length > 0
      ? problemStatement
      : "_No problem statement was provided in the dataset._",
  ];

  if (hintsText.length > 0) {
    sections.push("", "## Discussion (issue hints)", "", hintsText);
  }

  sections.push("", BENCHMARK_DIRECTIVES.trimEnd(), "");
  return sections.join("\n");
}

// ---------------------------------------------------------------------------
// Diff parsing / stripping
// ---------------------------------------------------------------------------

function isTestPath(rawPath) {
  if (!rawPath) return false;
  if (rawPath === "/dev/null") return false;
  let cleaned = rawPath.trim();
  if (cleaned.startsWith("a/") || cleaned.startsWith("b/")) {
    cleaned = cleaned.slice(2);
  }
  if (cleaned.length === 0) return false;
  const segments = cleaned.split("/");
  for (const segment of segments) {
    if (segment === "tests" || segment === "test") return true;
  }
  const basename = segments[segments.length - 1];
  if (basename === "tests.py") return true;
  if (/^test_.+\.py$/i.test(basename)) return true;
  if (/^.+_test\.py$/i.test(basename)) return true;
  return false;
}

function parseDiffHeaderPaths(headerLine) {
  // headerLine looks like: "diff --git a/foo/bar.py b/foo/bar.py"
  const prefix = "diff --git ";
  if (!headerLine.startsWith(prefix)) {
    return { oldPath: null, newPath: null };
  }
  const remainder = headerLine.slice(prefix.length).trim();
  // Try splitting on " b/" first because paths may contain spaces (rare).
  const splitIndex = remainder.lastIndexOf(" b/");
  if (splitIndex < 0) return { oldPath: null, newPath: null };
  const oldPart = remainder.slice(0, splitIndex).trim();
  const newPart = remainder.slice(splitIndex + 1).trim();
  return { oldPath: oldPart, newPath: newPart };
}

function extractMinusPlusPaths(chunkLines) {
  let minus = null;
  let plus = null;
  for (const line of chunkLines) {
    if (line.startsWith("--- ")) {
      const value = line.slice(4).trim();
      minus = value === "/dev/null" ? "/dev/null" : value;
    } else if (line.startsWith("+++ ")) {
      const value = line.slice(4).trim();
      plus = value === "/dev/null" ? "/dev/null" : value;
      break;
    } else if (line.startsWith("@@")) {
      break;
    }
  }
  return { minus, plus };
}

function splitDiffIntoChunks(diff) {
  if (typeof diff !== "string" || diff.length === 0) return [];
  const lines = diff.split("\n");
  const chunks = [];
  let current = null;
  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      if (current) chunks.push(current);
      current = { header: line, lines: [line] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function rejoinChunks(chunks, originalDiff) {
  if (chunks.length === 0) return "";
  const joined = chunks.map((chunk) => chunk.lines.join("\n")).join("\n");
  // Preserve trailing newline if the original diff had one.
  if (originalDiff.endsWith("\n") && !joined.endsWith("\n")) {
    return `${joined}\n`;
  }
  return joined;
}

export function parseDiffFiles(diff) {
  const chunks = splitDiffIntoChunks(diff);
  const files = new Set();
  for (const chunk of chunks) {
    const { oldPath, newPath } = parseDiffHeaderPaths(chunk.header);
    const stripPrefix = (value) => {
      if (!value) return null;
      if (value.startsWith("a/")) return value.slice(2);
      if (value.startsWith("b/")) return value.slice(2);
      return value;
    };

    const candidates = [stripPrefix(newPath), stripPrefix(oldPath)];
    const { minus, plus } = extractMinusPlusPaths(chunk.lines);
    if (plus && plus !== "/dev/null") candidates.push(stripPrefix(plus));
    if (minus && minus !== "/dev/null") candidates.push(stripPrefix(minus));

    for (const candidate of candidates) {
      if (candidate) {
        files.add(candidate);
        break;
      }
    }
  }
  return Array.from(files);
}

export function stripTestEditsFromDiff(diff) {
  const chunks = splitDiffIntoChunks(diff);
  if (chunks.length === 0) {
    return { patch: typeof diff === "string" ? diff : "", strippedHunks: 0 };
  }

  const kept = [];
  let strippedHunks = 0;

  for (const chunk of chunks) {
    const { oldPath, newPath } = parseDiffHeaderPaths(chunk.header);
    const { minus, plus } = extractMinusPlusPaths(chunk.lines);

    const stripPrefix = (value) => {
      if (!value) return null;
      if (value.startsWith("a/")) return value.slice(2);
      if (value.startsWith("b/")) return value.slice(2);
      return value;
    };

    const candidates = [
      stripPrefix(oldPath),
      stripPrefix(newPath),
      minus === "/dev/null" ? null : stripPrefix(minus),
      plus === "/dev/null" ? null : stripPrefix(plus),
    ].filter((value) => value && value !== "/dev/null");

    const anyTest = candidates.some((value) => isTestPath(value));
    if (anyTest) {
      strippedHunks += 1;
      continue;
    }
    kept.push(chunk);
  }

  return {
    patch: rejoinChunks(kept, typeof diff === "string" ? diff : ""),
    strippedHunks,
  };
}

// ---------------------------------------------------------------------------
// Dataset loading
// ---------------------------------------------------------------------------

function manifestPathForSubset(subset) {
  return path.join(driverDir, "datasets", `${subset}.jsonl`);
}

async function loadManifest(subset) {
  const manifestPath = manifestPathForSubset(subset);
  let raw;
  try {
    raw = await fs.readFile(manifestPath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      const friendly =
        `Dataset manifest not found at ${manifestPath}.\n` +
        `Generate it with \`node infra/evals/external/swebench/bin/fetch-dataset.mjs --subset ${subset}\`.`;
      const wrapped = new Error(friendly);
      wrapped.cause = error;
      throw wrapped;
    }
    throw error;
  }

  const records = [];
  const lines = raw.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (line.length === 0) continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch (error) {
      throw new Error(
        `Failed to parse line ${i + 1} of ${manifestPath}: ${error.message}`,
      );
    }
    if (!record.instance_id || !record.repo || !record.base_commit) {
      throw new Error(
        `Manifest line ${i + 1} is missing required fields (instance_id, repo, base_commit)`,
      );
    }
    if (!record.problem_statement) {
      record.problem_statement = "";
    }
    records.push(record);
  }
  return records;
}

function applyInstanceFilters(records, args) {
  let filtered = records;
  if (Array.isArray(args.instanceIds) && args.instanceIds.length > 0) {
    const allowed = new Set(args.instanceIds);
    filtered = filtered.filter((record) => allowed.has(record.instance_id));
  }
  if (args.offset > 0) {
    filtered = filtered.slice(args.offset);
  }
  if (args.limit != null) {
    filtered = filtered.slice(0, args.limit);
  }
  return filtered;
}

// ---------------------------------------------------------------------------
// Git helpers
// ---------------------------------------------------------------------------

function runGit(args, options = {}) {
  const result = spawnSync("git", args, {
    stdio: ["ignore", "pipe", "pipe"],
    cwd: options.cwd,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  if (result.error) {
    return { code: -1, stdout: "", stderr: result.error.message };
  }
  return {
    code: result.status ?? -1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

async function shallowCloneInstance(repo, baseCommit, destDir, log) {
  await fs.mkdir(destDir, { recursive: true });
  const url = `https://github.com/${repo}.git`;

  const cloneResult = runGit([
    "clone",
    "--filter=blob:none",
    "--no-checkout",
    url,
    destDir,
  ]);
  if (cloneResult.code !== 0) {
    return {
      ok: false,
      stage: "clone",
      stderr: cloneResult.stderr || `git clone exited with ${cloneResult.code}`,
    };
  }
  log(`cloned ${url}`);

  const fetchResult = runGit(
    ["fetch", "--depth", "1", "origin", baseCommit],
    { cwd: destDir },
  );
  if (fetchResult.code !== 0) {
    return {
      ok: false,
      stage: "fetch",
      stderr: fetchResult.stderr || `git fetch exited with ${fetchResult.code}`,
    };
  }
  log(`fetched ${baseCommit}`);

  const checkoutResult = runGit(["checkout", "FETCH_HEAD"], { cwd: destDir });
  if (checkoutResult.code !== 0) {
    return {
      ok: false,
      stage: "checkout",
      stderr:
        checkoutResult.stderr || `git checkout exited with ${checkoutResult.code}`,
    };
  }
  log(`checked out FETCH_HEAD`);

  return { ok: true };
}

async function captureWorkspaceDiff(workspaceDir, baseCommit) {
  const addResult = runGit(["add", "-A"], { cwd: workspaceDir });
  if (addResult.code !== 0) {
    return {
      ok: false,
      patch: "",
      stderr: addResult.stderr || `git add exited with ${addResult.code}`,
    };
  }

  const diffResult = runGit(["diff", "--cached", baseCommit], {
    cwd: workspaceDir,
  });
  if (diffResult.code !== 0) {
    return {
      ok: false,
      patch: diffResult.stdout ?? "",
      stderr: diffResult.stderr || `git diff exited with ${diffResult.code}`,
    };
  }

  return { ok: true, patch: diffResult.stdout ?? "", stderr: "" };
}

export function readAuraVersion() {
  let cargoVersion = "unknown";
  try {
    const cargoText = readFileSync(path.join(repoRoot, "Cargo.toml"), "utf8");
    const match = cargoText.match(
      /\[workspace\.package][^[]*?version\s*=\s*"([^"]+)"/,
    );
    if (match) cargoVersion = match[1];
  } catch {
    cargoVersion = "unknown";
  }

  let gitSha = "unknown";
  const result = runGit(["rev-parse", "HEAD"], { cwd: repoRoot });
  if (result.code === 0) {
    gitSha = result.stdout.trim().slice(0, 12);
  }

  return `${cargoVersion}+${gitSha}`;
}

// ---------------------------------------------------------------------------
// Per-instance pipeline
// ---------------------------------------------------------------------------

function buildScenario(instance, workspaceDir) {
  const id = instance.instance_id;
  return {
    id: `swebench-${id}`,
    suite: "external_benchmark",
    kind: "swebench_verified",
    title: `SWE-bench Verified — ${id}`,
    devices: ["api-local"],
    story: {
      actor: "swebench evaluator",
      goal: "produce a model_patch that resolves the issue",
      benefit: "compare AURA against the public leaderboard",
    },
    canonicalPrompts: [
      "Read requirements.md and the codebase, then make the smallest patch that fixes the issue.",
    ],
    agentTemplate: {
      name: "Aura-SWEbench-Builder",
      role: "Engineer",
      personality: "Methodical, careful, benchmark-focused.",
      systemPrompt:
        "You are AURA running a single SWE-bench Verified instance. Read requirements.md first. Make the smallest patch that fixes the described bug. Do not edit existing tests.",
      machineType: process.env.AURA_BENCH_AGENT_MACHINE_TYPE ?? "local",
      adapterType: "aura_harness",
      environment: "local_host",
    },
    project: {
      name: `Aura SWE-bench ${id}`,
      description: `SWE-bench Verified instance ${id}`,
      fixtureAbsolutePath: workspaceDir,
      buildCommand:
        process.env.AURA_BENCH_BUILD_COMMAND
          ?? `python -c "print('SWE-bench AURA build placeholder')"`,
      testCommand:
        process.env.AURA_BENCH_TEST_COMMAND
          ?? `python -c "print('SWE-bench AURA test placeholder')"`,
      artifactChecks: [],
    },
    timeouts: {
      loginMs: 30000,
      loopCompletionMs: Number(
        process.env.AURA_BENCH_LOOP_TIMEOUT_MS ?? 1500000,
      ),
      pollIntervalMs: 5000,
    },
    verification: {
      requireNoFailedTasks: false,
      requireAnyDoneTasks: false,
      requireBuildSteps: false,
      requireTestSteps: false,
      statsTexts: [],
    },
  };
}

async function appendJsonl(filePath, record) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.appendFile(filePath, `${JSON.stringify(record)}\n`, "utf8");
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
}

async function runOneInstance({
  instance,
  args,
  client,
  outDir,
  workRoot,
  log,
  costState,
  resultsRef,
}) {
  const startedAt = new Date();
  const instanceId = instance.instance_id;
  const instanceDir = path.join(workRoot, instanceId);
  const workspaceDir = path.join(instanceDir, "workspace");
  const runRecordPath = path.join(outDir, "runs", `${instanceId}.json`);
  const predictionsPath = path.join(outDir, "predictions.jsonl");

  const baseRecord = {
    instance_id: instanceId,
    repo: instance.repo,
    base_commit: instance.base_commit,
    started_at: startedAt.toISOString(),
    finished_at: null,
    wallclock_seconds: 0,
    status: "agent_error",
    scenario: null,
    aura_payload: null,
    patch: {
      lines: 0,
      files_changed: 0,
      files_changed_list: [],
      tests_directory_hits_stripped: 0,
      empty: true,
    },
    error: null,
    cost_usd: 0,
    total_tokens: 0,
  };

  log(`begin ${instanceId} (${instance.repo} @ ${instance.base_commit})`);

  // 1. Clone workspace.
  const cloneOutcome = await shallowCloneInstance(
    instance.repo,
    instance.base_commit,
    workspaceDir,
    (msg) => log(`[clone] ${msg}`),
  );
  if (!cloneOutcome.ok) {
    log(`clone failed (${cloneOutcome.stage}): ${cloneOutcome.stderr}`);
    baseRecord.status = "clone_error";
    baseRecord.error = `${cloneOutcome.stage}: ${cloneOutcome.stderr}`;
    baseRecord.finished_at = new Date().toISOString();
    baseRecord.wallclock_seconds =
      (Date.now() - startedAt.getTime()) / 1000;
    await writeJson(runRecordPath, baseRecord);
    await appendJsonl(predictionsPath, {
      instance_id: instanceId,
      model_name_or_path: "AURA",
      model_patch: "",
    });
    resultsRef.records.push(baseRecord);
    return baseRecord;
  }

  // 2. Write requirements.md inside the workspace root.
  const requirementsMd = buildRequirementsMd(instance);
  await fs.writeFile(
    path.join(workspaceDir, "requirements.md"),
    requirementsMd,
    "utf8",
  );
  log(`wrote requirements.md`);

  // 3. Build scenario and run.
  const scenario = buildScenario(instance, workspaceDir);
  baseRecord.scenario = scenario;

  let auraPayload = null;
  let auraError = null;
  try {
    auraPayload = await runScenario(scenario, {
      client,
      keepEntities: args.keepEntities,
      fixtureIgnore: PYTHON_FIXTURE_IGNORE,
      onProgress: (event) => {
        const summary = event.summary ?? event.step;
        process.stderr.write(
          `[swebench ${instanceId}] ${event.step}: ${summary}\n`,
        );
      },
    });
    log(`AURA pipeline finished (runId=${auraPayload.runId})`);
  } catch (error) {
    auraError = error instanceof Error ? error : new Error(String(error));
    log(`AURA pipeline threw: ${auraError.message}`);
  }

  baseRecord.aura_payload = auraPayload;

  // 4. Capture diff.
  const diffOutcome = await captureWorkspaceDiff(
    workspaceDir,
    instance.base_commit,
  );
  if (!diffOutcome.ok) {
    log(`workspace diff failed: ${diffOutcome.stderr}`);
  } else {
    log(`captured diff (${diffOutcome.patch.length} bytes)`);
  }
  let rawPatch = diffOutcome.patch ?? "";

  // 5. Strip test edits.
  let strippedHunks = 0;
  let modelPatch = rawPatch;
  if (args.stripTestEdits) {
    const stripped = stripTestEditsFromDiff(rawPatch);
    modelPatch = stripped.patch;
    strippedHunks = stripped.strippedHunks;
    if (strippedHunks > 0) {
      log(`stripped ${strippedHunks} hunks under test paths`);
    }
  }

  const filesChanged = parseDiffFiles(modelPatch);
  baseRecord.patch = {
    lines:
      modelPatch.length === 0
        ? 0
        : modelPatch.split("\n").length - (modelPatch.endsWith("\n") ? 1 : 0),
    files_changed: filesChanged.length,
    files_changed_list: filesChanged,
    tests_directory_hits_stripped: strippedHunks,
    empty: modelPatch.length === 0,
  };

  // 6. Determine status.
  if (auraError) {
    baseRecord.status = "agent_error";
    baseRecord.error = auraError.message;
  } else {
    baseRecord.status = "agent_complete";
  }

  baseRecord.cost_usd = Number(auraPayload?.metrics?.estimatedCostUsd ?? 0);
  baseRecord.total_tokens = Number(auraPayload?.metrics?.totalTokens ?? 0);

  baseRecord.finished_at = new Date().toISOString();
  baseRecord.wallclock_seconds = (Date.now() - startedAt.getTime()) / 1000;

  // 7. Persist outputs.
  await appendJsonl(predictionsPath, {
    instance_id: instanceId,
    model_name_or_path: "AURA",
    model_patch: modelPatch,
  });
  await writeJson(runRecordPath, baseRecord);
  log(
    `done ${instanceId} status=${baseRecord.status} cost=$${baseRecord.cost_usd.toFixed(
      4,
    )} files=${filesChanged.length}`,
  );

  costState.totalCostUsd += baseRecord.cost_usd;
  resultsRef.records.push(baseRecord);
  return baseRecord;
}

// ---------------------------------------------------------------------------
// Async pool
// ---------------------------------------------------------------------------

export async function runWithPool(items, concurrency, worker) {
  if (concurrency <= 1 || items.length <= 1) {
    const results = [];
    for (const item of items) {
      // eslint-disable-next-line no-await-in-loop
      results.push(await worker(item));
    }
    return results;
  }

  const results = new Array(items.length);
  let cursor = 0;
  const runners = [];
  for (let i = 0; i < Math.min(concurrency, items.length); i += 1) {
    runners.push(
      (async () => {
        // Each runner pulls the next index until exhausted.
        while (cursor < items.length) {
          const index = cursor;
          cursor += 1;
          // eslint-disable-next-line no-await-in-loop
          results[index] = await worker(items[index]);
        }
      })(),
    );
  }
  await Promise.all(runners);
  return results;
}

// ---------------------------------------------------------------------------
// Driver entry
// ---------------------------------------------------------------------------

function newRunId() {
  const ts = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "");
  return `aura-${ts}-${process.pid}`;
}

async function main(rawArgv) {
  const argv = rawArgv ?? process.argv.slice(2);
  let args;
  try {
    args = parseArgs(argv);
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

  const apiBaseUrl =
    process.env.AURA_EVAL_API_BASE_URL?.trim()
    || process.env.AURA_EVAL_BASE_URL?.trim()
    || "http://127.0.0.1:3190";
  const accessToken = process.env.AURA_EVAL_ACCESS_TOKEN?.trim() || "";
  const storageUrl = process.env.AURA_EVAL_STORAGE_URL?.trim() || "";

  if (!accessToken) {
    process.stderr.write(
      "Error: AURA_EVAL_ACCESS_TOKEN is not set. Bring up the local stack and bootstrap an access token first.\n",
    );
    process.exit(2);
    return;
  }

  const runId = newRunId();
  const outDir = args.out
    ? path.resolve(args.out)
    : path.join(driverDir, ".runtime", runId);

  await fs.mkdir(outDir, { recursive: true });
  const workRoot = path.join(outDir, "work");
  await fs.mkdir(workRoot, { recursive: true });

  // Load and filter the manifest.
  let manifestRecords;
  try {
    manifestRecords = await loadManifest(args.subset);
  } catch (error) {
    process.stderr.write(`Error: ${error.message}\n`);
    process.exit(2);
    return;
  }

  const selected = applyInstanceFilters(manifestRecords, args);
  if (selected.length === 0) {
    process.stderr.write(
      `No instances matched the supplied filters (subset=${args.subset}).\n`,
    );
    process.exit(1);
    return;
  }

  process.stderr.write(
    `[swebench] subset=${args.subset} selected=${selected.length} out=${outDir}\n`,
  );

  const client = createBenchmarkClient({
    apiBaseUrl,
    accessToken,
    storageUrl,
    verbose: process.env.AURA_EVAL_VERBOSE === "1",
  });

  const startedAt = new Date();
  const costCap = process.env.AURA_BENCH_MAX_USD
    ? Number(process.env.AURA_BENCH_MAX_USD)
    : null;
  const costState = { totalCostUsd: 0, aborted: false };
  const resultsRef = { records: [] };

  const log = (instanceId, msg) =>
    process.stderr.write(`[swebench ${instanceId}] ${msg}\n`);

  const worker = async (instance) => {
    if (costState.aborted) {
      const skipped = {
        instance_id: instance.instance_id,
        repo: instance.repo,
        base_commit: instance.base_commit,
        status: "skipped_cost_cap",
        skipped_reason: `Cost cap exceeded ($${costState.totalCostUsd.toFixed(4)} >= $${costCap})`,
        started_at: new Date().toISOString(),
        finished_at: new Date().toISOString(),
        wallclock_seconds: 0,
        cost_usd: 0,
        total_tokens: 0,
        patch: {
          lines: 0,
          files_changed: 0,
          files_changed_list: [],
          tests_directory_hits_stripped: 0,
          empty: true,
        },
      };
      resultsRef.records.push(skipped);
      return skipped;
    }
    const record = await runOneInstance({
      instance,
      args,
      client,
      outDir,
      workRoot,
      log: (msg) => log(instance.instance_id, msg),
      costState,
      resultsRef,
    });
    if (
      Number.isFinite(costCap)
      && costCap > 0
      && costState.totalCostUsd >= costCap
    ) {
      costState.aborted = true;
      process.stderr.write(
        `[swebench] cost cap reached ($${costState.totalCostUsd.toFixed(4)} >= $${costCap}); aborting remaining instances\n`,
      );
    }
    return record;
  };

  await runWithPool(selected, args.concurrency, worker);

  const finishedAt = new Date();
  const wallclockSeconds = (finishedAt.getTime() - startedAt.getTime()) / 1000;

  // Aggregate.
  const statusCounts = {
    agent_complete: 0,
    agent_error: 0,
    clone_error: 0,
    skipped_cost_cap: 0,
  };
  const claudeModels = new Set();
  let totalCost = 0;
  let totalTokens = 0;
  let totalStripped = 0;
  for (const record of resultsRef.records) {
    statusCounts[record.status] = (statusCounts[record.status] ?? 0) + 1;
    totalCost += Number(record.cost_usd ?? 0);
    totalTokens += Number(record.total_tokens ?? 0);
    totalStripped +=
      Number(record.patch?.tests_directory_hits_stripped ?? 0);
    const richModels = record.aura_payload?.richUsageSummary?.models ?? [];
    for (const m of richModels) claudeModels.add(m);
  }

  const summary = {
    run_id: runId,
    subset: args.subset,
    instance_count: resultsRef.records.length,
    started_at: startedAt.toISOString(),
    finished_at: finishedAt.toISOString(),
    wallclock_seconds: wallclockSeconds,
    aura_version: readAuraVersion(),
    claude_model: Array.from(claudeModels).sort().join(",") || null,
    cost_usd: totalCost,
    total_tokens: totalTokens,
    status_counts: statusCounts,
    tests_directory_hits_stripped_total: totalStripped,
    aborted_due_to_cost_cap: costState.aborted,
    out_dir: outDir,
  };

  await writeJson(path.join(outDir, "driver-summary.json"), summary);
  process.stderr.write(
    `[swebench] summary: ${JSON.stringify({
      subset: summary.subset,
      instances: summary.instance_count,
      cost_usd: Number(totalCost.toFixed(4)),
      stripped: totalStripped,
      wallclock_seconds: Number(wallclockSeconds.toFixed(1)),
    })}\n`,
  );
  process.stdout.write(`${path.join(outDir, "driver-summary.json")}\n`);
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
      `[swebench] fatal: ${error?.stack ?? error?.message ?? String(error)}\n`,
    );
    process.exit(1);
  });
}

export { main, manifestPathForSubset, loadManifest, applyInstanceFilters };
