#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

function parseArgs(argv) {
  const options = {
    platform: "",
    mode: "",
    outputDir: "",
    roots: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (!next) {
      throw new Error(`missing value for ${arg}`);
    }
    if (arg === "--platform") {
      options.platform = next;
      index += 1;
      continue;
    }
    if (arg === "--mode") {
      options.mode = next;
      index += 1;
      continue;
    }
    if (arg === "--output-dir") {
      options.outputDir = next;
      index += 1;
      continue;
    }
    if (arg === "--roots") {
      options.roots = next
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
      index += 1;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }

  if (!options.platform || !options.mode || !options.outputDir) {
    throw new Error("--platform, --mode, and --output-dir are required");
  }

  return options;
}

function classifyArtifact(platform, targetPath, stats) {
  const normalized = targetPath.toLowerCase();
  if (stats.isDirectory()) {
    if (normalized.endsWith(".app")) return "app-bundle";
    if (normalized.endsWith(".xcarchive")) return "xcarchive";
    return null;
  }

  if (platform === "android") {
    if (normalized.endsWith(".apk")) return "apk";
    if (normalized.endsWith(".aab")) return "aab";
  }

  if (platform === "ios") {
    if (normalized.endsWith(".ipa")) return "ipa";
    if (normalized.endsWith(".dSYM".toLowerCase())) return "dsym";
  }

  return null;
}

function collectArtifacts(platform, rootPath, currentPath, artifacts) {
  const stats = fs.statSync(currentPath);
  const artifactType = classifyArtifact(platform, currentPath, stats);
  if (artifactType) {
    artifacts.push({
      type: artifactType,
      path: currentPath,
      relativePath: path.relative(rootPath, currentPath) || path.basename(currentPath),
      sizeBytes: stats.isFile() ? stats.size : null,
    });
    if (stats.isDirectory()) {
      return;
    }
  }

  if (!stats.isDirectory()) {
    return;
  }

  for (const entry of fs.readdirSync(currentPath)) {
    collectArtifacts(platform, rootPath, path.join(currentPath, entry), artifacts);
  }
}

function formatSize(sizeBytes) {
  if (sizeBytes == null) return "directory";
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

function buildMarkdown(summary) {
  const lines = [
    `# ${summary.platform.toUpperCase()} ${summary.mode} Summary`,
    "",
    `- Roots scanned: ${summary.scannedRoots.length}`,
    `- Existing roots: ${summary.existingRoots.length}`,
    `- Artifacts found: ${summary.artifacts.length}`,
    "",
  ];

  if (summary.existingRoots.length > 0) {
    lines.push("## Roots");
    lines.push("");
    for (const root of summary.existingRoots) {
      lines.push(`- ${root}`);
    }
    lines.push("");
  }

  if (summary.artifacts.length > 0) {
    lines.push("## Artifacts");
    lines.push("");
    for (const artifact of summary.artifacts) {
      lines.push(
        `- ${artifact.type}: ${artifact.relativePath} (${formatSize(artifact.sizeBytes)})`
      );
    }
  } else {
    lines.push("## Artifacts");
    lines.push("");
    lines.push("- No build artifacts found in the scanned roots.");
  }

  return `${lines.join("\n")}\n`;
}

const options = parseArgs(process.argv.slice(2));
const outputDir = path.resolve(options.outputDir);
fs.mkdirSync(outputDir, { recursive: true });

const scannedRoots = options.roots.map((root) => path.resolve(root));
const existingRoots = scannedRoots.filter((root) => fs.existsSync(root));
const artifacts = [];

for (const root of existingRoots) {
  collectArtifacts(options.platform, root, root, artifacts);
}

artifacts.sort((left, right) => left.path.localeCompare(right.path));

const summary = {
  platform: options.platform,
  mode: options.mode,
  scannedRoots,
  existingRoots,
  artifacts,
  generatedAt: new Date().toISOString(),
};

fs.writeFileSync(
  path.join(outputDir, `${options.platform}-${options.mode}-summary.json`),
  `${JSON.stringify(summary, null, 2)}\n`
);
fs.writeFileSync(
  path.join(outputDir, `${options.platform}-${options.mode}-summary.md`),
  buildMarkdown(summary)
);

console.log(
  JSON.stringify(
    {
      ok: true,
      platform: summary.platform,
      mode: summary.mode,
      artifactsFound: summary.artifacts.length,
      existingRoots: summary.existingRoots,
      outputDir,
    },
    null,
    2
  )
);
