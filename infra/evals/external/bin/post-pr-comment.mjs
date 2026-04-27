#!/usr/bin/env node
// Render the AURA external-benchmark score.json (SWE-bench Verified or
// Terminal-Bench 2 Core) as a markdown table, optionally comparing it to a
// stored baseline and optionally posting the result as a GitHub PR comment.
//
// Usage:
//   node infra/evals/external/bin/post-pr-comment.mjs \
//     --benchmark <swebench_verified|tbench_2_core> \
//     --score-file <path-to-score.json> \
//     [--baseline <path-to-baseline.json>] \
//     [--output <path-to-write-markdown-summary>] \
//     [--pr <number>]
//
// Exit code:
//   Always 0 — comment plumbing should never fail a benchmark workflow.
//
// No external dependencies (only Node built-ins).

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SUCCESS_STATUS_BY_BENCHMARK = Object.freeze({
  swebench_verified: "resolved",
  tbench_2_core: "passed",
});

const SUCCESS_LABEL_BY_BENCHMARK = Object.freeze({
  swebench_verified: "resolved",
  tbench_2_core: "passed",
});

const HUMAN_BENCHMARK_NAME = Object.freeze({
  swebench_verified: "SWE-bench Verified",
  tbench_2_core: "Terminal-Bench 2 Core",
});

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

