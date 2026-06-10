#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

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

function sidecarBinTargetName() {
  return "aura-node";
}

function resolveCargoTargetDir(invocationDir) {
  const explicit = process.env.CARGO_TARGET_DIR?.trim();
  if (!explicit) {
    return path.join(invocationDir, "target");
  }

  return path.resolve(invocationDir, explicit);
}

function readCargoMetadata(harnessManifest, harnessDir) {
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
    return JSON.parse(result.stdout);
  } catch {
    return null;
  }
}

function resolveCargoMetadataTargetDir(metadata) {
  if (typeof metadata?.target_directory === "string" && metadata.target_directory.trim()) {
    return metadata.target_directory.trim();
  }

  return null;
}

export function resolveSidecarPackage(metadata, binName) {
  if (!metadata) {
    throw new Error("failed to read aura-harness cargo metadata");
  }

  const matches = (metadata?.packages ?? []).filter((pkg) =>
    (pkg.targets ?? []).some((target) =>
      target.name === binName && (target.kind ?? []).includes("bin")
    )
  );

  if (matches.length === 1) {
    return matches[0].name;
  }

  if (matches.length > 1) {
    throw new Error(
      `multiple harness packages expose bin ${binName}: ${matches.map((pkg) => pkg.name).join(", ")}`
    );
  }

  throw new Error(`no harness package exposes bin ${binName}`);
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

export function cargoCacheWrapperEnabled(env = process.env) {
  return Boolean(env.RUSTC_WRAPPER || env.CARGO_BUILD_RUSTC_WRAPPER);
}

export function cargoCacheFallbackEnv(env = process.env) {
  const fallback = { ...env };
  delete fallback.RUSTC_WRAPPER;
  delete fallback.CARGO_BUILD_RUSTC_WRAPPER;
  return fallback;
}

function runCargoWithCacheFallback(args, options = {}) {
  const result = spawnSync("cargo", args, {
    stdio: "inherit",
    ...options,
  });
  if (result.status === 0) {
    return;
  }

  const env = options.env ?? process.env;
  if (!cargoCacheWrapperEnabled(env)) {
    throw new Error(`cargo ${args.join(" ")} failed with status ${result.status}`);
  }

  console.warn(
    "\n[prepare-desktop-sidecar] cargo failed with a compiler cache wrapper enabled; " +
      "retrying once without RUSTC_WRAPPER so cache backend issues do not fail the build.",
  );

  const fallback = spawnSync("cargo", args, {
    stdio: "inherit",
    ...options,
    env: cargoCacheFallbackEnv(env),
  });
  if (fallback.status !== 0) {
    throw new Error(`cargo ${args.join(" ")} failed with status ${fallback.status}`);
  }
}

export function normalizeSccacheWrapperPath(wrapperPath, platform = process.platform) {
  if (!wrapperPath || platform !== "win32") {
    return wrapperPath;
  }

  let normalized = wrapperPath.replaceAll("/", "\\");
  if (!normalized.toLowerCase().endsWith(".exe")) {
    normalized = `${normalized}.exe`;
  }
  return path.win32.normalize(normalized);
}

function sidecarBuildEnv() {
  const env = { ...process.env };
  if (env.SCCACHE_PATH && env.RUSTC_WRAPPER === "sccache") {
    env.RUSTC_WRAPPER = normalizeSccacheWrapperPath(env.SCCACHE_PATH);
  }
  if (env.RUSTC_WRAPPER && !env.CARGO_BUILD_RUSTC_WRAPPER) {
    env.CARGO_BUILD_RUSTC_WRAPPER = env.RUSTC_WRAPPER;
  }
  return env;
}

function printBuildEnv(env) {
  console.log(JSON.stringify({
    sidecarBuildEnv: {
      rustcSet: Boolean(env.RUSTC),
      cargoSet: Boolean(env.CARGO),
      rustcWrapperSet: Boolean(env.RUSTC_WRAPPER),
      cargoBuildRustcWrapperSet: Boolean(env.CARGO_BUILD_RUSTC_WRAPPER),
      sccachePathSet: Boolean(env.SCCACHE_PATH),
      cargoTargetDirSet: Boolean(env.CARGO_TARGET_DIR),
      sccacheGhaEnabledSet: Boolean(env.SCCACHE_GHA_ENABLED),
      sccacheWebdavEndpointSet: Boolean(env.SCCACHE_WEBDAV_ENDPOINT),
    },
  }, null, 2));
}

function parseArgs(argv) {
  return {
    checkOnly: argv.includes("--check"),
  };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const root = repoRoot();
  const harnessDir = resolveHarnessDir(root);
  const harnessManifest = path.join(harnessDir, "Cargo.toml");
  if (!fs.existsSync(harnessManifest)) {
    throw new Error(`aura-harness manifest not found at ${harnessManifest}`);
  }

  const metadata = readCargoMetadata(harnessManifest, harnessDir);
  const binName = sidecarBinTargetName();
  const sidecarPackage = resolveSidecarPackage(metadata, binName);
  const cargoTargetDir =
    resolveCargoMetadataTargetDir(metadata) ?? resolveCargoTargetDir(harnessDir);

  if (options.checkOnly) {
    console.log(JSON.stringify({
      ok: true,
      mode: "check",
      harnessDir,
      cargoTargetDir,
      sidecarPackage,
      binName,
    }, null, 2));
    return;
  }

  const buildEnv = sidecarBuildEnv();
  printBuildEnv(buildEnv);

  runCargoWithCacheFallback(
    [
      "build",
      "--release",
      "-p",
      sidecarPackage,
      "--bin",
      binName,
      "--manifest-path",
      harnessManifest,
    ],
    {
      cwd: harnessDir,
      env: buildEnv,
    },
  );

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
    sidecarPackage,
    binaryName,
    builtBinary,
    targetBinary,
  }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
