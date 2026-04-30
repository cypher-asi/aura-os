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
import { loadExternalBenchmarkEnv } from "../bin/load-env.mjs";
import {
  describeRequestContractSummary,
  extractRequestContractReports,
  extractTypedFailureReport,
  summarizeRequestContractReports,
} from "./lib/request-contract-reporting.mjs";

const currentFile = fileURLToPath(import.meta.url);
const driverDir = path.dirname(currentFile);
const repoRoot = path.resolve(driverDir, "..", "..", "..", "..");

export const SWEBENCH_VENV_DIR = ".venv-swebench";

const PYTHON_FIXTURE_IGNORE = Object.freeze([
  `**/${SWEBENCH_VENV_DIR}/**`,
  "**/__pycache__/**",
  "**/*.pyc",
  "**/.pytest_cache/**",
]);

export const BENCHMARK_DIRECTIVES = `## Benchmark constraints

- Do not modify or delete any existing test files (anything under \`tests/\`, \`test/\`, or files matching \`test_*.py\` / \`*_test.py\`). The reviewer applies a hidden test patch and will fail the run if existing tests are altered.
- Do not add new dependencies; install only what is already declared in the repo.
- Make the smallest viable change. Most fixes are 1-3 files and under ~30 lines.
- After changing source code, run the repository test suite with the configured project test command and make it pass before \`task_done\`. If the environment cannot run the suite because dependencies are missing or setup is broken, stop and explain the blocker in completion notes.
- Before any \`write_file\`, \`edit_file\`, or \`delete_file\`, briefly inspect the relevant code and call \`submit_plan\` with the target files so the harness unlocks file operations.
- Create one patch-producing implementation task for this instance. Do not split the work into standalone inspect, locate, or verify tasks; fold that work into the implementation task.
- Fold inspection/verification into the implementation task. Do not create a standalone verification-only task unless it genuinely needs no source edits.
- Before \`task_done\`, run the full configured test command. If the full suite is too slow after it starts, also run the strongest targeted semantic validation available and record both outcomes.
- Use the configured benchmark Python command for verification; do not switch to global Python or patch build/version/logger/compiler files to work around local environment setup.
- Before \`task_done\`, self-review the final patch: re-read every changed source file, compare the diff to the problem statement, confirm no existing tests or dependencies were changed, and remove any placeholder/debug code.
- Completion contract: if a task genuinely requires no file changes, call \`task_done\` with \`no_changes_needed: true\` and explain why in the notes. Otherwise the dev-loop completion gate rejects \`task_done\` because there are no file operations to verify.
`;

const STATUS_BLOCKED_CLOUDFLARE = "blocked_cloudflare";
const STATUS_SKIPPED_CLOUDFLARE = "skipped_cloudflare_block";
export const STATUS_VERIFICATION_ENVIRONMENT_BLOCKED = "verification_environment_blocked";
export const STATUS_AGENT_PATCH_POLLUTED = "agent_patch_polluted";
export const SWEBENCH_DEFAULT_BUILD_COMMAND = "node --version";
export const SWEBENCH_DEFAULT_TEST_COMMAND = "python -m pytest";
const MAX_BETWEEN_STEP_WAIT_MS = 1_000;

export function resolveSwebenchProjectCommand(envName, env = process.env) {
  const configured = env?.[envName];
  if (typeof configured === "string" && configured.trim().length > 0) {
    return configured;
  }
  return envName === "AURA_BENCH_TEST_COMMAND"
    ? SWEBENCH_DEFAULT_TEST_COMMAND
    : SWEBENCH_DEFAULT_BUILD_COMMAND;
}

function splitCommandLine(value) {
  const text = String(value ?? "").trim();
  if (!text) return [];
  const matches = text.match(/"([^"]+)"|'([^']+)'|[^\s]+/g) ?? [];
  return matches.map((part) => {
    if (
      (part.startsWith('"') && part.endsWith('"'))
      || (part.startsWith("'") && part.endsWith("'"))
    ) {
      return part.slice(1, -1);
    }
    return part;
  });
}

function commandForShell(parts) {
  return parts.map((part) => {
    const value = String(part);
    if (/^[A-Za-z0-9_./:=+-]+$/.test(value)) return value;
    return `"${value.replaceAll('"', '\\"')}"`;
  }).join(" ");
}

