#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

function parseArgs(argv) {
  const options = {
    dir: "ci-perf",
    outDir: "ci-perf",
    title: "CI Performance Summary",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--dir") {
      options.dir = next || "";
      index += 1;
      continue;
    }
    if (arg === "--out-dir") {
      options.outDir = next || "";
      index += 1;
      continue;
    }
    if (arg === "--title") {
      options.title = next || "";
      index += 1;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }

  return options;
}

function walkFiles(root) {
  if (!fs.existsSync(root)) return [];
  const entries = fs.readdirSync(root, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) return walkFiles(fullPath);
    if (entry.isFile()) return [fullPath];
    return [];
  });
}

function readJsonLines(filePath) {
  return fs.readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function readSccacheStats(filePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const stats = parsed.stats || parsed;
    const hits = Object.values(stats.cache_hits?.counts || {}).reduce((sum, value) => sum + value, 0);
    const misses = Object.values(stats.cache_misses?.counts || {}).reduce((sum, value) => sum + value, 0);
    const total = hits + misses;
    return {
      file: path.basename(filePath),
      compileRequests: stats.compile_requests ?? null,
      hits,
      misses,
      hitRate: total > 0 ? hits / total : null,
      cacheReadHitSeconds: stats.cache_read_hit_duration?.secs ?? null,
      cacheWriteSeconds: stats.cache_write_duration?.secs ?? null,
      compilerWriteSeconds: stats.compiler_write_duration?.secs ?? null,
      cacheWrites: stats.cache_writes ?? null,
      cacheWriteErrors: stats.cache_write_errors ?? null,
      cacheLocation: parsed.cache_location || "",
    };
  } catch {
    return null;
  }
}

function seconds(ms) {
  return `${(ms / 1000).toFixed(1)}s`;
}

function percent(value) {
  return value == null ? "" : `${(value * 100).toFixed(1)}%`;
}

function markdownTable(headers, rows) {
  if (rows.length === 0) return "";
  const header = `| ${headers.join(" | ")} |`;
  const divider = `| ${headers.map(() => "---").join(" | ")} |`;
  const body = rows.map((row) => `| ${row.join(" | ")} |`);
  return [header, divider, ...body].join("\n");
}

const options = parseArgs(process.argv.slice(2));
const files = walkFiles(options.dir);
const stepRecords = files
  .filter((file) => file.endsWith(".jsonl"))
  .flatMap(readJsonLines)
  .sort((left, right) => left.startedAt.localeCompare(right.startedAt));
const sccacheRecords = files
  .filter((file) => file.endsWith(".json") && path.basename(file).includes("sccache"))
  .map(readSccacheStats)
  .filter(Boolean);

const totalDurationMs = stepRecords.reduce((sum, record) => sum + record.durationMs, 0);
const failedSteps = stepRecords.filter((record) => record.status !== "success");
const summary = {
  generatedAt: new Date().toISOString(),
  title: options.title,
  totalMeasuredSeconds: Number((totalDurationMs / 1000).toFixed(3)),
  stepCount: stepRecords.length,
  failedStepCount: failedSteps.length,
  steps: stepRecords,
  sccache: sccacheRecords,
};

fs.mkdirSync(options.outDir, { recursive: true });
fs.writeFileSync(path.join(options.outDir, "summary.json"), JSON.stringify(summary, null, 2), "utf8");

const lines = [
  `## ${options.title}`,
  "",
  `- Generated: ${summary.generatedAt}`,
  `- Steps measured: ${summary.stepCount}`,
  `- Total measured command time: ${(summary.totalMeasuredSeconds / 60).toFixed(2)} min`,
  `- Failed steps: ${summary.failedStepCount}`,
  "",
];

lines.push(markdownTable(
  ["Step", "Duration", "Status", "Runner"],
  stepRecords.map((record) => [
    record.label,
    seconds(record.durationMs),
    record.status,
    `${record.runner.os}/${record.runner.arch}`,
  ]),
));

if (sccacheRecords.length > 0) {
  lines.push("", "### sccache", "");
  lines.push(markdownTable(
    ["File", "Requests", "Hits", "Misses", "Hit Rate", "Read Hit", "Write", "Compiler"],
    sccacheRecords.map((record) => [
      record.file,
      record.compileRequests ?? "",
      record.hits,
      record.misses,
      percent(record.hitRate),
      record.cacheReadHitSeconds == null ? "" : `${record.cacheReadHitSeconds}s`,
      record.cacheWriteSeconds == null ? "" : `${record.cacheWriteSeconds}s`,
      record.compilerWriteSeconds == null ? "" : `${record.compilerWriteSeconds}s`,
    ]),
  ));
}

const markdown = `${lines.filter((line) => line != null).join("\n")}\n`;
fs.writeFileSync(path.join(options.outDir, "summary.md"), markdown, "utf8");

if (process.env.GITHUB_STEP_SUMMARY) {
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n${markdown}`, "utf8");
}

console.log(markdown);
