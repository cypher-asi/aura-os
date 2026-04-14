#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

function parseArgs(argv) {
  const options = {
    manifestPath: "",
    artifactsDir: "",
    outputDir: "",
    channel: "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (!next) {
      throw new Error(`missing value for ${arg}`);
    }
    if (arg === "--manifest") {
      options.manifestPath = next;
      index += 1;
      continue;
    }
    if (arg === "--artifacts-dir") {
      options.artifactsDir = next;
      index += 1;
      continue;
    }
    if (arg === "--output-dir") {
      options.outputDir = next;
      index += 1;
      continue;
    }
    if (arg === "--channel") {
      options.channel = next;
      index += 1;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }

  if (!options.manifestPath || !options.artifactsDir || !options.outputDir || !options.channel) {
    throw new Error("--manifest, --artifacts-dir, --output-dir, and --channel are required");
  }

  return options;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function relativeFileList(rootDir) {
  const files = [];

  function walk(currentDir) {
    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      const targetPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(targetPath);
        continue;
      }
      if (entry.isFile()) {
        files.push(path.relative(rootDir, targetPath));
      }
    }
  }

  if (fs.existsSync(rootDir)) {
    walk(rootDir);
  }

  return files;
}

function getAssetName(url) {
  try {
    const pathname = new URL(url).pathname;
    const fileName = pathname.split("/").filter(Boolean).at(-1);
    return fileName ?? null;
  } catch {
    return null;
  }
}

function validateTarget(label, target, artifactNames) {
  const errors = [];

  if (!target || typeof target.url !== "string" || !target.url.trim()) {
    errors.push("missing url");
  } else {
    if (!target.url.startsWith("https://")) {
      errors.push("url must be https");
    }
    const assetName = getAssetName(target.url);
    if (!assetName) {
      errors.push("url does not point to a downloadable asset");
    } else if (!artifactNames.has(assetName)) {
      errors.push(`asset ${assetName} not found in artifacts`);
    }
  }

  return {
    label,
    ok: errors.length === 0,
    errors,
  };
}

function buildMarkdown(summary) {
  const lines = [
    `# Desktop ${summary.channel} Download Manifest Validation`,
    "",
    `- Targets checked: ${summary.results.length}`,
    `- Failures: ${summary.failures.length}`,
    "",
    "## Results",
    "",
  ];

  for (const result of summary.results) {
    const prefix = result.ok ? "OK" : "FAIL";
    const detail = result.ok ? "" : ` — ${result.errors.join(", ")}`;
    lines.push(`- ${prefix}: ${result.label}${detail}`);
  }

  return `${lines.join("\n")}\n`;
}

const options = parseArgs(process.argv.slice(2));
const outputDir = path.resolve(options.outputDir);
const manifestPath = path.resolve(options.manifestPath);
const artifactsDir = path.resolve(options.artifactsDir);

fs.mkdirSync(outputDir, { recursive: true });

const manifest = readJson(manifestPath);
const artifactNames = new Set(relativeFileList(artifactsDir).map((file) => path.basename(file)));
const results = [];

const topLevelErrors = [];
if (manifest.channel !== options.channel) {
  topLevelErrors.push(`expected channel ${options.channel}, received ${manifest.channel ?? "missing"}`);
}
if (typeof manifest.version !== "string" || !manifest.version.trim()) {
  topLevelErrors.push("missing version");
}
if (typeof manifest.release_url !== "string" || !manifest.release_url.trim()) {
  topLevelErrors.push("missing release_url");
}
if (!manifest.desktop || typeof manifest.desktop !== "object") {
  topLevelErrors.push("missing desktop targets");
}

if (topLevelErrors.length > 0) {
  results.push({
    label: "manifest",
    ok: false,
    errors: topLevelErrors,
  });
}

if (manifest.desktop && typeof manifest.desktop === "object") {
  results.push(validateTarget("desktop.windows", manifest.desktop.windows, artifactNames));
  results.push(validateTarget("desktop.linux", manifest.desktop.linux, artifactNames));
  results.push(
    validateTarget("desktop.mac.apple-silicon", manifest.desktop.mac?.["apple-silicon"], artifactNames)
  );
  results.push(validateTarget("desktop.mac.intel", manifest.desktop.mac?.intel, artifactNames));
}

const failures = results.filter((result) => !result.ok);
const summary = {
  channel: options.channel,
  manifestPath,
  artifactsDir,
  generatedAt: new Date().toISOString(),
  results,
  failures,
};

fs.writeFileSync(
  path.join(outputDir, `desktop-downloads-${options.channel}.json`),
  `${JSON.stringify(summary, null, 2)}\n`
);
fs.writeFileSync(
  path.join(outputDir, `desktop-downloads-${options.channel}.md`),
  buildMarkdown(summary)
);

console.log(
  JSON.stringify(
    {
      ok: failures.length === 0,
      channel: options.channel,
      targetsChecked: results.length,
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
