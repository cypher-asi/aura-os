import process from "node:process";

import {
  assertDesktopRuntime,
  desktopBinaryPath,
  interfaceDir,
  repoRoot,
  run,
} from "./lib/utils.mjs";

const args = process.argv.slice(2);
const withSmoke = args.includes("--smoke");
const binaryFlagIndex = args.indexOf("--binary");
const binaryPath =
  binaryFlagIndex >= 0 && args[binaryFlagIndex + 1] ? args[binaryFlagIndex + 1] : desktopBinaryPath();

assertDesktopRuntime({ requireHarness: true });

run("node", ["--check", "infra/scripts/release/desktop-local-auto-update-smoke.mjs"], {
  cwd: repoRoot,
});
run("node", ["--test", "infra/scripts/release/desktop-frontend-assets-validate.test.mjs"], {
  cwd: repoRoot,
});
run("node", ["--test", "infra/scripts/release/prepare-desktop-sidecar.test.mjs"], {
  cwd: repoRoot,
});
run("node", ["infra/scripts/release/prepare-desktop-sidecar.mjs", "--check"], {
  cwd: repoRoot,
});
run("npm", ["ci"], { cwd: interfaceDir });
run("node", ["infra/scripts/release/prepare-desktop-sidecar.mjs"], { cwd: repoRoot });
run("npm", ["run", "build"], { cwd: interfaceDir });
run("node", ["infra/scripts/release/desktop-frontend-assets-validate.mjs", "--dist", "interface/dist"], {
  cwd: repoRoot,
});
const cargoArgs = ["build", "--release", "--package", "aura-os-desktop"];

if (process.env.AURA_CARGO_TIMINGS === "1") {
  cargoArgs.push("--timings");
}

run("cargo", cargoArgs, {
  cwd: repoRoot,
  env: {
    ...process.env,
    AURA_DESKTOP_USE_PREBUILT_FRONTEND: "1",
  },
});

if (withSmoke) {
  run("node", ["infra/scripts/release/desktop-ci-smoke.mjs"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      AURA_DESKTOP_BINARY: binaryPath,
    },
  });
}
