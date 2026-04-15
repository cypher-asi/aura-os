import process from "node:process";

import { assertAndroidRuntime, interfaceDir, repoRoot, run } from "./lib/utils.mjs";

const gradleCommand = process.platform === "win32" ? "gradlew.bat" : "./gradlew";

assertAndroidRuntime({ requireSdk: true });

run("npm", ["ci"], { cwd: interfaceDir });
run("npm", ["run", "build"], { cwd: interfaceDir });
run("npx", ["cap", "sync", "android"], { cwd: interfaceDir });
run(gradleCommand, ["assembleDebug"], { cwd: `${interfaceDir}/android` });
run(
  "node",
  [
    "infra/scripts/release/mobile-release-summary.mjs",
    "--platform",
    "android",
    "--mode",
    "validate",
    "--output-dir",
    "mobile-release-summary",
    "--roots",
    "interface/android/app/build/outputs",
  ],
  { cwd: repoRoot, env: { ...process.env } },
);