function runProcess(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: ["ignore", "pipe", "pipe"],
    cwd: options.cwd,
    encoding: "utf8",
    maxBuffer: options.maxBuffer ?? 32 * 1024 * 1024,
    timeout: options.timeoutMs,
  });
  if (result.error) {
    return { code: -1, stdout: result.stdout ?? "", stderr: result.error.message };
  }
  return {
    code: result.status ?? -1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function pythonCandidatesForWorkspace(workspaceDir, env = process.env, platform = process.platform) {
  const configured = splitCommandLine(env?.AURA_BENCH_PYTHON);
  if (configured.length > 0) {
    return [{ command: configured[0], args: configured.slice(1), source: "AURA_BENCH_PYTHON" }];
  }
  if (platform === "win32") {
    return [
      { command: "py", args: ["-3.10"], source: "py -3.10" },
      { command: "py", args: ["-3.9"], source: "py -3.9" },
      { command: "py", args: ["-3.11"], source: "py -3.11" },
      { command: "python", args: [], source: "python" },
    ];
  }
  return [
    { command: "python3.10", args: [], source: "python3.10" },
    { command: "python3.9", args: [], source: "python3.9" },
    { command: "python3", args: [], source: "python3" },
    { command: "python", args: [], source: "python" },
  ];
}

export function resolveSwebenchPython(workspaceDir, env = process.env, platform = process.platform) {
  const attempts = [];
  for (const candidate of pythonCandidatesForWorkspace(workspaceDir, env, platform)) {
    const version = runProcess(candidate.command, [...candidate.args, "--version"], {
      cwd: workspaceDir,
      timeoutMs: 15_000,
    });
    const output = `${version.stdout}\n${version.stderr}`.trim();
    attempts.push({ source: candidate.source, code: version.code, output });
    if (version.code !== 0) continue;
    const match = output.match(/Python\s+(\d+)\.(\d+)\.(\d+)/i);
    if (!match) continue;
    const major = Number(match[1]);
    const minor = Number(match[2]);
    if (major === 3 && minor >= 9 && minor <= 11) {
      return {
        ok: true,
        command: candidate.command,
        args: candidate.args,
        source: candidate.source,
        version: match[0],
        attempts,
      };
    }
  }
  return {
    ok: false,
    reason: "No compatible Python interpreter found for native SWE-bench verification. Install Python 3.9-3.11, set AURA_BENCH_PYTHON, or run from WSL/Linux.",
    attempts,
  };
}

export function swebenchVenvPythonPath(workspaceDir, platform = process.platform) {
  return platform === "win32"
    ? path.join(workspaceDir, SWEBENCH_VENV_DIR, "Scripts", "python.exe")
    : path.join(workspaceDir, SWEBENCH_VENV_DIR, "bin", "python");
}

export async function bootstrapSwebenchPythonEnv(workspaceDir, {
  env = process.env,
  platform = process.platform,
  log = () => {},
} = {}) {
  if (platform !== "win32" && env?.AURA_BENCH_FORCE_PYTHON_VENV !== "1") {
    return {
      ok: true,
      skipped: true,
      testCommand: resolveSwebenchProjectCommand("AURA_BENCH_TEST_COMMAND", env),
    };
  }
  if (env?.AURA_BENCH_SKIP_PYTHON_VENV === "1") {
    return {
      ok: true,
      skipped: true,
      testCommand: resolveSwebenchProjectCommand("AURA_BENCH_TEST_COMMAND", env),
    };
  }
  const resolved = resolveSwebenchPython(workspaceDir, env, platform);
  if (!resolved.ok) {
    return { ok: false, stage: "resolve_python", reason: resolved.reason, attempts: resolved.attempts };
  }

  const venvDir = path.join(workspaceDir, SWEBENCH_VENV_DIR);
  const venvPython = swebenchVenvPythonPath(workspaceDir, platform);
  if (!env?.AURA_BENCH_REUSE_PYTHON_VENV) {
    await fs.rm(venvDir, { recursive: true, force: true });
  }
  const create = runProcess(resolved.command, [...resolved.args, "-m", "venv", venvDir], {
    cwd: workspaceDir,
    timeoutMs: 120_000,
  });
  if (create.code !== 0) {
    return {
      ok: false,
      stage: "create_venv",
      reason: create.stderr || create.stdout || `venv creation exited ${create.code}`,
      python: resolved,
    };
  }
  log(`python env: created ${SWEBENCH_VENV_DIR} with ${resolved.source} (${resolved.version})`);

  if (env?.AURA_BENCH_BOOTSTRAP_PYTHON_DEPS !== "0") {
    const install = runProcess(venvPython, [
      "-m",
      "pip",
      "install",
      "--disable-pip-version-check",
      "pytest",
      "-e",
      ".",
    ], {
      cwd: workspaceDir,
      timeoutMs: 600_000,
      maxBuffer: 128 * 1024 * 1024,
    });
    if (install.code !== 0) {
      return {
        ok: false,
        stage: "install_deps",
        reason: install.stderr || install.stdout || `pip install exited ${install.code}`,
        python: resolved,
      };
    }
    log("python env: installed pytest and editable project");
  }

  return {
    ok: true,
    python: resolved,
    venvDir,
    venvPython,
    testCommand: `${commandForShell([venvPython])} -m pytest`,
  };
}

function betweenStepWaitMs(value, fallback = MAX_BETWEEN_STEP_WAIT_MS) {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.floor(parsed), MAX_BETWEEN_STEP_WAIT_MS);
}

export function shouldWritePredictionForStatus(status) {
  return ![
    STATUS_BLOCKED_CLOUDFLARE,
    STATUS_SKIPPED_CLOUDFLARE,
  ].includes(status);
}

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
    resume: false,
    resumeValue: null,
    resumeIncludeErrors: false,
    retryUnresolvedFrom: null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const raw = argv[i];
    // Allow inline --flag=value for the few flags where it's natural.
    let arg = raw;
    let inlineValue = null;
    if (typeof raw === "string" && raw.startsWith("--")) {
      const eqIdx = raw.indexOf("=");
      if (eqIdx > 0) {
        arg = raw.slice(0, eqIdx);
        inlineValue = raw.slice(eqIdx + 1);
      }
    }
    const next = () => {
      if (inlineValue !== null) {
        const v = inlineValue;
        inlineValue = null;
        return v;
      }
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
      case "--resume": {
        args.resume = true;
        // Accept --resume=VALUE, or --resume VALUE when the next arg does not
        // look like another flag. Bare --resume means "auto-pick most recent".
        if (inlineValue !== null) {
          args.resumeValue = inlineValue;
          inlineValue = null;
        } else {
          const peek = argv[i + 1];
          if (typeof peek === "string" && !peek.startsWith("--")) {
            args.resumeValue = peek;
            i += 1;
          }
        }
        break;
      }
      case "--resume-include-errors":
        args.resumeIncludeErrors = true;
        break;
      case "--retry-unresolved-from":
        args.retryUnresolvedFrom = next();
        break;
      case "--help":
      case "-h":
        args.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${raw}`);
    }
    if (inlineValue !== null) {
      throw new Error(`Unexpected inline value for ${arg}`);
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
      `  --concurrency N         request up to N instances in parallel (max 4;\n` +
      `                          effective max is 1 unless AURA_BENCH_ALLOW_PARALLEL=1)\n` +
      `  --resume [RUN_ID|DIR]   reuse an existing run dir; with no value, pick the most\n` +
      `                          recent aura-* dir under infra/evals/reports/external/\n` +
      `                          swebench_verified/. Already-recorded instances are skipped.\n` +
      `  --resume-include-errors when resuming, also skip instances whose prior status was\n` +
      `                          agent_error (default: re-run them)\n` +
      `  --retry-unresolved-from DIR\n` +
      `                          run only unresolved instances from a prior score.json and\n` +
      `                          append their official failure context to requirements.md\n` +
      `  -h, --help              print this help\n`,
  );
}

// ---------------------------------------------------------------------------
// requirements.md
// ---------------------------------------------------------------------------

function formatRetryValue(value) {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function buildRequirementsMd(instance, retryContext = null) {
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

  if (retryContext) {
    const retryLines = [
      `Prior status: ${retryContext.status ?? "unresolved"}`,
      retryContext.failed_to_pass_results
        ? `Failed-to-pass results:\n${formatRetryValue(retryContext.failed_to_pass_results)}`
        : "",
      retryContext.passed_to_pass_results
        ? `Passed-to-pass results:\n${formatRetryValue(retryContext.passed_to_pass_results)}`
        : "",
      retryContext.previous_patch_summary
        ? `Previous patch summary: ${retryContext.previous_patch_summary}`
        : "",
    ].filter((line) => line.trim().length > 0);
    sections.push(
      "",
      "## Previous official evaluation",
      "",
      "This is a repair attempt for an unresolved prior run. Use the official failure context below to fix the previous patch rather than starting from scratch.",
      "",
      ...retryLines,
    );
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

function normalizeDiffPath(rawPath) {
  if (!rawPath || rawPath === "/dev/null") return null;
  let cleaned = rawPath.trim().replace(/\\/g, "/");
  if (cleaned.startsWith("a/") || cleaned.startsWith("b/")) {
    cleaned = cleaned.slice(2);
  }
  return cleaned.length > 0 ? cleaned : null;
}

function isBenchmarkArtifactPath(rawPath) {
  const cleaned = normalizeDiffPath(rawPath);
  if (!cleaned) return false;
  return cleaned === "requirements.md"
    || cleaned.startsWith("spec/")
    || cleaned === SWEBENCH_VENV_DIR
    || cleaned.startsWith(`${SWEBENCH_VENV_DIR}/`);
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

function compactTitle(title, maxLength = 96) {
  const normalized = String(title ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1)}…`;
}

