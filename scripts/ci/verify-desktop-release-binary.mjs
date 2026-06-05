#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

function parseArgs(argv) {
  const options = {
    releaseDir: process.env.AURA_RELEASE_DIR || "",
    target: "",
    expectedChannel: "Stable",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--release-dir") {
      options.releaseDir = next || "";
      index += 1;
      continue;
    }
    if (arg === "--target") {
      options.target = next || "";
      index += 1;
      continue;
    }
    if (arg === "--expected-channel") {
      options.expectedChannel = next || "";
      index += 1;
      continue;
    }
    if (arg === "--help") {
      console.log(
        "Usage: node scripts/ci/verify-desktop-release-binary.mjs --release-dir DIR --target linux|macos|windows [--expected-channel Stable]",
      );
      process.exit(0);
    }
    throw new Error(`unknown argument: ${arg}`);
  }

  if (!options.releaseDir || !options.target || !options.expectedChannel) {
    throw new Error("--release-dir, --target, and --expected-channel are required");
  }

  return options;
}

function fail(message) {
  console.error(`\n[release-binary] ${message}`);
  process.exit(1);
}

function assertContains(report, expected) {
  if (!report.includes(expected)) {
    fail(`channel report is missing ${expected}: ${report}`);
  }
}

const options = parseArgs(process.argv.slice(2));
const binaryName = options.target === "windows" ? "aura-os-desktop.exe" : "aura-os-desktop";
const binaryPath = path.resolve(options.releaseDir, binaryName);

if (!fs.existsSync(binaryPath)) {
  fail(`expected release binary does not exist: ${binaryPath}`);
}

const stat = fs.statSync(binaryPath);
if (!stat.isFile() || stat.size <= 0) {
  fail(`expected release binary to be a non-empty file: ${binaryPath}`);
}

const result = spawnSync(binaryPath, ["--print-channel"], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
  env: {
    ...process.env,
    AURA_DESKTOP_USE_PREBUILT_FRONTEND: "1",
  },
});

if (result.error) {
  fail(`unable to run ${binaryPath} --print-channel: ${result.error.message}`);
}

const report = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
if (result.status !== 0) {
  fail(report || `${binaryPath} --print-channel exited with code ${result.status ?? 1}`);
}

const expectedPrefix = `channel=${options.expectedChannel} `;
if (!report.startsWith(expectedPrefix)) {
  fail(`expected channel report to start with ${expectedPrefix}, got: ${report}`);
}

assertContains(report, "updater_enabled=true");
assertContains(report, "data_dir=aura");
assertContains(report, 'window_title="AURA"');

console.log(
  JSON.stringify(
    {
      ok: true,
      binary: binaryPath,
      sizeBytes: stat.size,
      report,
    },
    null,
    2,
  ),
);
