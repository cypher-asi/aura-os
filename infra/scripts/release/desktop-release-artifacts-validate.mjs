#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const SIGNED_SUFFIXES = [
  ".app.tar.gz",
  ".AppImage",
  ".deb",
  ".dmg",
  ".exe",
  ".msi",
];

function parseArgs(argv) {
  const options = {
    dist: "",
    channel: "",
    version: "",
    target: "",
    arch: "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--dist") {
      options.dist = next || "";
      index += 1;
      continue;
    }
    if (arg === "--channel") {
      options.channel = next || "";
      index += 1;
      continue;
    }
    if (arg === "--version") {
      options.version = next || "";
      index += 1;
      continue;
    }
    if (arg === "--target") {
      options.target = next || "";
      index += 1;
      continue;
    }
    if (arg === "--arch") {
      options.arch = next || "";
      index += 1;
      continue;
    }
    if (arg === "--help") {
      console.log(
        "Usage: node infra/scripts/release/desktop-release-artifacts-validate.mjs --dist DIR --channel nightly|stable --version VERSION --target linux|macos|windows --arch ARCH",
      );
      process.exit(0);
    }
    throw new Error(`unknown argument: ${arg}`);
  }

  for (const [key, value] of Object.entries(options)) {
    if (!value) {
      throw new Error(`--${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)} is required`);
    }
  }

  return options;
}

function isSignedArtifact(name) {
  if (name.endsWith(".sig")) return false;
  return SIGNED_SUFFIXES.some((suffix) => name.endsWith(suffix));
}

function assert(condition, message, errors) {
  if (!condition) {
    errors.push(message);
  }
}

function readSummary(distDir, target, arch) {
  const summaryName = `release-summary-${target}-${arch}.json`;
  const summaryPath = path.join(distDir, summaryName);
  if (!fs.existsSync(summaryPath)) {
    return { summaryName, summaryPath, summary: null };
  }

  return {
    summaryName,
    summaryPath,
    summary: JSON.parse(fs.readFileSync(summaryPath, "utf8")),
  };
}

function expectedPrimaryArtifact({ target, arch, version }) {
  if (target === "windows") {
    return `aura-os-desktop_${version}_x64-setup.exe`;
  }
  if (target === "linux") {
    return `aura-os-desktop_${version}_x86_64.AppImage`;
  }
  if (target === "macos") {
    return `aura-os-desktop_${version}_${arch}.app.tar.gz`;
  }
  return null;
}

const options = parseArgs(process.argv.slice(2));
const distDir = path.resolve(options.dist);
const errors = [];

assert(fs.existsSync(distDir), `artifact directory does not exist: ${distDir}`, errors);

const entries = fs.existsSync(distDir)
  ? fs.readdirSync(distDir, { withFileTypes: true }).filter((entry) => entry.isFile())
  : [];
const files = new Map(entries.map((entry) => [entry.name, path.join(distDir, entry.name)]));
const signedArtifacts = [...files.keys()].filter(isSignedArtifact).sort();
const signatures = [...files.keys()].filter((name) => name.endsWith(".sig")).sort();
const primaryArtifact = expectedPrimaryArtifact(options);

assert(signedArtifacts.length > 0, "no signed desktop artifacts were found", errors);
if (primaryArtifact) {
  assert(files.has(primaryArtifact), `missing primary updater artifact ${primaryArtifact}`, errors);
}

if (options.target === "windows") {
  assert(!files.has("aura-os-desktop.exe"), "raw Windows binary leaked into release artifacts", errors);
  assert(!files.has("aura-os-desktop.exe.sig"), "raw Windows binary signature leaked into release artifacts", errors);
}

for (const name of signedArtifacts) {
  const filePath = files.get(name);
  const size = fs.statSync(filePath).size;
  assert(size > 0, `${name} is empty`, errors);
  assert(name.includes(options.version), `${name} does not include version ${options.version}`, errors);
  assert(files.has(`${name}.sig`), `${name} is missing updater signature ${name}.sig`, errors);
}

for (const name of signatures) {
  const filePath = files.get(name);
  const size = fs.statSync(filePath).size;
  assert(size > 0, `${name} is empty`, errors);
  assert(files.has(name.slice(0, -4)), `${name} does not have a matching artifact`, errors);
}

const { summaryName, summary, summaryPath } = readSummary(distDir, options.target, options.arch);
assert(summary !== null, `missing ${summaryName}`, errors);
if (summary) {
  assert(summary.channel === options.channel, `${summaryName} channel is ${summary.channel ?? "missing"}`, errors);
  assert(summary.version === options.version, `${summaryName} version is ${summary.version ?? "missing"}`, errors);
  const summaryNames = new Set((summary.artifacts ?? []).map((artifact) => artifact.name));
  for (const name of signedArtifacts) {
    assert(summaryNames.has(name), `${summaryName} does not include ${name}`, errors);
  }
  for (const name of signatures) {
    assert(summaryNames.has(name), `${summaryName} does not include ${name}`, errors);
  }
}

const checksumName = `checksums-${options.target}-${options.arch}.txt`;
const checksumPath = path.join(distDir, checksumName);
assert(files.has(checksumName), `missing ${checksumName}`, errors);
if (files.has(checksumName)) {
  const checksums = fs.readFileSync(checksumPath, "utf8");
  for (const name of signedArtifacts) {
    assert(checksums.includes(`  ${name}`), `${checksumName} does not include ${name}`, errors);
  }
}

const result = {
  ok: errors.length === 0,
  channel: options.channel,
  version: options.version,
  target: options.target,
  arch: options.arch,
  distDir,
  signedArtifacts,
  signatures,
  summaryPath,
  checksumPath,
  errors,
};

console.log(JSON.stringify(result, null, 2));

if (errors.length > 0) {
  process.exit(1);
}
