import { expect, test } from "@playwright/test";
import { deltaFromEntry, loadPerfBudgets } from "./load-budgets";

const budgets = loadPerfBudgets();

test.describe("startup instrumentation", () => {
  test("login route records app entry and auth-restore within startup budgets", async ({ page }) => {
    await page.goto("/login");

    await expect
      .poll(
        async () => {
          return await page.evaluate(() => {
            const m = window.__AURA_PERF__?.marks;
            return m?.["aura:auth:session-restore:complete"] != null;
          });
        },
        { timeout: 30_000 },
      )
      .toBe(true);

    const snapshot = await page.evaluate(() => window.__AURA_PERF__);
    expect(snapshot?.marks["aura:app:entry"]).toBeDefined();
    expect(snapshot?.marks["aura:app:react:root-render-scheduled"]).toBeDefined();
    expect(snapshot?.marks["aura:auth:session-restore:complete"]).toBeDefined();

    const marks = snapshot!.marks;
    for (const [markName, maxDelta] of Object.entries(budgets.startupMs.maxDeltaFromEntry)) {
      const d = deltaFromEntry(marks, markName);
      expect(d, `${markName} Δ from aura:app:entry`).toBeLessThanOrEqual(maxDelta);
    }

    // Authenticated shell is not mounted on /login.
    expect(snapshot?.marks["aura:ui:shell:visible"]).toBeUndefined();
  });

  test("web vitals snapshot exists and stays within login-route budgets", async ({ page }) => {
    await page.goto("/login");
    await page.waitForLoadState("networkidle").catch(() => {
      /* preview / flaky networks */
    });

    const vitals = await page.evaluate(() => window.__AURA_PERF__?.webVitals);
    expect(vitals).toBeDefined();

    const { maxLcpMsWhenPresent, maxCls } = budgets.webVitals.loginRoute;
    if (vitals!.lcpMs != null) {
      expect(vitals!.lcpMs, "LCP (ms)").toBeLessThanOrEqual(maxLcpMsWhenPresent);
    }
    expect(vitals!.cls, "CLS").toBeLessThanOrEqual(maxCls);
  });
});