function formatProgressEvent(event) {
  const details = event?.details;
  if (!details || typeof details !== "object") {
    return `${event.step}: ${event.summary ?? event.step}`;
  }

  if (details.phase === "spec") {
    const current = details.current ?? "?";
    const total = details.total ?? "?";
    const percent = details.percent ?? 0;
    const status = details.status ?? "status";
    return `spec ${current}/${total} ${percent}% ${status}: ${compactTitle(details.title)}`;
  }

  if (details.phase === "task") {
    const current = details.current ?? "?";
    const total = details.total ?? "?";
    const percent = details.percent ?? 0;
    const status = details.status ?? "status";
    const specPart = Number.isFinite(details.specCurrent) && Number.isFinite(details.specTotal)
      ? ` spec ${details.specCurrent}/${details.specTotal}`
      : "";
    return `task ${current}/${total} ${percent}% ${status}${specPart}: ${compactTitle(details.title)}`;
  }

  return `${event.step}: ${event.summary ?? event.step}`;
}

function isCloudflareBlockText(value) {
  const text = String(value ?? "").toLowerCase();
  if (!text) return false;
  return text.includes("cloudflare block")
    || text.includes("cloudflare html")
    || text.includes("cf-ray")
    || text.includes("attention required")
    || text.includes("data-translate=\"block_headline\"")
    || text.includes("llm proxy returned cloudflare block")
    || (text.includes("403") && text.includes("<!doctype html"))
    || (text.includes("403 forbidden") && text.includes("cloudflare"));
}

function isCloudflareBlockError(error) {
  if (!error) return false;
  return isCloudflareBlockText(error.message)
    || isCloudflareBlockText(error.stack)
    || isCloudflareBlockText(error.cause?.message);
}

function cloudflareBlockReasonFromPayload(payload) {
  if (!payload || typeof payload !== "object") return null;
  if (isCloudflareBlockText(JSON.stringify(payload.taskOutputs ?? {}))) {
    return "Cloudflare block surfaced in task output";
  }

  const failedTasks = Number(payload.counts?.failedTasks ?? 0);
  const doneTasks = Number(payload.counts?.doneTasks ?? 0);
  const totalTokens = Number(payload.metrics?.totalTokens ?? 0);
  const buildSteps = Number(payload.metrics?.buildSteps ?? 0);
  const testSteps = Number(payload.metrics?.testSteps ?? 0);
  const unavailableOutputs = Object.values(payload.taskOutputs ?? {})
    .filter((output) => output && typeof output === "object")
    .every((output) => output.unavailable === true);

  if (failedTasks > 0 && doneTasks === 0 && totalTokens === 0 && buildSteps === 0 && testSteps === 0 && unavailableOutputs) {
    return "All dev-loop tasks failed before producing output or token usage, consistent with the Cloudflare-blocked harness path";
  }

  return null;
}

function requestContractInputsFromPayload(payload) {
  if (!payload || typeof payload !== "object") return [];
  const inputs = [
    payload,
    payload.request_contract,
    payload.requestContract,
    payload.request_contract_verdict,
    payload.requestContractVerdict,
    payload.classifier_verdict,
    payload.classifierVerdict,
  ].filter(Boolean);
  for (const key of [
    "request_contract_reports",
    "requestContractReports",
    "model_content_profiles",
    "modelContentProfiles",
    "classifier_verdicts",
    "classifierVerdicts",
  ]) {
    if (Array.isArray(payload[key])) inputs.push(...payload[key]);
  }
  return inputs;
}

export function requestContractSummaryFromPayload(payload) {
  return summarizeRequestContractReports(
    extractRequestContractReports(requestContractInputsFromPayload(payload), "aura-payload"),
  );
}

