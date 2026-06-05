#!/usr/bin/env node

import process from "node:process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  assertDesktopRuntime,
  repoRoot,
  run,
} from "./lib/utils.mjs";

const args = new Set(process.argv.slice(2));
const withCargoCheck = args.has("--cargo-check");

assertDesktopRuntime({ requireHarness: false });

run("node", ["--check", "infra/scripts/release/desktop-local-auto-update-smoke.mjs"], {
  cwd: repoRoot,
  label: "preflight:desktop-auto-update-smoke-syntax",
});
run("node", ["--check", "infra/scripts/release/desktop-release-artifacts-validate.mjs"], {
  cwd: repoRoot,
  label: "preflight:desktop-artifact-validator-syntax",
});
run("node", ["--check", "scripts/ci/verify-desktop-release-binary.mjs"], {
  cwd: repoRoot,
  label: "preflight:desktop-release-binary-validator-syntax",
});
run("node", ["--test", "infra/scripts/release/desktop-frontend-assets-validate.test.mjs"], {
  cwd: repoRoot,
  label: "preflight:frontend-assets-test",
});
run("node", ["--test", "infra/scripts/release/prepare-desktop-sidecar.test.mjs"], {
  cwd: repoRoot,
  label: "preflight:sidecar-contract-test",
});
run("node", ["--test", "infra/scripts/release/desktop-manifest-validate.test.mjs"], {
  cwd: repoRoot,
  label: "preflight:manifest-test",
});
run("node", ["--test", "infra/scripts/release/desktop-downloads-validate.test.mjs"], {
  cwd: repoRoot,
  label: "preflight:downloads-test",
});
run(
  "cargo",
  [
    "metadata",
    "--format-version",
    "1",
    "--no-deps",
    "--manifest-path",
    "apps/aura-os-desktop/Cargo.toml",
  ],
  {
    cwd: repoRoot,
    label: "preflight:desktop-cargo-metadata",
    stdio: ["ignore", "ignore", "inherit"],
  },
);

if (withCargoCheck) {
  const placeholderDist = resolve(repoRoot, "interface", "dist");
  mkdirSync(placeholderDist, { recursive: true });
  writeFileSync(
    resolve(placeholderDist, "index.html"),
    "<!doctype html><meta charset=\"utf-8\"><title>AURA CI preflight</title>\n",
  );

  run(
    "cargo",
    [
      "check",
      "--release",
      "--no-default-features",
      "--features",
      "stable-channel",
      "--package",
      "aura-os-desktop",
      "--target-dir",
      "../.aura-preflight-target",
    ],
    {
      cwd: repoRoot,
      label: "preflight:desktop-cargo-check",
      env: {
        ...process.env,
        AURA_DESKTOP_USE_PREBUILT_FRONTEND: "1",
      },
    },
  );
}
