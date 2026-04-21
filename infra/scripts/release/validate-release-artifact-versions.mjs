#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

function parseArgs(argv) {
  const options = {
    artifactsDir: "",
    channel: "",
    version: "",
    outputDir: "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (!next) {
      throw new Error(`missing value for ${arg}`);
    }
    if (arg === "--artifacts-dir") {
      options.artifactsDir = next;
      index += 1;
      continue;
    }
    if (arg === "--channel") {
      options.channel = next;
      index += 1;
      continue;
    }
    if (arg === "--version") {
      options.version = next;
      index += 1;
      continue;
    }
    if (arg === "--output-dir") {
      options.outputDir = next;
      index += 1;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }

  if (!options.artifactsDir || !options.channel || !options.version || !options.outputDir) {
    throw new Error("--artifacts-dir, --channel, --version, and --output-dir are required");
  }

  return options;
}

function findSummary(rootDir, fileName) {
  const directPath = path.join(rootDir, fileName);
  if (fs.existsSync(directPath)) {
    return directPath;
  }

  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    const candidatePath = path.join(rootDir, entry.name, fileName);
    if (fs.existsSync(candidatePath)) {
      return candidatePath;
    }
  }

  return null;
}

function buildMarkdown(summary) {
  const lines = [
    `# ${summary.channel} Artifact Version Validation`,
    "",
    `- Expected version: ${summary.expectedVersion}`,
    `- Summaries checked: ${summary.results.length}`,
    `- Failures: ${summary.failures.length}`,
    "",
    "## Results",
    "",
  ];

  for (const result of summary.results) {
    const prefix = result.ok ? "OK" : "FAIL";
    const detail = result.ok ? "" : ` — ${result.errors.join(", ")}`;
    lines.push(`- ${prefix}: ${result.summary}${detail}`);
  }

  return `${lines.join("\n")}\n`;
}

function validateSummary(summaryName, summaryPath, expectedChannel, expectedVersion) {
  const summary = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
  const errors = [];

  if (summary.channel !== expectedChannel) {
    errors.push(`expected channel ${expectedChannel}, received ${summary.channel ?? "missing"}`);
  }

  if (summary.version !== expectedVersion) {
    errors.push(`expected version ${expectedVersion}, received ${summary.version ?? "missing"}`);
  }

  if (!Array.isArray(summary.artifacts) || summary.artifacts.length === 0) {
    errors.push("missing artifacts");
  } else {
    for (const artifact of summary.artifacts) {
      if (typeof artifact.name !== "string" || !artifact.name.includes(expectedVersion)) {
        errors.push(`artifact ${artifact.name ?? "<missing>"} does not include version ${expectedVersion}`);
      }
    }
  }

  return {
    summary: summaryName,
    path: summaryPath,
    ok: errors.length === 0,
    errors,
  };
}

const options = parseArgs(process.argv.slice(2));
const artifactsDir = path.resolve(options.artifactsDir);
const outputDir = path.resolve(options.outputDir);
fs.mkdirSync(outputDir, { recursive: true });

const requiredSummaries = [
  "release-summary-windows-x86_64.json",
  "release-summary-linux-x86_64.json",
  "release-summary-macos-aarch64.json",
  "release-summary-macos-x86_64.json",
];

const results = requiredSummaries.map((summaryName) => {
  const summaryPath = findSummary(artifactsDir, summaryName);
  if (!summaryPath) {
    return {
      summary: summaryName,
      path: null,
      ok: false,
      errors: [`missing ${summaryName}`],
    };
  }

  return validateSummary(summaryName, summaryPath, options.channel, options.version);
});

const failures = results.filter((result) => !result.ok);
const summary = {
  channel: options.channel,
  expectedVersion: options.version,
  artifactsDir,
  generatedAt: new Date().toISOString(),
  results,
  failures,
};

fs.writeFileSync(
  path.join(outputDir, `artifact-versions-${options.channel}.json`),
  `${JSON.stringify(summary, null, 2)}\n`
);
fs.writeFileSync(
  path.join(outputDir, `artifact-versions-${options.channel}.md`),
  buildMarkdown(summary)
);

console.log(
  JSON.stringify(
    {
      ok: failures.length === 0,
      channel: options.channel,
      expectedVersion: options.version,
      summariesChecked: results.length,
      failures: failures.length,
      outputDir,
    },
    null,
    2
  )
);

if (failures.length > 0) {
  process.exit(1);
}