export function parseArgs(argv) {
  const args = {
    benchmark: null,
    scoreFile: null,
    baseline: null,
    output: null,
    pr: null,
    help: false,
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
      case "--benchmark":
        args.benchmark = next();
        break;
      case "--score-file":
        args.scoreFile = next();
        break;
      case "--baseline":
        args.baseline = next();
        break;
      case "--output":
        args.output = next();
        break;
      case "--pr":
        args.pr = next();
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

function helpText() {
  return (
    `Usage: node infra/evals/external/bin/post-pr-comment.mjs \\\n` +
    `  --benchmark <swebench_verified|tbench_2_core> \\\n` +
    `  --score-file <path-to-score.json> \\\n` +
    `  [--baseline <path-to-baseline.json>] \\\n` +
    `  [--output <path-to-write-markdown-summary>] \\\n` +
    `  [--pr <number>]\n` +
    `\n` +
    `Reads a normalized score.json, renders a markdown delta-vs-baseline\n` +
    `summary, optionally writes it to a file (e.g. $GITHUB_STEP_SUMMARY),\n` +
    `and optionally posts it as a PR comment when GITHUB_TOKEN is set.\n` +
    `\n` +
    `Always exits 0 — the script intentionally does not fail the parent\n` +
    `workflow on missing files or transport errors.\n`
  );
}

// ---------------------------------------------------------------------------
// I/O helpers
// ---------------------------------------------------------------------------

export async function readJsonSafe(filePath) {
  if (!filePath) return null;
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error && error.code === "ENOENT") return null;
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function coerceNumber(value) {
  if (isFiniteNumber(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

export function formatPct(value) {
  const num = coerceNumber(value);
  if (num === null) return "—";
  return `${num.toFixed(2)}%`;
}

export function formatCost(value) {
  const num = coerceNumber(value);
  if (num === null) return "—";
  return `$${num.toFixed(2)}`;
}

export function formatTokens(value) {
  const num = coerceNumber(value);
  if (num === null) return "—";
  return Math.round(num).toLocaleString("en-US");
}

export function formatWallclockMinutes(seconds) {
  const num = coerceNumber(seconds);
  if (num === null) return "—";
  return `${Math.round(num / 60)}m`;
}

export function formatVersion(value) {
  if (typeof value === "string" && value.trim() !== "") return value.trim();
  return "—";
}

export function formatCount(numerator, denominator) {
  const n = coerceNumber(numerator);
  const d = coerceNumber(denominator);
  if (n === null && d === null) return "—";
  return `${n ?? 0}/${d ?? 0}`;
}

function formatDeltaWithSign(value, formatter) {
  if (value === 0) return "(no change)";
  const sign = value > 0 ? "+" : "-";
  const magnitude = Math.abs(value);
  return `${sign}${formatter(magnitude)}`;
}

export function formatPctDelta(newVal, baseVal) {
  const a = coerceNumber(newVal);
  const b = coerceNumber(baseVal);
  if (a === null || b === null) return "—";
  const delta = a - b;
  return formatDeltaWithSign(delta, (m) => `${m.toFixed(2)} pp`);
}

export function formatCountDelta(newVal, baseVal) {
  const a = coerceNumber(newVal);
  const b = coerceNumber(baseVal);
  if (a === null || b === null) return "—";
  const delta = Math.round(a) - Math.round(b);
  return formatDeltaWithSign(delta, (m) => `${m}`);
}

export function formatWallclockDelta(newSeconds, baseSeconds) {
  const a = coerceNumber(newSeconds);
  const b = coerceNumber(baseSeconds);
  if (a === null || b === null) return "—";
  const delta = Math.round(a / 60) - Math.round(b / 60);
  return formatDeltaWithSign(delta, (m) => `${m}m`);
}

export function formatCostDelta(newVal, baseVal) {
  const a = coerceNumber(newVal);
  const b = coerceNumber(baseVal);
  if (a === null || b === null) return "—";
  const delta = a - b;
  return formatDeltaWithSign(delta, (m) => `$${m.toFixed(2)}`);
}

export function formatTokensDelta(newVal, baseVal) {
  const a = coerceNumber(newVal);
  const b = coerceNumber(baseVal);
  if (a === null || b === null) return "—";
  const delta = Math.round(a) - Math.round(b);
  return formatDeltaWithSign(delta, (m) => m.toLocaleString("en-US"));
}

// ---------------------------------------------------------------------------
// Per-instance status counts
// ---------------------------------------------------------------------------

export function countByStatus(score) {
  const counts = new Map();
  if (!score || !Array.isArray(score.instances)) return counts;
  for (const entry of score.instances) {
    const status =
      entry && typeof entry.status === "string" && entry.status.length > 0
        ? entry.status
        : "unknown";
    counts.set(status, (counts.get(status) ?? 0) + 1);
  }
  return counts;
}

export function countSuccess(score, benchmark) {
  if (!score) return 0;
  const successStatus = SUCCESS_STATUS_BY_BENCHMARK[benchmark] ?? null;
  if (
    successStatus === "resolved"
    && typeof score.resolved === "number"
    && Number.isFinite(score.resolved)
  ) {
    return score.resolved;
  }
  if (!Array.isArray(score.instances)) return 0;
  if (!successStatus) return 0;
  let n = 0;
  for (const entry of score.instances) {
    if (entry && entry.status === successStatus) n += 1;
  }
  return n;
}

// ---------------------------------------------------------------------------
// Markdown rendering
// ---------------------------------------------------------------------------

function pickSubsetLabel(score, baseline) {
  return score?.subset ?? baseline?.subset ?? "unknown";
}

function pickInstanceCount(score) {
  if (score && Number.isFinite(Number(score.instance_count))) {
    return Number(score.instance_count);
  }
  if (score && Array.isArray(score.instances)) return score.instances.length;
  return 0;
}

function renderMainTable({ benchmark, score, baseline }) {
  const successLabel = SUCCESS_LABEL_BY_BENCHMARK[benchmark] ?? "succeeded";
  const newSuccess = countSuccess(score, benchmark);
  const newCount = pickInstanceCount(score);

  const hasBaseline = baseline !== null && baseline !== undefined;
  const baselineSuccess = hasBaseline ? countSuccess(baseline, benchmark) : null;
  const baselineCount = hasBaseline ? pickInstanceCount(baseline) : null;

  const headerCols = hasBaseline
    ? ["metric", "new", "baseline", "delta"]
    : ["metric", "new", "baseline"];
  const lines = [];
  lines.push(`| ${headerCols.join(" | ")} |`);
  lines.push(`| ${headerCols.map(() => "---").join(" | ")} |`);

  const row = (cells) => {
    if (!hasBaseline) cells = cells.slice(0, 3);
    lines.push(`| ${cells.join(" | ")} |`);
  };

  row([
    "score",
    formatPct(score?.score),
    hasBaseline ? formatPct(baseline?.score) : "—",
    hasBaseline ? formatPctDelta(score?.score, baseline?.score) : "—",
  ]);

  row([
    successLabel,
    formatCount(newSuccess, newCount),
    hasBaseline ? formatCount(baselineSuccess, baselineCount) : "—",
    hasBaseline ? formatCountDelta(newSuccess, baselineSuccess) : "—",
  ]);

  row([
    "wallclock",
    formatWallclockMinutes(score?.wallclock_seconds),
    hasBaseline ? formatWallclockMinutes(baseline?.wallclock_seconds) : "—",
    hasBaseline
      ? formatWallclockDelta(score?.wallclock_seconds, baseline?.wallclock_seconds)
      : "—",
  ]);

  row([
    "cost",
    formatCost(score?.cost_usd),
    hasBaseline ? formatCost(baseline?.cost_usd) : "—",
    hasBaseline ? formatCostDelta(score?.cost_usd, baseline?.cost_usd) : "—",
  ]);

  row([
    "total_tokens",
    formatTokens(score?.total_tokens),
    hasBaseline ? formatTokens(baseline?.total_tokens) : "—",
    hasBaseline
      ? formatTokensDelta(score?.total_tokens, baseline?.total_tokens)
      : "—",
  ]);

  row([
    "aura_version",
    formatVersion(score?.aura_version),
    hasBaseline ? formatVersion(baseline?.aura_version) : "—",
    "—",
  ]);

  return lines.join("\n");
}

function renderStatusCountsTable(score) {
  const counts = countByStatus(score);
  if (counts.size === 0) return "";
  const sorted = Array.from(counts.entries()).sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return a[0].localeCompare(b[0]);
  });
  const lines = ["## Per-instance status counts", "", "| status | count |", "| --- | --- |"];
  for (const [status, count] of sorted) {
    lines.push(`| ${status} | ${count} |`);
  }
  return lines.join("\n");
}

export function renderMarkdown({ benchmark, score, baseline, scoreFile }) {
  if (!score) {
    return (
      `## ${HUMAN_BENCHMARK_NAME[benchmark] ?? benchmark ?? "External benchmark"}\n` +
      `\n` +
      `> Note: no score.json was found at \`${scoreFile ?? "(unknown)"}\`. ` +
      `Skipping comparison.\n`
    );
  }

  const human = HUMAN_BENCHMARK_NAME[benchmark] ?? benchmark ?? "External benchmark";
  const subset = pickSubsetLabel(score, baseline);
  const instanceCount = pickInstanceCount(score);

  const sections = [];
  sections.push(
    `## ${human}\n\n` +
      `**subset:** \`${subset}\` &nbsp;·&nbsp; **instances:** ${instanceCount}`,
  );

  sections.push(renderMainTable({ benchmark, score, baseline }));

  const note =
    typeof score.confidence_note === "string" ? score.confidence_note.trim() : "";
  if (note.length > 0) {
    sections.push(`> **Note:** ${note}`);
  }

  const statusTable = renderStatusCountsTable(score);
  if (statusTable.length > 0) {
    sections.push(statusTable);
  }

  if (scoreFile) {
    sections.push(`Source: [\`score.json\`](${scoreFile})`);
  }

  return `${sections.join("\n\n")}\n`;
}

// ---------------------------------------------------------------------------
// GitHub REST API
// ---------------------------------------------------------------------------

export async function postPrComment({ owner, repo, pr, body, token, fetchImpl }) {
  const url = `https://api.github.com/repos/${owner}/${repo}/issues/${pr}/comments`;
  const f = fetchImpl ?? globalThis.fetch;
  if (typeof f !== "function") {
    throw new Error("fetch is not available in this Node runtime");
  }
  const response = await f(url, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      "User-Agent": "aura-external-benchmarks",
    },
    body: JSON.stringify({ body }),
  });
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  return { ok: response.ok, status: response.status, payload };
}

// ---------------------------------------------------------------------------
// Main entrypoint (returns the exit code instead of calling process.exit)
// ---------------------------------------------------------------------------

export async function main(argv = process.argv.slice(2), io = {}) {
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;
  const env = io.env ?? process.env;

  let args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    stderr.write(`post-pr-comment: ${error.message}\n\n`);
    stderr.write(helpText());
    return 0;
  }

  if (args.help) {
    stdout.write(helpText());
    return 0;
  }

  if (!args.scoreFile) {
    stderr.write(
      `post-pr-comment: --score-file is required; nothing to do.\n`,
    );
    return 0;
  }

  const benchmark = args.benchmark ?? null;
  const scoreFileAbs = path.resolve(args.scoreFile);

  const score = await readJsonSafe(scoreFileAbs);
  if (!score) {
    stderr.write(
      `post-pr-comment: warning: could not read score.json at ${scoreFileAbs}; ` +
        `emitting placeholder markdown.\n`,
    );
    const placeholder = renderMarkdown({
      benchmark,
      score: null,
      baseline: null,
      scoreFile: args.scoreFile,
    });
    stdout.write(placeholder);
    if (args.output) {
      try {
        await fs.mkdir(path.dirname(path.resolve(args.output)), { recursive: true });
        await fs.appendFile(path.resolve(args.output), placeholder, "utf8");
      } catch (error) {
        stderr.write(`post-pr-comment: warning: failed to write --output: ${error.message}\n`);
      }
    }
    return 0;
  }

  let baseline = null;
  if (args.baseline) {
    baseline = await readJsonSafe(path.resolve(args.baseline));
    if (!baseline) {
      stderr.write(
        `post-pr-comment: warning: baseline file ${args.baseline} not found ` +
          `or unreadable; rendering without delta column.\n`,
      );
    }
  }

  const markdown = renderMarkdown({
    benchmark,
    score,
    baseline,
    scoreFile: args.scoreFile,
  });

  stdout.write(markdown);

  if (args.output) {
    try {
      const outPath = path.resolve(args.output);
      await fs.mkdir(path.dirname(outPath), { recursive: true });
      await fs.appendFile(outPath, markdown, "utf8");
    } catch (error) {
      stderr.write(`post-pr-comment: warning: failed to write --output: ${error.message}\n`);
    }
  }

  if (args.pr) {
    const token = env.GITHUB_TOKEN ?? "";
    const repository = env.GITHUB_REPOSITORY ?? "";
    if (!token) {
      stderr.write(`post-pr-comment: skip PR post (no GITHUB_TOKEN)\n`);
      return 0;
    }
    if (!repository.includes("/")) {
      stderr.write(
        `post-pr-comment: skip PR post (GITHUB_REPOSITORY must look like owner/repo, ` +
          `got "${repository}")\n`,
      );
      return 0;
    }
    const [owner, repo] = repository.split("/", 2);
    try {
      const result = await postPrComment({
        owner,
        repo,
        pr: args.pr,
        body: markdown,
        token,
      });
      if (!result.ok) {
        stderr.write(
          `post-pr-comment: warning: GitHub API replied ${result.status}: ` +
            `${JSON.stringify(result.payload).slice(0, 200)}\n`,
        );
      } else {
        stderr.write(`post-pr-comment: posted comment to ${repository}#${args.pr}\n`);
      }
    } catch (error) {
      stderr.write(
        `post-pr-comment: warning: GitHub POST failed: ${error?.message ?? error}\n`,
      );
    }
  }

  return 0;
}

const currentFile = fileURLToPath(import.meta.url);
const isDirect = (() => {
  try {
    return process.argv[1] && path.resolve(process.argv[1]) === currentFile;
  } catch {
    return false;
  }
})();

if (isDirect) {
  main()
    .then((code) => process.exit(code))
    .catch((error) => {
      process.stderr.write(
        `post-pr-comment: fatal: ${error?.stack ?? error?.message ?? String(error)}\n`,
      );
      process.exit(0);
    });
}
