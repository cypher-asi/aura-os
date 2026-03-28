import { defineConfig, devices } from "@playwright/test";

const externalEvalBaseUrl = process.env.AURA_EVAL_LIVE === "1"
  ? process.env.AURA_EVAL_BASE_URL
  : undefined;
const baseURL = externalEvalBaseUrl ?? "http://127.0.0.1:4173";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  retries: 0,
  reporter: "list",
  use: {
    baseURL,
    trace: "on-first-retry",
    serviceWorkers: "allow",
  },
  webServer: externalEvalBaseUrl ? undefined : {
    command: "npm run build && npm run preview -- --host 127.0.0.1 --port 4173",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: true,
    timeout: 120_000,
  },
  projects: [
    {
      name: "desktop-chromium",
      testMatch: ["**/layout-capability.desktop.spec.ts", "**/responsive-unification.spec.ts", "**/desktop-visual.spec.ts"],
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
      },
    },
    {
      name: "tablet-chromium",
      testMatch: ["**/responsive-unification.spec.ts"],
      use: {
        ...devices["iPad Mini"],
      },
    },
    {
      name: "mobile-chromium",
      testMatch: ["**/pwa-mobile.spec.ts", "**/pwa-mobile-visual.spec.ts", "**/responsive-unification.spec.ts"],
      use: {
        ...devices["Pixel 7"],
      },
    },
    {
      name: "mobile-webkit",
      testMatch: ["**/pwa-mobile.spec.ts", "**/pwa-mobile-visual.spec.ts", "**/responsive-unification.spec.ts"],
      use: {
        ...devices["iPhone 13"],
      },
    },
    {
      name: "eval-desktop-chromium",
      testMatch: ["**/evals/core-feature-smoke.spec.ts"],
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
      },
    },
    {
      name: "eval-mobile-chromium",
      testMatch: ["**/evals/core-feature-smoke.spec.ts"],
      use: {
        ...devices["Pixel 7"],
      },
    },
    {
      name: "eval-mobile-webkit",
      testMatch: ["**/evals/core-feature-smoke.spec.ts"],
      use: {
        ...devices["iPhone 13"],
      },
    },
    {
      name: "eval-live-desktop",
      testMatch: ["**/evals/live-benchmark.spec.ts"],
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
      },
    },
    {
      name: "eval-workflow-desktop",
      testMatch: ["**/evals/workflow-e2e.spec.ts"],
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
      },
    },
  ],
});
