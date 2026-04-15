import process from "node:process";

import { assertIosRuntime, interfaceDir, repoRoot, run } from "./lib/utils.mjs";

assertIosRuntime({ requireNative: true });

run("npm", ["ci"], { cwd: interfaceDir });
run("npm", ["run", "build"], { cwd: interfaceDir });
run("npx", ["cap", "sync", "ios"], { cwd: interfaceDir });
run(
  "xcodebuild",
  [
    "-project",
    "ios/App/App.xcodeproj",
    "-scheme",
    "App",
    "-configuration",
    "Debug",
    "-destination",
    "generic/platform=iOS Simulator",
    "-derivedDataPath",
    "/tmp/aura-ios-validate",
    "build",
  ],
  { cwd: interfaceDir },
);
run(
  "node",
  [
    "infra/scripts/release/mobile-release-summary.mjs",
    "--platform",
    "ios",
    "--mode",
    "validate",
    "--output-dir",
    "mobile-release-summary",
    "--roots",
    "/tmp/aura-ios-validate/Build/Products",
  ],
  { cwd: repoRoot, env: { ...process.env } },
);