function conservativeConcurrency(args) {
  if (process.env.AURA_BENCH_ALLOW_PARALLEL === "1") {
    return args.concurrency;
  }
  return 1;
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

export function stripBenchmarkArtifactsFromDiff(diff) {
  const chunks = splitDiffIntoChunks(diff);
  if (chunks.length === 0) {
    return { patch: typeof diff === "string" ? diff : "", strippedHunks: 0 };
  }

  const kept = [];
  let strippedHunks = 0;

  for (const chunk of chunks) {
    const { oldPath, newPath } = parseDiffHeaderPaths(chunk.header);
    const { minus, plus } = extractMinusPlusPaths(chunk.lines);
    const candidates = [oldPath, newPath, minus, plus]
      .map(normalizeDiffPath)
      .filter(Boolean);

    if (candidates.some((value) => isBenchmarkArtifactPath(value))) {
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

function issueMentionsPathOrTopic(instance, filePath, topics = []) {
  const issueText = [
    instance?.problem_statement,
    instance?.hints_text,
  ].filter(Boolean).join("\n").toLowerCase();
  if (!issueText) return false;

  const normalized = normalizeDiffPath(filePath);
  const basename = normalized ? path.posix.basename(normalized).toLowerCase() : "";
  const stem = basename.replace(/\.[^.]+$/, "");
  const candidates = [
    normalized?.toLowerCase(),
    basename,
    stem,
    ...topics.map((topic) => String(topic).toLowerCase()),
  ].filter((value) => value && value.length >= 3);

  return candidates.some((candidate) => issueText.includes(candidate));
}

function diffChunkPath(chunk) {
  const { oldPath, newPath } = parseDiffHeaderPaths(chunk.header);
  const { minus, plus } = extractMinusPlusPaths(chunk.lines);
  return [newPath, plus, oldPath, minus]
    .map(normalizeDiffPath)
    .find(Boolean) ?? null;
}

function addedDiffText(chunk) {
  return chunk.lines
    .filter((line) => line.startsWith("+") && !line.startsWith("+++ "))
    .map((line) => line.slice(1))
    .join("\n");
}

function classifyPollutedChunk(chunk, instance) {
  const filePath = diffChunkPath(chunk);
  if (!filePath) return null;
  const normalized = filePath.replace(/\\/g, "/");
  const basename = path.posix.basename(normalized).toLowerCase();
  const lowerPath = normalized.toLowerCase();
  const addedText = addedDiffText(chunk).toLowerCase();
  const fullText = chunk.lines.join("\n").toLowerCase();

  const reasons = [];
  if (/^_(compiler|version)\.py$/i.test(basename)) {
    reasons.push("generated_python_build_metadata");
  }
  if (/(^|\/)(setup\.py|setup\.cfg|pyproject\.toml|meson\.build|cmakelists\.txt)$/i.test(lowerPath)) {
    reasons.push("build_system_workaround");
  }
  if (/(\bmsvc\b|visual c\+\+|distutils|setuptools|compiler = ['"]unknown['"])/i.test(addedText)) {
    reasons.push("native_build_workaround");
  }
  if (
    basename === "logger.py"
    && /(loggingerror|warnings\.showwarning|disable_warnings_logging|exception_logging_enabled)/i.test(fullText)
    && !issueMentionsPathOrTopic(instance, normalized, ["logger", "logging", "warning", "warnings"])
  ) {
    reasons.push("unrelated_logger_environment_workaround");
  }

  if (reasons.length === 0) return null;
  if (
    !reasons.includes("unrelated_logger_environment_workaround")
    && issueMentionsPathOrTopic(instance, normalized)
  ) {
    return null;
  }

  return { path: normalized, reasons };
}

function taskOutputText(auraPayload) {
  const outputs = auraPayload?.taskOutputs;
  if (!outputs || typeof outputs !== "object") return "";
  return Object.values(outputs)
    .map((output) => {
      if (typeof output === "string") return output;
      if (!output || typeof output !== "object") return "";
      return [
        output.output,
        output.error,
        ...(Array.isArray(output.test_steps)
          ? output.test_steps.map((step) => step?.output ?? step?.error ?? "")
          : []),
        ...(Array.isArray(output.build_steps)
          ? output.build_steps.map((step) => step?.output ?? step?.error ?? "")
          : []),
      ].filter(Boolean).join("\n");
    })
    .join("\n");
}

export function detectVerificationEnvironmentBlock({ auraPayload, platform = process.platform } = {}) {
  const text = taskOutputText(auraPayload).toLowerCase();
  const nativeWindows = platform === "win32";
  const unsupportedEnvironment =
    /\benvironment has issues unrelated\b/.test(text)
    || /\btest infrastructure cannot run\b/.test(text)
    || /\bcannot run due to\b/.test(text)
    || /\bbroken extension build\b/.test(text)
    || /\bvisual c\+\+\b|\bmsvc\b|\bnmake\b/.test(text)
    || /\bloggingerror\b/.test(text);

  if (!nativeWindows || !unsupportedEnvironment) {
    return { blocked: false, reason: null, platform, evidence: [] };
  }

  const evidence = [];
  if (/\bvisual c\+\+\b|\bmsvc\b|\bnmake\b/.test(text)) evidence.push("native_windows_compiler_failure");
  if (/\bloggingerror\b/.test(text)) evidence.push("astropy_logging_import_failure");
  if (/\benvironment has issues unrelated\b|\btest infrastructure cannot run\b|\bcannot run due to\b/.test(text)) {
    evidence.push("agent_reported_environment_blocker");
  }

  return {
    blocked: true,
    reason: "Native Windows/local verification environment cannot run this SWE-bench suite; official validation requires Linux, WSL, or macOS.",
    platform,
    evidence,
  };
}

export function guardSwebenchPredictionPatch({ patch, instance, auraPayload = null, platform = process.platform } = {}) {
  const originalPatch = typeof patch === "string" ? patch : "";
  const chunks = splitDiffIntoChunks(originalPatch);
  const kept = [];
  const polluted = [];

  for (const chunk of chunks) {
    const classification = classifyPollutedChunk(chunk, instance);
    if (classification) {
      polluted.push(classification);
      continue;
    }
    kept.push(chunk);
  }

  const cleanedPatch = polluted.length > 0 ? rejoinChunks(kept, originalPatch) : originalPatch;
  const preservedFiles = parseDiffFiles(cleanedPatch);
  const environment = detectVerificationEnvironmentBlock({ auraPayload, platform });

  return {
    ok: polluted.length === 0,
    status: polluted.length > 0
      ? STATUS_AGENT_PATCH_POLLUTED
      : environment.blocked
        ? STATUS_VERIFICATION_ENVIRONMENT_BLOCKED
        : null,
    patch: cleanedPatch,
    polluted_files: polluted.map((entry) => entry.path),
    polluted_hunks: polluted.length,
    pollution: polluted,
    preserved_files: preservedFiles,
    environment,
  };
}

function classifyAuraOutcome(payload) {
  if (!payload || typeof payload !== "object") return null;
  const doneTasks = Number(payload.counts?.doneTasks ?? 0);
  const failedTasks = Number(payload.counts?.failedTasks ?? 0);
  const taskCount = Number(payload.counts?.tasks ?? 0);

  if (failedTasks > 0) {
    return {
      status: "agent_error",
      message: `AURA dev loop finished with ${failedTasks} failed task(s) and ${doneTasks} done task(s)`,
    };
  }

  if (taskCount > 0 && doneTasks === 0) {
    return {
      status: "agent_error",
      message: "AURA dev loop finished without any done tasks",
    };
  }

  return null;
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

async function workspaceLooksReusable(destDir, baseCommit) {
  // Reusable iff the directory exists, has a .git, and HEAD is the requested
  // commit. This lets a resumed run skip the (slow) re-clone while still
  // catching anything stale (different base_commit, partial clone, etc.).
  try {
    const gitStat = await fs.stat(path.join(destDir, ".git"));
    if (!gitStat.isDirectory() && !gitStat.isFile()) return false;
  } catch {
    return false;
  }
  const headResult = runGit(["rev-parse", "HEAD"], { cwd: destDir });
  if (headResult.code !== 0) return false;
  const head = headResult.stdout.trim();
  return head === baseCommit;
}

async function shallowCloneInstance(repo, baseCommit, destDir, log) {
  if (await workspaceLooksReusable(destDir, baseCommit)) {
    log(`reused existing workspace at ${destDir} (HEAD=${baseCommit})`);
    return { ok: true, reused: true };
  }

  // Stale or partial state: wipe so `git clone` has a clean target. force:true
  // tolerates a missing dir; recursive removes any prior agent edits, which
  // are already captured (or not) in the prior runs/<id>.json.
  await fs.rm(destDir, { recursive: true, force: true });
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

  return { ok: true, reused: false };
}

async function excludeBenchmarkArtifactsFromWorkspace(workspaceDir) {
  const excludePath = path.join(workspaceDir, ".git", "info", "exclude");
  const entry = `\n# AURA SWE-bench local verification artifacts\n/${SWEBENCH_VENV_DIR}/\n`;
  try {
    const current = await fs.readFile(excludePath, "utf8");
    if (current.includes(`/${SWEBENCH_VENV_DIR}/`)) return;
    await fs.appendFile(excludePath, entry, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await fs.mkdir(path.dirname(excludePath), { recursive: true });
    await fs.writeFile(excludePath, entry.trimStart(), "utf8");
  }
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

export function buildScenario(instance, workspaceDir, options = {}) {
  const id = instance.instance_id;
  const testCommand = options.testCommand
    ?? resolveSwebenchProjectCommand("AURA_BENCH_TEST_COMMAND");
  const venvInstruction = options.pythonEnv?.testCommand
    ? ` Use the prepared benchmark Python environment for verification: \`${options.pythonEnv.testCommand}\`. Do not use global Python for this instance.`
    : "";
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
        "You are AURA running a single SWE-bench Verified instance. Read requirements.md first. Make the smallest patch that fixes the described bug. Do not edit existing tests. Keep the work as one patch-producing implementation task; do not split it into standalone inspect, locate, or verify tasks. Before any write_file, edit_file, or delete_file, briefly inspect the relevant code and call submit_plan with the target files so the harness unlocks file operations. Fold inspection and verification into the implementation work. After changing source code and before task_done, run the configured project test command for the full suite and make it pass."
        + venvInstruction
        + " If the suite cannot run because the environment is missing dependencies or setup, stop and explain the blocker in completion notes; do not patch build metadata, version files, compiler shims, logger/warning code, or dependency configuration merely to work around local verification environment problems unless the SWE-bench issue explicitly asks for those files. If the suite is too slow after starting, also run the strongest targeted semantic validation available and record both outcomes. Before task_done, self-review the final patch by re-reading every changed source file, comparing the diff to the problem statement, confirming no existing tests or dependencies changed, and removing placeholder/debug code. If a task genuinely requires no file changes, finish it with task_done and no_changes_needed: true plus notes explaining why.",
      machineType: process.env.AURA_BENCH_AGENT_MACHINE_TYPE ?? "local",
      adapterType: "aura_harness",
      environment: "local_host",
    },
    project: {
      name: `Aura SWE-bench ${id}`,
      description: `SWE-bench Verified instance ${id}`,
      fixtureAbsolutePath: workspaceDir,
      importByReference: true,
      buildCommand: resolveSwebenchProjectCommand("AURA_BENCH_BUILD_COMMAND"),
      testCommand,
      artifactChecks: [],
    },
    timeouts: {
      loginMs: 30000,
      loopCompletionMs: Number(
        process.env.AURA_BENCH_LOOP_TIMEOUT_MS ?? 1500000,
      ),
      pollIntervalMs: MAX_BETWEEN_STEP_WAIT_MS,
      modelCooldownMs: betweenStepWaitMs(process.env.AURA_BENCH_MODEL_COOLDOWN_MS),
    },
    verification: {
      requireNoFailedTasks: false,
      requireAnyDoneTasks: false,
      requireBuildSteps: false,
      requireTestSteps: true,
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

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Resume helpers
// ---------------------------------------------------------------------------

export const SWEBENCH_RUNS_PARENT = path.join(
  "infra",
  "evals",
  "reports",
  "external",
  "swebench_verified",
);

export function defaultRunsParentDir(rootDir) {
  return path.join(rootDir, SWEBENCH_RUNS_PARENT);
}

export async function findLatestRunDir(parentDir) {
  let entries;
  try {
    entries = await fs.readdir(parentDir, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  const candidates = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (!entry.name.startsWith("aura-")) continue;
    const fullPath = path.join(parentDir, entry.name);
    try {
      const stat = await fs.stat(fullPath);
      candidates.push({ path: fullPath, mtimeMs: stat.mtimeMs });
    } catch {
      // ignore stat failures (race / permission); skip the entry.
    }
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return candidates[0].path;
}

export async function resolveResumeOutDir({ resumeValue, explicitOut, rootDir }) {
  // Precedence: explicit --out beats anything if it exists; then resumeValue
  // (path or RUN_ID); then auto-pick latest under the standard reports dir.
  if (explicitOut) {
    const resolved = path.resolve(explicitOut);
    try {
      const stat = await fs.stat(resolved);
      if (stat.isDirectory()) return resolved;
    } catch {
      // fall through to other resolution strategies
    }
    throw new Error(
      `--out ${explicitOut} does not exist; cannot resume into a missing directory`,
    );
  }

  if (resumeValue) {
    // Treat as path if it contains a separator or is absolute.
    const looksLikePath = path.isAbsolute(resumeValue)
      || resumeValue.includes("/")
      || resumeValue.includes("\\");
    if (looksLikePath) {
      const candidates = [path.resolve(resumeValue)];
      if (rootDir) candidates.push(path.resolve(rootDir, resumeValue));
      for (const candidate of candidates) {
        try {
          const stat = await fs.stat(candidate);
          if (stat.isDirectory()) return candidate;
        } catch {
          // try next candidate
        }
      }
      throw new Error(`resume target '${resumeValue}' does not exist`);
    }
    // RUN_ID: resolve under the standard reports directory.
    const candidate = path.join(defaultRunsParentDir(rootDir), resumeValue);
    try {
      const stat = await fs.stat(candidate);
      if (stat.isDirectory()) return candidate;
    } catch {
      // fall through to error
    }
    throw new Error(`resume target '${candidate}' does not exist`);
  }

  // Auto-pick: most recently modified aura-* under the reports parent dir.
  const parent = defaultRunsParentDir(rootDir);
  const latest = await findLatestRunDir(parent);
  if (!latest) {
    throw new Error(
      `--resume specified but no aura-* run directories were found under ${parent}`,
    );
  }
  return latest;
}

const RESUMABLE_FINAL_STATUSES = new Set([
  "agent_complete",
  "clone_error",
  "skipped_cost_cap",
]);

export async function loadCompletedInstanceIds(outDir, { includeErrors = false } = {}) {
  const runsDir = path.join(outDir, "runs");
  const ids = new Set();
  let entries;
  try {
    entries = await fs.readdir(runsDir, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return ids;
    throw error;
  }
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    let parsed;
    try {
      const text = await fs.readFile(path.join(runsDir, entry.name), "utf8");
      parsed = JSON.parse(text);
    } catch {
      continue;
    }
    if (!parsed || typeof parsed.instance_id !== "string") continue;
    const status = typeof parsed.status === "string" ? parsed.status : "";
    if (RESUMABLE_FINAL_STATUSES.has(status)) {
      ids.add(parsed.instance_id);
      continue;
    }
    if (includeErrors && status === "agent_error") {
      ids.add(parsed.instance_id);
    }
  }
  return ids;
}

export async function loadPriorRunRecords(outDir) {
  const runsDir = path.join(outDir, "runs");
  const out = new Map();
  let entries;
  try {
    entries = await fs.readdir(runsDir, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return out;
    throw error;
  }
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    try {
      const text = await fs.readFile(path.join(runsDir, entry.name), "utf8");
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed.instance_id === "string") {
        out.set(parsed.instance_id, parsed);
      }
    } catch {
      // skip unreadable / malformed files
    }
  }
  return out;
}

export async function readDriverSummaryIfExists(outDir) {
  const filePath = path.join(outDir, "driver-summary.json");
  try {
    const text = await fs.readFile(filePath, "utf8");
    return JSON.parse(text);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    return null;
  }
}

export async function loadRetryUnresolvedContexts(runDir) {
  const score = await readJsonIfExists(path.join(runDir, "score.json"));
  if (!score || !Array.isArray(score.instances)) {
    throw new Error(`retry source ${runDir} has no score.json with instances`);
  }
  const contexts = new Map();
  for (const entry of score.instances) {
    if (!entry || typeof entry.instance_id !== "string") continue;
    if (entry.status === "resolved") continue;
    contexts.set(entry.instance_id, {
      status: entry.status ?? "not_resolved",
      failed_to_pass_results: entry.failed_to_pass_results ?? null,
      passed_to_pass_results: entry.passed_to_pass_results ?? null,
      previous_patch_summary: [
        `${entry.model_patch_lines ?? 0} patch lines`,
        `${entry.files_changed ?? 0} files changed`,
      ].join(", "),
    });
  }
  return contexts;
}

export async function loadPredictionInstanceIds(outDir) {
  const filePath = path.join(outDir, "predictions.jsonl");
  let text;
  try {
    text = await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return new Set();
    throw error;
  }
  const ids = new Set();
  const lines = text.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed.instance_id === "string") {
        ids.add(parsed.instance_id);
      }
    } catch {
      // ignore malformed lines
    }
  }
  return ids;
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
  recordedPredictionIds,
  retryContexts,
}) {
  const startedAt = new Date();
  const instanceId = instance.instance_id;
  const instanceDir = path.join(workRoot, instanceId);
  const workspaceDir = path.join(instanceDir, "workspace");
  const runRecordPath = path.join(outDir, "runs", `${instanceId}.json`);
  const predictionsPath = path.join(outDir, "predictions.jsonl");

  const writePrediction = async (record) => {
    if (recordedPredictionIds && recordedPredictionIds.has(instanceId)) {
      // The previous attempt already wrote a prediction for this id (e.g. a
      // clone_error retry). The harness scores the first matching line, so
      // skip the append rather than emit a duplicate that diverges from
      // runs/<id>.json.
      log(`predictions.jsonl already has ${instanceId}; skipping append`);
      return;
    }
    await appendJsonl(predictionsPath, record);
    if (recordedPredictionIds) recordedPredictionIds.add(instanceId);
  };

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
    request_contract: null,
    patch: {
      lines: 0,
      files_changed: 0,
      files_changed_list: [],
      tests_directory_hits_stripped: 0,
      empty: true,
    },
    error: null,
    failure_report: null,
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
    await writePrediction({
      instance_id: instanceId,
      model_name_or_path: "AURA",
      model_patch: "",
    });
    resultsRef.records.push(baseRecord);
    return baseRecord;
  }

  await excludeBenchmarkArtifactsFromWorkspace(workspaceDir);

  // 2. Prepare the Python verification environment before the agent sees the
  // workspace. This prevents native Windows runs from falling through to a
  // global Python that cannot run older SWE-bench projects like Astropy.
  const pythonEnv = await bootstrapSwebenchPythonEnv(workspaceDir, {
    log: (msg) => log(`[python] ${msg}`),
  });
  baseRecord.python_environment = pythonEnv.ok
    ? {
      ok: true,
      skipped: pythonEnv.skipped ?? false,
      source: pythonEnv.python?.source ?? null,
      version: pythonEnv.python?.version ?? null,
      test_command: pythonEnv.testCommand,
    }
    : pythonEnv;
  if (!pythonEnv.ok) {
    baseRecord.status = STATUS_VERIFICATION_ENVIRONMENT_BLOCKED;
    baseRecord.error = pythonEnv.reason;
    baseRecord.patch.verification_environment = {
      blocked: true,
      reason: pythonEnv.reason,
      platform: process.platform,
      evidence: [`python_env_${pythonEnv.stage}`],
      attempts: pythonEnv.attempts,
    };
    baseRecord.finished_at = new Date().toISOString();
    baseRecord.wallclock_seconds = (Date.now() - startedAt.getTime()) / 1000;
    await writeJson(runRecordPath, baseRecord);
    await writePrediction({
      instance_id: instanceId,
      model_name_or_path: "AURA",
      model_patch: "",
    });
    resultsRef.records.push(baseRecord);
    log(`verification environment blocked (${pythonEnv.stage}): ${pythonEnv.reason}`);
    return baseRecord;
  }

  // 3. Write requirements.md inside the workspace root.
  const retryContext = retryContexts?.get(instanceId) ?? null;
  const requirementsMd = buildRequirementsMd(instance, retryContext);
  await fs.writeFile(
    path.join(workspaceDir, "requirements.md"),
    requirementsMd,
    "utf8",
  );
  log(`wrote requirements.md`);

  // 4. Build scenario and run.
  const scenario = buildScenario(instance, workspaceDir, {
    testCommand: pythonEnv.testCommand,
    pythonEnv,
  });
  baseRecord.scenario = scenario;

  let auraPayload = null;
  let auraError = null;
  try {
    auraPayload = await runScenario(scenario, {
      client,
      keepEntities: args.keepEntities,
      fixtureIgnore: PYTHON_FIXTURE_IGNORE,
      onProgress: (event) => {
        process.stderr.write(`[swebench ${instanceId}] ${formatProgressEvent(event)}\n`);
      },
    });
    log(`AURA pipeline finished (runId=${auraPayload.runId})`);
    const blockReason = cloudflareBlockReasonFromPayload(auraPayload);
    if (blockReason) {
      costState.blocked = true;
      costState.blockReason = blockReason;
      auraError = new Error(blockReason);
      log("Cloudflare-like task failure detected; stopping additional SWE-bench scheduling");
    }
  } catch (error) {
    auraError = error instanceof Error ? error : new Error(String(error));
    if (error && typeof error === "object" && error.auraPayload) {
      auraPayload = error.auraPayload;
      baseRecord.aura_payload_recovered_from_error = true;
    }
    log(`AURA pipeline threw: ${auraError.message}`);
    const blockReason = isCloudflareBlockError(auraError)
      ? auraError.message
      : cloudflareBlockReasonFromPayload(auraPayload);
    if (blockReason) {
      costState.blocked = true;
      costState.blockReason = blockReason;
      log("Cloudflare block detected; stopping additional SWE-bench scheduling");
    }
  }

  baseRecord.aura_payload = auraPayload;
  const requestContractSummary = requestContractSummaryFromPayload(auraPayload);
  baseRecord.request_contract = requestContractSummary;
  if (requestContractSummary.available) {
    log(describeRequestContractSummary(requestContractSummary));
  }

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
  const artifactStripped = stripBenchmarkArtifactsFromDiff(modelPatch);
  modelPatch = artifactStripped.patch;
  if (artifactStripped.strippedHunks > 0) {
    log(`stripped ${artifactStripped.strippedHunks} benchmark setup artifact hunks`);
  }
  if (auraError && (isCloudflareBlockError(auraError) || cloudflareBlockReasonFromPayload(auraPayload))) {
    modelPatch = "";
    log("discarded patch because the run ended in a provider/proxy block");
  }

  const predictionGuard = guardSwebenchPredictionPatch({
    patch: modelPatch,
    instance,
    auraPayload,
  });
  if (predictionGuard.polluted_hunks > 0) {
    modelPatch = predictionGuard.patch;
    log(
      `stripped ${predictionGuard.polluted_hunks} polluted environment workaround hunk(s): `
        + predictionGuard.polluted_files.join(", "),
    );
  }

  const filesChanged = parseDiffFiles(modelPatch);
  const outcomeFailure = classifyAuraOutcome(auraPayload);
  if (!auraError && outcomeFailure) {
    auraError = new Error(outcomeFailure.message);
    log(`AURA pipeline produced a failed outcome: ${outcomeFailure.message}`);
  }
  if (!auraError && modelPatch.length === 0 && !predictionGuard.status) {
    auraError = new Error(
      "AURA dev loop completed without source changes after filtering benchmark artifacts and test edits",
    );
    log("AURA pipeline produced no source patch");
  }
  baseRecord.patch = {
    lines:
      modelPatch.length === 0
        ? 0
        : modelPatch.split("\n").length - (modelPatch.endsWith("\n") ? 1 : 0),
    files_changed: filesChanged.length,
    files_changed_list: filesChanged,
    tests_directory_hits_stripped: strippedHunks,
    benchmark_artifact_hunks_stripped: artifactStripped.strippedHunks,
    pollution_guard: {
      status: predictionGuard.status,
      polluted_hunks: predictionGuard.polluted_hunks,
      polluted_files: predictionGuard.polluted_files,
      preserved_files: predictionGuard.preserved_files,
      pollution: predictionGuard.pollution,
    },
    verification_environment: predictionGuard.environment,
    empty: modelPatch.length === 0,
  };

  // 6. Determine status.
  if (auraError) {
    const failureReport = extractTypedFailureReport({
      error: auraError,
      payload: auraPayload,
      requestContractSummary,
    });
    baseRecord.status = isCloudflareBlockError(auraError)
      || cloudflareBlockReasonFromPayload(auraPayload)
      ? STATUS_BLOCKED_CLOUDFLARE
      : "agent_error";
    baseRecord.error = failureReport.message;
    baseRecord.failure_report = failureReport;
    log(`typed failure: ${failureReport.message}`);
  } else if (predictionGuard.status) {
    const failureReport = extractTypedFailureReport({
      error: new Error(predictionGuard.status === STATUS_AGENT_PATCH_POLLUTED
        ? `agent_patch_polluted: ${predictionGuard.polluted_files.join(", ")}`
        : `${predictionGuard.status}: ${predictionGuard.environment.reason}`),
      requestContractSummary,
    });
    baseRecord.status = predictionGuard.status;
    baseRecord.error = predictionGuard.status === STATUS_AGENT_PATCH_POLLUTED
      ? `Prediction patch contained environment workaround pollution in: ${predictionGuard.polluted_files.join(", ")}`
      : predictionGuard.environment.reason;
    baseRecord.failure_report = failureReport;
  } else {
    baseRecord.status = "agent_complete";
  }

  baseRecord.cost_usd = Number(auraPayload?.metrics?.estimatedCostUsd ?? 0);
  baseRecord.total_tokens = Number(auraPayload?.metrics?.totalTokens ?? 0);

  baseRecord.finished_at = new Date().toISOString();
  baseRecord.wallclock_seconds = (Date.now() - startedAt.getTime()) / 1000;

  // 7. Persist outputs.
  if (shouldWritePredictionForStatus(baseRecord.status)) {
    await writePrediction({
      instance_id: instanceId,
      model_name_or_path: "AURA",
      model_patch: modelPatch,
    });
  } else {
    log(`skipped prediction for ${baseRecord.status}; retry after provider block clears`);
  }
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
  loadExternalBenchmarkEnv({ repoRoot });

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
      "Error: AURA_EVAL_ACCESS_TOKEN is not set in the environment, repo .env, or local-stack .runtime/auth.env. Bring up the local stack and bootstrap auth first.\n",
    );
    process.exit(2);
    return;
  }

  const runId = newRunId();
  let outDir;
  let resumed = false;
  if (args.resume) {
    try {
      outDir = await resolveResumeOutDir({
        resumeValue: args.resumeValue,
        explicitOut: args.out,
        rootDir: repoRoot,
      });
    } catch (error) {
      process.stderr.write(`Error: ${error.message}\n`);
      process.exit(2);
      return;
    }
    resumed = true;
    process.stderr.write(
      `[swebench] resume: reusing run directory ${outDir}\n`,
    );
  } else {
    outDir = args.out
      ? path.resolve(args.out)
      : path.join(driverDir, ".runtime", runId);
  }

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

  let selected = applyInstanceFilters(manifestRecords, args);
  let retryContexts = new Map();
  if (args.retryUnresolvedFrom) {
    const retryDir = path.resolve(args.retryUnresolvedFrom);
    retryContexts = await loadRetryUnresolvedContexts(retryDir);
    selected = selected.filter((instance) => retryContexts.has(instance.instance_id));
    process.stderr.write(
      `[swebench] retry-unresolved: selected ${selected.length} instance(s) from ${retryDir}\n`,
    );
  }

  // Build the dedup set up-front so workers (sequential or pooled) can avoid
  // double-appending to predictions.jsonl when a prior attempt already wrote
  // a row for the same instance id.
  const recordedPredictionIds = await loadPredictionInstanceIds(outDir);

  if (resumed) {
    const totalBeforeResume = selected.length;
    const completedIds = await loadCompletedInstanceIds(outDir, {
      includeErrors: args.resumeIncludeErrors,
    });
    if (completedIds.size > 0) {
      selected = selected.filter(
        (instance) => !completedIds.has(instance.instance_id),
      );
    }
    const skipped = totalBeforeResume - selected.length;
    process.stderr.write(
      `[swebench] resume: skipping ${skipped}/${totalBeforeResume} instances already recorded`
        + (args.resumeIncludeErrors ? " (including agent_error)" : "")
        + "\n",
    );
  }

  if (selected.length === 0) {
    process.stderr.write(
      resumed
        ? `[swebench] resume: nothing left to do; all selected instances already recorded in ${outDir}\n`
        : `No instances matched the supplied filters (subset=${args.subset}).\n`,
    );
    process.exit(resumed ? 0 : 1);
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
  const costState = {
    totalCostUsd: 0,
    aborted: false,
    blocked: false,
    blockReason: "",
  };
  const resultsRef = { records: [] };

  const log = (instanceId, msg) =>
    process.stderr.write(`[swebench ${instanceId}] ${msg}\n`);

  const worker = async (instance) => {
    if (costState.blocked) {
      const skipped = {
        instance_id: instance.instance_id,
        repo: instance.repo,
        base_commit: instance.base_commit,
        status: STATUS_SKIPPED_CLOUDFLARE,
        skipped_reason: costState.blockReason
          ? `Cloudflare block already detected: ${costState.blockReason}`
          : "Cloudflare block already detected",
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
      recordedPredictionIds,
      retryContexts,
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

  const effectiveConcurrency = conservativeConcurrency(args);
  if (effectiveConcurrency < args.concurrency) {
    process.stderr.write(
      `[swebench] conservative scheduling: requested concurrency=${args.concurrency}, effective concurrency=${effectiveConcurrency} (set AURA_BENCH_ALLOW_PARALLEL=1 to opt in to parallel instances)\n`,
    );
  }
  await runWithPool(selected, effectiveConcurrency, worker);

  const finishedAt = new Date();
  const wallclockSeconds = (finishedAt.getTime() - startedAt.getTime()) / 1000;

  // Aggregate. On a resume, fold prior runs/*.json records that we did not
  // re-process into the totals so driver-summary.json reflects the full run
  // rather than just this invocation.
  const recordsById = new Map();
  for (const record of resultsRef.records) {
    if (record && typeof record.instance_id === "string") {
      recordsById.set(record.instance_id, record);
    }
  }
  if (resumed) {
    const priorRecords = await loadPriorRunRecords(outDir);
    for (const [id, prior] of priorRecords) {
      if (!recordsById.has(id)) recordsById.set(id, prior);
    }
  }

  const statusCounts = {
    agent_complete: 0,
    agent_error: 0,
    [STATUS_BLOCKED_CLOUDFLARE]: 0,
    [STATUS_AGENT_PATCH_POLLUTED]: 0,
    [STATUS_VERIFICATION_ENVIRONMENT_BLOCKED]: 0,
    clone_error: 0,
    skipped_cost_cap: 0,
    [STATUS_SKIPPED_CLOUDFLARE]: 0,
  };
  const claudeModels = new Set();
  let totalCost = 0;
  let totalTokens = 0;
  let totalStripped = 0;
  const requestContractTotals = {
    available: false,
    total: 0,
    accepted: 0,
    blocked: 0,
    verdict_counts: {},
    request_kind_counts: {},
    acceptance: "not_available",
    first_blocked: null,
  };
  for (const record of recordsById.values()) {
    statusCounts[record.status] = (statusCounts[record.status] ?? 0) + 1;
    totalCost += Number(record.cost_usd ?? 0);
    totalTokens += Number(record.total_tokens ?? 0);
    totalStripped +=
      Number(record.patch?.tests_directory_hits_stripped ?? 0);
    if (record.request_contract?.available) {
      const contract = record.request_contract;
      requestContractTotals.available = true;
      requestContractTotals.total += Number(contract.total ?? 0);
      requestContractTotals.accepted += Number(contract.accepted ?? 0);
      requestContractTotals.blocked += Number(contract.blocked ?? 0);
      requestContractTotals.first_blocked ??= contract.first_blocked ?? null;
      for (const [verdict, count] of Object.entries(contract.verdict_counts ?? {})) {
        requestContractTotals.verdict_counts[verdict] =
          (requestContractTotals.verdict_counts[verdict] ?? 0) + Number(count ?? 0);
      }
      for (const [kind, count] of Object.entries(contract.request_kind_counts ?? {})) {
        requestContractTotals.request_kind_counts[kind] =
          (requestContractTotals.request_kind_counts[kind] ?? 0) + Number(count ?? 0);
      }
    }
    const richModels = record.aura_payload?.richUsageSummary?.models ?? [];
    for (const m of richModels) claudeModels.add(m);
  }
  if (requestContractTotals.available) {
    requestContractTotals.acceptance = requestContractTotals.blocked > 0 ? "fail" : "pass";
  }

  const priorSummary = resumed
    ? await readDriverSummaryIfExists(outDir)
    : null;

  const summary = {
    run_id: priorSummary?.run_id ?? runId,
    subset: args.subset,
    instance_count: recordsById.size,
    started_at: priorSummary?.started_at ?? startedAt.toISOString(),
    finished_at: finishedAt.toISOString(),
    wallclock_seconds: wallclockSeconds,
    aura_version: readAuraVersion(),
    claude_model: Array.from(claudeModels).sort().join(",") || null,
    cost_usd: totalCost,
    total_tokens: totalTokens,
    status_counts: statusCounts,
    tests_directory_hits_stripped_total: totalStripped,
    request_contract: requestContractTotals,
    aborted_due_to_cost_cap: costState.aborted,
    out_dir: outDir,
    resumed: resumed || undefined,
  };

  await writeJson(path.join(outDir, "driver-summary.json"), summary);
  process.stderr.write(
    `[swebench] summary: ${JSON.stringify({
      subset: summary.subset,
      instances: summary.instance_count,
      cost_usd: Number(totalCost.toFixed(4)),
      stripped: totalStripped,
      wallclock_seconds: Number(wallclockSeconds.toFixed(1)),
      request_contract: describeRequestContractSummary(summary.request_contract),
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
