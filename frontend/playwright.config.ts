import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "on-first-retry",
    serviceWorkers: "allow",
  },
  webServer: {
    command: "npm run build && npm run preview -- --host 127.0.0.1 --port 4173",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: true,
    timeout: 120_000,
  },
  projects: [
    {
      name: "desktop-chromium",
      testMatch: ["**/layout-capability.desktop.spec.ts", "**/responsive-unification.spec.ts"],
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
  ],
});
