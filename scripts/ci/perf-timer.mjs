#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

function parseArgs(argv) {
  const options = {
    label: "",
    out: "ci-perf/steps.jsonl",
    cwd: process.cwd(),
    command: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--label") {
      options.label = next || "";
      index += 1;
      continue;
    }

    if (arg === "--out") {
      options.out = next || "";
      index += 1;
      continue;
    }

    if (arg === "--cwd") {
      options.cwd = next || "";
      index += 1;
      continue;
    }

    if (arg === "--") {
      options.command = argv.slice(index + 1);
      break;
    }

    throw new Error(`unknown argument: ${arg}`);
  }

  if (!options.label) {
    throw new Error("--label is required");
  }
  if (!options.out) {
    throw new Error("--out is required");
  }
  if (options.command.length === 0) {
    throw new Error("command is required after --");
  }

  return options;
}

function appendJsonLine(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(value)}\n`, "utf8");
}

function formatSeconds(ms) {
  return (ms / 1000).toFixed(1);
}

const options = parseArgs(process.argv.slice(2));
const startedAtMs = Date.now();
const startedAt = new Date(startedAtMs).toISOString();
const rendered = options.command.join(" ");

console.log(`\n[ci-perf] ${options.label}: ${rendered}`);

const result = spawnSync(options.command[0], options.command.slice(1), {
  cwd: options.cwd,
  env: process.env,
  stdio: "inherit",
  shell: process.platform === "win32",
});

const completedAtMs = Date.now();
const durationMs = completedAtMs - startedAtMs;
const exitCode = result.status ?? (result.error ? 1 : 0);
const record = {
  label: options.label,
  command: options.command,
  cwd: path.resolve(options.cwd),
  startedAt,
  completedAt: new Date(completedAtMs).toISOString(),
  durationMs,
  durationSeconds: Number((durationMs / 1000).toFixed(3)),
  exitCode,
  status: exitCode === 0 ? "success" : "failure",
  runner: {
    os: process.env.RUNNER_OS || process.platform,
    arch: process.env.RUNNER_ARCH || process.arch,
    name: process.env.RUNNER_NAME || "",
  },
  github: {
    workflow: process.env.GITHUB_WORKFLOW || "",
    runId: process.env.GITHUB_RUN_ID || "",
    job: process.env.GITHUB_JOB || "",
    sha: process.env.GITHUB_SHA || "",
    ref: process.env.GITHUB_REF || "",
  },
};

appendJsonLine(options.out, record);

if (process.env.GITHUB_STEP_SUMMARY) {
  fs.appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    `- ${options.label}: ${formatSeconds(durationMs)}s (${record.status})\n`,
    "utf8",
  );
}

if (result.error) {
  console.error(`[ci-perf] ${options.label} failed: ${result.error.message}`);
}

process.exit(exitCode);
