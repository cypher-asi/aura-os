import process from "node:process";

import {
  assertAndroidRuntime,
  assertDesktopRuntime,
  assertEvalsRuntime,
  assertIosRuntime,
  fail,
} from "./lib/utils.mjs";

const [lane, ...flags] = process.argv.slice(2);
const flagSet = new Set(flags);

if (!lane) {
  fail("Usage: node scripts/ci/check-runtime.mjs <desktop|evals|ios|android> [--require-harness] [--native] [--ruby]");
}

switch (lane) {
  case "desktop":
    assertDesktopRuntime({ requireHarness: flagSet.has("--require-harness") });
    break;
  case "evals":
    assertEvalsRuntime();
    break;
  case "ios":
    assertIosRuntime({
      requireNative: flagSet.has("--native"),
      requireRuby: flagSet.has("--ruby"),
    });
    break;
  case "android":
    assertAndroidRuntime({
      requireSdk: flagSet.has("--native"),
      requireRuby: flagSet.has("--ruby"),
    });
    break;
  default:
    fail(`Unknown lane "${lane}". Expected desktop, evals, ios, or android.`);
}

console.log(`[ci-parity] ${lane} runtime check passed.`);
