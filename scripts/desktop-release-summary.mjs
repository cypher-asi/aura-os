#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const distDir = path.resolve(process.argv[2] || "dist");
const channel = process.argv[3] || "stable";
const version = process.argv[4] || "unknown";

if (!fs.existsSync(distDir)) {
  console.error(`dist directory not found: ${distDir}`);
  process.exit(1);
}

const files = fs.readdirSync(distDir)
  .map((name) => path.join(distDir, name))
  .filter((fullPath) => fs.statSync(fullPath).isFile())
  .sort();

function sha256(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function classify(fileName) {
  const lower = fileName.toLowerCase();
  const platform = lower.includes(".dmg") || lower.endsWith(".app.tar.gz")
    ? "macos"
    : lower.includes(".appimage") || lower.includes(".deb")
      ? "linux"
      : lower.includes(".exe")
        ? "windows"
        : "other";
  const kind = lower.endsWith(".sig")
    ? "signature"
    : lower.endsWith(".app.tar.gz")
      ? "updater_bundle"
    : lower.endsWith(".dmg")
      ? "dmg"
      : lower.endsWith(".appimage")
        ? "appimage"
        : lower.endsWith(".deb")
          ? "deb"
          : lower.includes("setup") && lower.endsWith(".exe")
            ? "installer"
            : lower.endsWith(".exe")
              ? "exe"
              : "other";
  return { platform, kind };
}

const artifacts = files.map((filePath) => {
  const name = path.basename(filePath);
  const { platform, kind } = classify(name);
  return {
    name,
    platform,
    kind,
    sizeBytes: fs.statSync(filePath).size,
    sha256: sha256(filePath),
  };
});

const grouped = artifacts.reduce((acc, artifact) => {
  const key = artifact.platform;
  acc[key] ||= [];
  acc[key].push(artifact);
  return acc;
}, {});

const summary = {
  channel,
  version,
  generatedAt: new Date().toISOString(),
  artifactCount: artifacts.length,
  artifacts,
};

fs.writeFileSync(
  path.join(distDir, "release-summary.json"),
  `${JSON.stringify(summary, null, 2)}\n`,
);

const checksums = artifacts
  .filter((artifact) => artifact.kind !== "signature")
  .map((artifact) => `${artifact.sha256}  ${artifact.name}`)
  .join("\n");
fs.writeFileSync(path.join(distDir, "checksums.txt"), checksums ? `${checksums}\n` : "");

const lines = [
  `# Desktop Release Summary`,
  ``,
  `- Channel: \`${channel}\``,
  `- Version: \`${version}\``,
  `- Artifact count: \`${artifacts.length}\``,
  ``,
];

for (const platform of ["macos", "windows", "linux", "other"]) {
  const items = grouped[platform];
  if (!items?.length) continue;
  lines.push(`## ${platform}`);
  for (const item of items) {
    lines.push(`- \`${item.name}\` (${item.kind}, ${item.sizeBytes} bytes)`);
  }
  lines.push("");
}

fs.writeFileSync(path.join(distDir, "release-summary.md"), `${lines.join("\n")}\n`);
console.log(JSON.stringify(summary, null, 2));
