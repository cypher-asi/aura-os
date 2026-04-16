#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

function repoRoot() {
  return process.cwd();
}

function resolveHarnessDir(root) {
  const explicit = process.env.AURA_HARNESS_DIR?.trim();
  if (explicit) {
    return path.resolve(explicit);
  }
  return path.resolve(root, "../aura-harness");
}

function sidecarBinaryName() {
  return process.platform === "win32" ? "aura-node.exe" : "aura-node";
}

function resolveCargoTargetDir(invocationDir) {
  const explicit = process.env.CARGO_TARGET_DIR?.trim();
  if (!explicit) {
    return path.join(invocationDir, "target");
  }

  return path.resolve(invocationDir, explicit);
}

function resolveCargoMetadataTargetDir(harnessManifest, harnessDir) {
  const result = spawnSync(
    "cargo",
    ["metadata", "--format-version", "1", "--no-deps", "--manifest-path", harnessManifest],
    {
      cwd: harnessDir,
      env: process.env,
      encoding: "utf8",
    },
  );

  if (result.status !== 0) {
    return null;
  }

  try {
    const parsed = JSON.parse(result.stdout);
    if (typeof parsed?.target_directory === "string" && parsed.target_directory.trim()) {
      return parsed.target_directory.trim();
    }
  } catch {
    return null;
  }

  return null;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with status ${result.status}`);
  }
}

function main() {
  const root = repoRoot();
  const harnessDir = resolveHarnessDir(root);
  const harnessManifest = path.join(harnessDir, "Cargo.toml");
  if (!fs.existsSync(harnessManifest)) {
    throw new Error(`aura-harness manifest not found at ${harnessManifest}`);
  }

  const cargoTargetDir =
    resolveCargoMetadataTargetDir(harnessManifest, harnessDir) ?? resolveCargoTargetDir(harnessDir);

  run("cargo", ["build", "--release", "-p", "aura-node", "--manifest-path", harnessManifest], {
    cwd: harnessDir,
    env: process.env,
  });

  const binaryName = sidecarBinaryName();
  const builtBinary = path.join(cargoTargetDir, "release", binaryName);
  if (!fs.existsSync(builtBinary)) {
    throw new Error(`built sidecar not found at ${builtBinary}`);
  }

  const targetDir = path.join(root, "apps", "aura-os-desktop", "resources", "sidecar");
  fs.mkdirSync(targetDir, { recursive: true });
  const targetBinary = path.join(targetDir, binaryName);
  fs.copyFileSync(builtBinary, targetBinary);

  if (process.platform !== "win32") {
    fs.chmodSync(targetBinary, 0o755);
  }

  console.log(JSON.stringify({
    ok: true,
    harnessDir,
    cargoTargetDir,
    binaryName,
    builtBinary,
    targetBinary,
  }, null, 2));
}

main();
