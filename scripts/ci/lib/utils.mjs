import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  DESKTOP_NODE_MAJOR,
  JAVA_MAJOR,
  MOBILE_NODE_MAJOR,
  NODE_VERSION,
  RUBY_VERSION,
  RUST_VERSION,
  XCODE_MAJOR,
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

// Node 18.20.2 / 20.12.2 / 21.7.3 / 22+ refuse to spawn `.cmd`/`.bat` shims
// without `shell: true` (CVE-2024-27980), and on Windows our `npm`/`npx`
// invocations route through `npm.cmd`/`npx.cmd`. Without this, every Windows
// CI lane fails immediately with `spawnSync npm.cmd EINVAL` before the shim
// is ever launched. Keep this scoped to the commands we actually rewrite to
// `.cmd`, so we don't opt every spawn into shell-quoting risk; current call
// sites pass only simple tokens (`ci`, `run`, `build`, `--retries=1`, plain
// paths) so cmd.exe parsing is safe.
function needsShell(command) {
  return process.platform === "win32" && (command === "npm" || command === "npx");
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
      shell: needsShell(command),
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
    shell: needsShell(command),
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

// Like `capture` but returns null on any failure instead of exiting.
export function tryCapture(command, args, options = {}) {
  const result = spawnSync(commandName(command), args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    shell: needsShell(command),
    ...options,
  });

  if (result.error || result.status !== 0) {
    return null;
  }

  return `${result.stdout ?? ""}`.trim();
}

