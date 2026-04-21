import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  DESKTOP_NODE_MAJOR,
  JAVA_MAJOR,
  MOBILE_NODE_MAJOR,
  NODE_VERSION,
  RUBY_VERSION,
  RUST_VERSION,
} from "./versions.mjs";

const currentFile = fileURLToPath(import.meta.url);
export const repoRoot = resolve(dirname(currentFile), "..", "..", "..");
export const interfaceDir = resolve(repoRoot, "interface");
export const promptfooDir = resolve(repoRoot, "infra", "evals", "promptfoo");

function commandName(command) {
  if (process.platform === "win32" && (command === "npm" || command === "npx")) {
    return `${command}.cmd`;
  }

  return command;
}

export function fail(message) {
  console.error(`\n[ci-parity] ${message}`);
  process.exit(1);
}

export function run(command, args, options = {}) {
  const {
    retries = 0,
    retryDelayMs = 1_000,
    label = null,
    ...spawnOptions
  } = options;
  const rendered = [command, ...args].join(" ");
  const attemptCount = Math.max(1, retries + 1);

  for (let attempt = 1; attempt <= attemptCount; attempt += 1) {
    const suffix = attemptCount > 1 ? ` (attempt ${attempt}/${attemptCount})` : "";
    const prefix = label ? `[${label}] ` : "";
    console.log(`\n> ${prefix}${rendered}${suffix}`);

    const result = spawnSync(commandName(command), args, {
      cwd: repoRoot,
      stdio: "inherit",
      ...spawnOptions,
    });

    if (result.error) {
      if (attempt === attemptCount) {
        fail(`Unable to run "${rendered}": ${result.error.message}`);
      }
    } else if (result.status === 0) {
      return;
    } else if (attempt === attemptCount) {
      process.exit(result.status ?? 1);
    }

    console.warn(
      `\n[ci-parity] ${label ?? rendered} failed on attempt ${attempt}/${attemptCount}; retrying in ${retryDelayMs}ms...`,
    );
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, retryDelayMs);
  }
}

export function capture(command, args, options = {}) {
  const result = spawnSync(commandName(command), args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });

  if (result.error) {
    fail(`Unable to run "${command} ${args.join(" ")}": ${result.error.message}`);
  }

  if (result.status !== 0) {
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
    fail(output || `"${command} ${args.join(" ")}" exited with code ${result.status ?? 1}`);
  }

  return `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
}

function parseVersion(raw, label) {
  const match = raw.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) {
    fail(`Unable to parse ${label} version from: ${raw}`);
  }

  return match.slice(1, 4).map((part) => Number.parseInt(part, 10));
}

function compareVersions(left, right) {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const leftPart = left[index] ?? 0;
    const rightPart = right[index] ?? 0;
    if (leftPart > rightPart) {
      return 1;
    }
    if (leftPart < rightPart) {
      return -1;
    }
  }

  return 0;
}

export function assertNodeMajor(expectedMajor, lane) {
  const detectedMajor = Number.parseInt(process.versions.node.split(".")[0], 10);
  if (detectedMajor !== expectedMajor) {
    fail(`${lane} expects Node ${NODE_VERSION}, but this machine is running Node ${process.versions.node}.`);
  }
}

export function assertRustVersionAtLeast(minimumVersion = RUST_VERSION) {
  const actual = parseVersion(capture("rustc", ["--version"]), "rustc");
  const minimum = minimumVersion.split(".").map((part) => Number.parseInt(part, 10));
  if (compareVersions(actual, minimum) < 0) {
    fail(`Desktop builds require rustc >= ${minimumVersion}, but found rustc ${actual.join(".")}.`);
  }
}

export function assertJavaMajor(expectedMajor = JAVA_MAJOR) {
  const output = capture("java", ["-version"]);
  const match = output.match(/version\s+"(\d+)(?:\.\d+)?/);
  if (!match) {
    fail(`Unable to parse Java version from: ${output}`);
  }

  const actualMajor = Number.parseInt(match[1], 10);
  if (actualMajor !== expectedMajor) {
    fail(`Android validation expects Java ${expectedMajor}, but found Java ${actualMajor}.`);
  }
}

export function assertRubyVersion(expectedVersion = RUBY_VERSION) {
  const output = capture("ruby", ["-e", "print RUBY_VERSION"]);
  if (!output.startsWith(expectedVersion)) {
    fail(`Mobile release lanes expect Ruby ${expectedVersion}, but found Ruby ${output}.`);
  }
}

export function assertDesktopRuntime({ requireHarness = false } = {}) {
  assertNodeMajor(DESKTOP_NODE_MAJOR, "Desktop/evals");
  assertRustVersionAtLeast(RUST_VERSION);

  if (requireHarness) {
    const harnessDir = process.env.AURA_HARNESS_DIR
      ? resolve(repoRoot, process.env.AURA_HARNESS_DIR)
      : resolve(repoRoot, "..", "aura-harness");

    if (!existsSync(harnessDir)) {
      fail(
        "Desktop packaging expects an aura-harness sibling checkout. Set AURA_HARNESS_DIR or place aura-harness next to this repo.",
      );
    }
  }
}

export function assertEvalsRuntime() {
  assertNodeMajor(DESKTOP_NODE_MAJOR, "Desktop/evals");
}

export function assertIosRuntime({ requireNative = false, requireRuby = false } = {}) {
  assertNodeMajor(MOBILE_NODE_MAJOR, "Mobile");
  if (requireRuby) {
    assertRubyVersion(RUBY_VERSION);
  }
  if (requireNative) {
    capture("xcodebuild", ["-version"]);
  }
}

export function assertAndroidRuntime({ requireSdk = false, requireRuby = false } = {}) {
  assertNodeMajor(MOBILE_NODE_MAJOR, "Mobile");
  assertJavaMajor(JAVA_MAJOR);
  if (requireRuby) {
    assertRubyVersion(RUBY_VERSION);
  }
  if (requireSdk) {
    capture("sdkmanager", ["--version"]);
  }
}

export function desktopBinaryPath() {
  const targetRoot = process.env.CARGO_TARGET_DIR
    ? resolve(repoRoot, process.env.CARGO_TARGET_DIR)
    : resolve(repoRoot, "target");
  const binaryName = process.platform === "win32" ? "aura-os-desktop.exe" : "aura-os-desktop";
  return resolve(targetRoot, "release", binaryName);
}

export function playwrightInstallArgs(browsers) {
  return process.platform === "linux"
    ? ["playwright", "install", "--with-deps", ...browsers]
    : ["playwright", "install", ...browsers];
}
