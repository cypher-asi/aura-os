import process from "node:process";

// Mirrors the env-var contract enforced by interface/android/fastlane/Fastfile.
// Kept in a single place so CI can surface every missing secret in one pass,
// instead of discovering them one-at-a-time through Fastlane `required_env!`
// failures mid-build.
const SIGNING_VARS = [
  "ANDROID_KEYSTORE_PATH",
  "ANDROID_KEYSTORE_PASSWORD",
  "ANDROID_KEY_ALIAS",
  "ANDROID_KEY_PASSWORD",
];

const PLAY_STORE_VARS = ["ANDROID_PLAY_SERVICE_ACCOUNT_JSON_BASE64"];

const LANE_REQUIREMENTS = {
  github_release: {
    description: "Signed Android APK for GitHub distribution",
    required: [...SIGNING_VARS],
  },
  preflight: {
    description: "Validate Google Play release configuration",
    required: [...SIGNING_VARS, ...PLAY_STORE_VARS],
  },
  beta: {
    description: "Internal Google Play upload",
    required: [...SIGNING_VARS, ...PLAY_STORE_VARS],
  },
  release: {
    description: "Google Play release upload",
    required: [...SIGNING_VARS, ...PLAY_STORE_VARS],
  },
};

const lane = process.argv[2];
if (!lane) {
  console.error("Usage: node scripts/ci/verify-android-release-secrets.mjs <lane>");
  console.error(`Known lanes: ${Object.keys(LANE_REQUIREMENTS).join(", ")}`);
  process.exit(2);
}

const spec = LANE_REQUIREMENTS[lane];
if (!spec) {
  console.error(
    `Unknown Android lane "${lane}". Known lanes: ${Object.keys(LANE_REQUIREMENTS).join(", ")}`,
  );
  process.exit(2);
}

const missing = spec.required.filter((name) => (process.env[name] ?? "").length === 0);

if (missing.length === 0) {
  console.log(
    `[android-preflight] All ${spec.required.length} required variables for "${lane}" are set.`,
  );
  process.exit(0);
}

const plural = missing.length === 1 ? "" : "s";
const message = [
  "",
  `[android-preflight] The Android "${lane}" lane (${spec.description}) cannot run.`,
  `Missing required environment variable${plural}:`,
  ...missing.map((name) => `  - ${name}`),
  "",
  "Configure these as GitHub Actions repository secrets and wire them into the workflow env:",
  "  Settings -> Secrets and variables -> Actions -> New repository secret",
  "",
  "Notes:",
  "  * ANDROID_PLAY_SERVICE_ACCOUNT_JSON_BASE64 must be the Google Play service",
  "    account JSON key, base64-encoded as a single line. Example:",
  "      base64 -w 0 play-service-account.json",
  "  * ANDROID_KEYSTORE_PATH is materialised at runtime from ANDROID_KEYSTORE_BASE64.",
  "    Make sure the 'Materialize Android upload keystore' step runs before this check.",
  "",
].join("\n");

console.error(message);
process.exit(1);