function parseVersion(raw, label, prefix = label) {
  // Prefer a match anchored to the program name (e.g. `rustc 1.94.1 (...)`)
  // so we don't accidentally pick up an unrelated `X.Y.Z` printed by a
  // wrapper. macos-latest now ships rustup 1.29.0 (released 2026-03-12),
  // and the rustup proxy emits info lines on stderr that mention its own
  // version before the actual rustc version reaches us via stdout, which
  // would otherwise trip the bare `(\d+)\.(\d+)\.(\d+)` fallback below.
  if (prefix) {
    const anchored = raw.match(
      new RegExp(`(?:^|\\W)${prefix}\\s+(\\d+)\\.(\\d+)\\.(\\d+)`, "m"),
    );
    if (anchored) {
      return anchored.slice(1, 4).map((part) => Number.parseInt(part, 10));
    }
  }

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

function looksLikeRustcBanner(output) {
  return typeof output === "string" && /^\s*rustc\s+\d+\.\d+\.\d+/m.test(output);
}

function probeRustcCandidate(candidate) {
  if (!candidate) {
    return null;
  }
  const banner = tryCapture(candidate, ["--version"]);
  return looksLikeRustcBanner(banner) ? candidate : null;
}

function rustcBinaryName() {
  return process.platform === "win32" ? "rustc.exe" : "rustc";
}

// Pick a rustc binary directly out of `${RUSTUP_HOME}/toolchains/<toolchain>/bin/`,
// preferring an installed toolchain whose directory starts with `targetVersion-`
// (e.g. `1.94.1-x86_64-apple-darwin`). This bypasses any rustup proxy entirely
// and is the only fallback that survives the `macos-latest` Homebrew rustup
// setup, where `~/.cargo/bin/rustc` is never created and `/opt/homebrew/bin/rustc`
// is just a `rustup-init` shim that does not honour proxy detection.
function resolveRustcFromRustupToolchains(targetVersion) {
  const rustupHome = process.env.RUSTUP_HOME
    ? resolve(process.env.RUSTUP_HOME)
    : process.env.HOME
      ? resolve(process.env.HOME, ".rustup")
      : process.env.USERPROFILE
        ? resolve(process.env.USERPROFILE, ".rustup")
        : null;
  if (!rustupHome) {
    return null;
  }

  const toolchainsDir = resolve(rustupHome, "toolchains");
  if (!existsSync(toolchainsDir)) {
    return null;
  }

  let entries;
  try {
    entries = readdirSync(toolchainsDir);
  } catch {
    return null;
  }

  const versionPrefix = targetVersion ? `${targetVersion}-` : null;
  const preferred = versionPrefix
    ? entries.filter((entry) => entry === targetVersion || entry.startsWith(versionPrefix))
    : [];
  const remaining = entries.filter((entry) => !preferred.includes(entry));
  const ordered = [...preferred, ...remaining];

  for (const entry of ordered) {
    const candidate = resolve(toolchainsDir, entry, "bin", rustcBinaryName());
    if (!existsSync(candidate)) {
      continue;
    }
    const probed = probeRustcCandidate(candidate);
    if (probed) {
      return probed;
    }
  }

  return null;
}

function looksLikeRustupInitShim(candidate) {
  // `rustup-init` (and the Homebrew `rustup` symlink that ultimately resolves
  // to it) reports `rustup-init <version>` when invoked under a name it does
  // not recognise as a proxy. We never want to call any of these as `rustc`.
  if (!candidate) {
    return false;
  }
  const name = basename(candidate).toLowerCase();
  return name.startsWith("rustup-init") || name.startsWith("rustup");
}

function resolveRustcCommand(targetVersion = null) {
  // The macos-latest GitHub runner ships Homebrew's `rustup` formula, which
  // puts `/opt/homebrew/bin/rustc` (and `rustup`) ahead of `~/.cargo/bin/`
  // on PATH and points both at `rustup-init`. When `rustup-init` is invoked
  // as `rustc` (or as `rustup which rustc`) it doesn't act as a proxy, it
  // just prints `rustup-init <its-own-version>` and exits, which used to
  // make the parity gate fail with `found rustc 1.29.0`.
  //
  // To make matters worse, `dtolnay/rust-toolchain` only adds
  // `${CARGO_HOME}/bin` to `$PATH` when it had to install rustup itself, so
  // on `macos-latest` (where rustup is preinstalled by Homebrew) there are
  // no rustup-managed proxies under `~/.cargo/bin/` either: the only places
  // a real rustc lives are inside `${RUSTUP_HOME}/toolchains/*/bin/`.
  //
  // We walk a series of candidate locations and only accept one whose
  // `--version` output actually starts with the `rustc X.Y.Z` banner.

  // 1) Probe the rustup-managed toolchain directly under CARGO_HOME. This
  //    is what `dtolnay/rust-toolchain` installs into when it has to
  //    bootstrap rustup itself, and lets us sidestep Homebrew's shim
  //    entirely without depending on PATH ordering.
  const cargoHome = process.env.CARGO_HOME
    ? resolve(process.env.CARGO_HOME)
    : process.env.HOME
      ? resolve(process.env.HOME, ".cargo")
      : process.env.USERPROFILE
        ? resolve(process.env.USERPROFILE, ".cargo")
        : null;
  if (cargoHome) {
    const cargoRustc = resolve(cargoHome, "bin", rustcBinaryName());
    if (existsSync(cargoRustc)) {
      const probed = probeRustcCandidate(cargoRustc);
      if (probed) {
        return probed;
      }
    }
  }

  // 2) Look inside `${RUSTUP_HOME}/toolchains/*/bin/rustc` for the actual
  //    toolchain binary. This is the path that always exists once
  //    `rustup toolchain install` has run, regardless of whether rustup
  //    itself came from Homebrew, the official installer, or the runner
  //    image, and it cannot accidentally resolve to `rustup-init`.
  const fromToolchains = resolveRustcFromRustupToolchains(targetVersion);
  if (fromToolchains) {
    return fromToolchains;
  }

  // 3) Ask rustup which rustc to use, but only trust the answer if it
  //    actually points at an existing file whose basename is `rustc` (not
  //    a `rustup-init` shim) and whose --version output is a valid rustc
  //    banner.
  const resolved = tryCapture("rustup", ["which", "rustc"]);
  if (resolved) {
    const path = resolved.split(/\r?\n/).pop()?.trim();
    if (path && existsSync(path) && !looksLikeRustupInitShim(path)) {
      const probed = probeRustcCandidate(path);
      if (probed) {
        return probed;
      }
    }
  }

  // 4) As a last resort, walk every `rustc` on PATH and pick the first one
  //    that actually prints a `rustc X.Y.Z` banner. This skips past any
  //    `rustup-init` shims masquerading as `rustc`.
  const lookupCmd = process.platform === "win32" ? "where" : "which";
  const lookupArgs = process.platform === "win32" ? ["rustc"] : ["-a", "rustc"];
  const candidates = tryCapture(lookupCmd, lookupArgs);
  if (candidates) {
    const seen = new Set();
    for (const raw of candidates.split(/\r?\n/)) {
      const candidate = raw.trim();
      if (!candidate || seen.has(candidate)) {
        continue;
      }
      seen.add(candidate);
      if (looksLikeRustupInitShim(candidate)) {
        continue;
      }
      const probed = probeRustcCandidate(candidate);
      if (probed) {
        return probed;
      }
    }
  }

  return "rustc";
}

export function assertRustVersionAtLeast(minimumVersion = RUST_VERSION) {
  const command = resolveRustcCommand(minimumVersion);
  const raw = capture(command, ["--version"]);
  if (!/^\s*rustc\s+\d+\.\d+\.\d+/m.test(raw)) {
    fail(
      `Expected \`${command} --version\` to print a \`rustc X.Y.Z\` banner, ` +
        `but got: ${JSON.stringify(raw)}. ` +
        "This usually means PATH is pointing at a non-rustup binary " +
        "(e.g. Homebrew's `rustup-init` shim) and no real toolchain was " +
        `found under \`${process.env.RUSTUP_HOME || "~/.rustup"}/toolchains/\`. ` +
        "Make sure `~/.cargo/bin` is on PATH ahead of `/opt/homebrew/bin`, " +
        "install the toolchain via `dtolnay/rust-toolchain`, or set " +
        "RUSTUP_HOME to a directory containing the expected toolchain.",
    );
  }
  const actual = parseVersion(raw, "rustc");
  const minimum = minimumVersion.split(".").map((part) => Number.parseInt(part, 10));
  if (compareVersions(actual, minimum) < 0) {
    fail(
      `Desktop builds require rustc >= ${minimumVersion}, but found rustc ${actual.join(".")} (raw: ${JSON.stringify(raw)}).`,
    );
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

export function assertXcodeMajorAtLeast(minimumMajor = XCODE_MAJOR) {
  const output = capture("xcodebuild", ["-version"]);
  const match = output.match(/Xcode\s+(\d+)(?:\.(\d+))?/);
  if (!match) {
    fail(`Unable to parse Xcode version from: ${output}`);
  }

  const actualMajor = Number.parseInt(match[1], 10);
  if (actualMajor < minimumMajor) {
    fail(
      `iOS release lanes require Xcode >= ${minimumMajor}.0, but found "${output.split("\n")[0]}". ` +
        "Apple's App Store Connect upload validation requires the iOS 26 SDK (Xcode 26+) since 2026-04-28; " +
        "select a newer toolchain via `sudo xcode-select -s /Applications/Xcode_26.4.app` or pin the runner image to macos-26.",
    );
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
    assertXcodeMajorAtLeast(XCODE_MAJOR);
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
