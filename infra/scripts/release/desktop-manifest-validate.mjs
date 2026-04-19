#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

function parseArgs(argv) {
  const options = {
    rootDir: "",
    channel: "",
    outputDir: "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (!next) {
      throw new Error(`missing value for ${arg}`);
    }
    if (arg === "--root-dir") {
      options.rootDir = next;
      index += 1;
      continue;
    }
    if (arg === "--channel") {
      options.channel = next;
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

  if (!options.rootDir || !options.channel || !options.outputDir) {
    throw new Error("--root-dir, --channel, and --output-dir are required");
  }

  return options;
}

function walkJsonFiles(rootDir, files) {
  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    const targetPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      walkJsonFiles(targetPath, files);
      continue;
    }
    if (entry.isFile() && targetPath.endsWith(".json")) {
      files.push(targetPath);
    }
  }
}

function validateManifest(channel, manifestPath, manifest) {
  const errors = [];
  if (typeof manifest.version !== "string" || !manifest.version.trim()) {
    errors.push("missing version");
  }
  if (typeof manifest.url !== "string" || !manifest.url.trim()) {
    errors.push("missing url");
  } else if (!/^https:\/\//.test(manifest.url)) {
    errors.push("url must be https");
  } else if (
    channel === "nightly" &&
    manifest.url.includes("/releases/download/nightly/")
  ) {
    errors.push("nightly manifests must use immutable release asset URLs");
  }
  if (typeof manifest.signature !== "string" || !manifest.signature.trim()) {
    errors.push("missing signature");
  }
  if (typeof manifest.format !== "string" || !manifest.format.trim()) {
    errors.push("missing format");
  } else if (!["nsis", "app", "appimage"].includes(manifest.format)) {
    errors.push(`unsupported format ${manifest.format}`);
  }

  return {
    path: manifestPath,
    version: manifest.version ?? null,
    format: manifest.format ?? null,
    ok: errors.length === 0,
    errors,
  };
}

function buildMarkdown(summary) {
  const lines = [
    `# Desktop ${summary.channel} Manifest Validation`,
    "",
    `- Manifests checked: ${summary.results.length}`,
    `- Failures: ${summary.failures.length}`,
    "",
  ];

  if (summary.results.length > 0) {
    lines.push("## Results");
    lines.push("");
    for (const result of summary.results) {
      const prefix = result.ok ? "OK" : "FAIL";
      const detail = result.ok ? "" : ` — ${result.errors.join(", ")}`;
      lines.push(`- ${prefix}: ${result.relativePath}${detail}`);
    }
  } else {
    lines.push("## Results");
    lines.push("");
    lines.push("- No manifest files found.");
  }

  return `${lines.join("\n")}\n`;
}

const options = parseArgs(process.argv.slice(2));
const outputDir = path.resolve(options.outputDir);
const channelRoot = path.resolve(options.rootDir, options.channel);
fs.mkdirSync(outputDir, { recursive: true });

const manifestFiles = [];
if (fs.existsSync(channelRoot)) {
  walkJsonFiles(channelRoot, manifestFiles);
}

const results = manifestFiles.map((manifestPath) => {
  const raw = fs.readFileSync(manifestPath, "utf8");
  const manifest = JSON.parse(raw);
  return {
    relativePath: path.relative(path.resolve(options.rootDir), manifestPath),
    ...validateManifest(options.channel, manifestPath, manifest),
  };
});

const failures = results.filter((result) => !result.ok);
const summary = {
  channel: options.channel,
  rootDir: path.resolve(options.rootDir),
  generatedAt: new Date().toISOString(),
  results,
  failures,
};

fs.writeFileSync(
  path.join(outputDir, `desktop-manifests-${options.channel}.json`),
  `${JSON.stringify(summary, null, 2)}\n`
);
fs.writeFileSync(
  path.join(outputDir, `desktop-manifests-${options.channel}.md`),
  buildMarkdown(summary)
);

console.log(
  JSON.stringify(
    {
      ok: failures.length === 0,
      channel: options.channel,
      manifestsChecked: results.length,
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
