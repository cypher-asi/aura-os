#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

function parseArgs(argv) {
  const options = {
    repo: process.env.GITHUB_REPOSITORY || "",
    runId: process.env.GITHUB_RUN_ID || "",
    outDir: "ci-run-timings",
    topSteps: 20,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--repo") {
      options.repo = next || "";
      index += 1;
      continue;
    }
    if (arg === "--run-id") {
      options.runId = next || "";
      index += 1;
      continue;
    }
    if (arg === "--out-dir") {
      options.outDir = next || "";
      index += 1;
      continue;
    }
    if (arg === "--top-steps") {
      options.topSteps = Number(next);
      index += 1;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }

  if (!options.repo) {
    throw new Error("--repo or GITHUB_REPOSITORY is required");
  }
  if (!options.runId) {
    throw new Error("--run-id or GITHUB_RUN_ID is required");
  }
  if (!options.outDir) {
    throw new Error("--out-dir is required");
  }
  if (!Number.isFinite(options.topSteps) || options.topSteps < 1) {
    throw new Error("--top-steps must be a positive number");
  }

  return options;
}

function tokenFromGhCli() {
  const result = spawnSync("gh", ["auth", "token"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (result.status !== 0) return "";
  return result.stdout.trim();
}

function resolveToken() {
  return process.env.GITHUB_TOKEN || process.env.GH_TOKEN || tokenFromGhCli();
}

async function githubApi(pathname, query = {}) {
  const apiBase = process.env.GITHUB_API_URL || "https://api.github.com";
  const token = resolveToken();
  if (!token) {
    throw new Error("GITHUB_TOKEN/GH_TOKEN is required, or authenticate gh CLI first");
  }

  const url = new URL(`${apiBase}${pathname}`);
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, String(value));
  }

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      Accept: "application/vnd.github+json",
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub API ${response.status} for ${url}: ${body}`);
  }

  return response.json();
}

async function listAll(pathname, key) {
  const items = [];
  for (let page = 1; ; page += 1) {
    const payload = await githubApi(pathname, { per_page: 100, page });
    const pageItems = payload[key] ?? [];
    items.push(...pageItems);
    if (pageItems.length < 100) {
      return items;
    }
  }
}

function parseTime(value) {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function durationMs(startedAt, completedAt) {
  const startedMs = parseTime(startedAt);
  const completedMs = parseTime(completedAt);
  if (startedMs == null || completedMs == null || completedMs < startedMs) {
    return null;
  }
  return completedMs - startedMs;
}

function formatDuration(ms) {
  if (ms == null) return "";
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

function markdownTable(headers, rows) {
  if (rows.length === 0) return "";
  const header = `| ${headers.join(" | ")} |`;
  const divider = `| ${headers.map(() => "---").join(" | ")} |`;
  const body = rows.map((row) => `| ${row.join(" | ")} |`);
  return [header, divider, ...body].join("\n");
}

function stepSummary(job) {
  return (job.steps ?? []).map((step) => {
    const ms = durationMs(step.started_at, step.completed_at);
    return {
      name: step.name,
      number: step.number,
      status: step.status,
      conclusion: step.conclusion,
      startedAt: step.started_at,
      completedAt: step.completed_at,
      durationMs: ms,
      durationSeconds: ms == null ? null : Number((ms / 1000).toFixed(3)),
    };
  });
}

const options = parseArgs(process.argv.slice(2));
const run = await githubApi(`/repos/${options.repo}/actions/runs/${options.runId}`);
const jobs = await listAll(`/repos/${options.repo}/actions/runs/${options.runId}/jobs`, "jobs");

const jobRecords = jobs.map((job) => {
  const ms = durationMs(job.started_at, job.completed_at);
  const steps = stepSummary(job);
  const longestStep = steps
    .filter((step) => step.durationMs != null)
    .sort((left, right) => right.durationMs - left.durationMs)[0] ?? null;

  return {
    id: job.id,
    name: job.name,
    status: job.status,
    conclusion: job.conclusion,
    runnerName: job.runner_name || "",
    runnerGroupName: job.runner_group_name || "",
    labels: job.labels || [],
    startedAt: job.started_at,
    completedAt: job.completed_at,
    durationMs: ms,
    durationSeconds: ms == null ? null : Number((ms / 1000).toFixed(3)),
    htmlUrl: job.html_url,
    longestStep,
    steps,
  };
});

const wallMs = durationMs(run.created_at, run.updated_at);
const allSteps = jobRecords.flatMap((job) =>
  job.steps.map((step) => ({
    job: job.name,
    name: step.name,
    conclusion: step.conclusion,
    durationMs: step.durationMs,
  }))
).filter((step) => step.durationMs != null);
const slowestSteps = allSteps
  .sort((left, right) => right.durationMs - left.durationMs)
  .slice(0, options.topSteps);
const slowestJobs = [...jobRecords]
  .filter((job) => job.durationMs != null)
  .sort((left, right) => right.durationMs - left.durationMs);

const summary = {
  generatedAt: new Date().toISOString(),
  repository: options.repo,
  run: {
    id: run.id,
    name: run.name,
    displayTitle: run.display_title,
    event: run.event,
    headBranch: run.head_branch,
    headSha: run.head_sha,
    status: run.status,
    conclusion: run.conclusion,
    createdAt: run.created_at,
    updatedAt: run.updated_at,
    wallDurationMs: wallMs,
    wallDurationSeconds: wallMs == null ? null : Number((wallMs / 1000).toFixed(3)),
    htmlUrl: run.html_url,
  },
  jobs: jobRecords,
  slowestSteps,
};

fs.mkdirSync(options.outDir, { recursive: true });
fs.writeFileSync(path.join(options.outDir, "summary.json"), JSON.stringify(summary, null, 2), "utf8");

const lines = [
  `## GitHub Run Timing Summary`,
  "",
  `- Run: [${run.name} #${run.run_number}](${run.html_url})`,
  `- Title: ${run.display_title}`,
  `- Status: ${run.status}/${run.conclusion ?? ""}`,
  `- Wall time: ${formatDuration(wallMs)}`,
  `- Head: ${run.head_branch} @ ${String(run.head_sha || "").slice(0, 12)}`,
  `- Generated: ${summary.generatedAt}`,
  "",
  "### Longest Jobs",
  "",
  markdownTable(
    ["Job", "Duration", "Conclusion", "Longest Step", "Runner"],
    slowestJobs.map((job) => [
      job.name,
      formatDuration(job.durationMs),
      job.conclusion ?? "",
      job.longestStep ? `${job.longestStep.name} (${formatDuration(job.longestStep.durationMs)})` : "",
      job.runnerName,
    ]),
  ),
  "",
  `### Slowest ${slowestSteps.length} Steps`,
  "",
  markdownTable(
    ["Step", "Job", "Duration", "Conclusion"],
    slowestSteps.map((step) => [
      step.name,
      step.job,
      formatDuration(step.durationMs),
      step.conclusion ?? "",
    ]),
  ),
  "",
];

const markdown = `${lines.filter(Boolean).join("\n")}\n`;
fs.writeFileSync(path.join(options.outDir, "summary.md"), markdown, "utf8");

if (process.env.GITHUB_STEP_SUMMARY) {
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n${markdown}`, "utf8");
}

console.log(markdown);
