import assert from "node:assert/strict";
import test from "node:test";

import { normalizeCaptureSeedPlan } from "./changelog-media-seed-plan.mjs";

test("normalizeCaptureSeedPlan derives generic capabilities without feature-specific scripts", () => {
  const plan = normalizeCaptureSeedPlan(null, {
    title: "add image generation flow with sidekick panels",
    targetAppId: "aura3d",
    targetPath: "/3d",
    proofGoal: "Show the generated image gallery and sidekick panel.",
    changedFiles: ["interface/src/apps/aura3d/ImageGeneration/ImageGeneration.tsx"],
  });

  assert.equal(plan.schemaVersion, 1);
  assert.equal(plan.mode, "capture-demo-state");
  assert.ok(plan.capabilities.includes("app:aura3d"));
  assert.ok(plan.capabilities.includes("proof-data-populated"));
  assert.ok(plan.capabilities.includes("asset-gallery-populated"));
  assert.ok(plan.requiredState.some((entry) => entry.includes("meaningful proof data")));
  assert.ok(plan.proofBoundary.some((entry) => entry.includes("feature evidence")));
  assert.ok(plan.contextBoundary.some((entry) => entry.includes("recognizable product")));
  assert.ok(plan.avoid.includes("isolated widget without product context"));
  assert.ok(plan.readinessSignals.includes("desktop shell is visible"));
});

test("normalizeCaptureSeedPlan preserves AI-provided seed intent and deduplicates capabilities", () => {
  const plan = normalizeCaptureSeedPlan({
    mode: "capture-demo-state",
    capabilities: ["project-selected", "project-selected", "run-history-populated"],
    requiredState: ["A run timeline exists."],
    proofBoundary: ["The run status timeline proves the change."],
    contextBoundary: ["The Debug app title and run detail panel remain visible."],
    readinessSignals: ["Run detail timeline is visible."],
    avoid: ["empty run history"],
    notes: "Use seeded data only.",
  }, {
    title: "surface live runs in Debug",
    targetAppId: "debug",
    targetPath: "/debug",
  });

  assert.ok(plan.capabilities.includes("app:debug"));
  assert.ok(plan.capabilities.includes("project-selected"));
  assert.ok(plan.capabilities.includes("run-history-populated"));
  assert.equal(plan.capabilities.filter((entry) => entry === "project-selected").length, 1);
  assert.ok(plan.requiredState.includes("A run timeline exists."));
  assert.ok(plan.proofBoundary.includes("The run status timeline proves the change."));
  assert.ok(plan.contextBoundary.includes("The Debug app title and run detail panel remain visible."));
  assert.ok(plan.avoid.includes("empty run history"));
  assert.ok(plan.readinessSignals.includes("Run detail timeline is visible."));
  assert.equal(plan.notes, "Use seeded data only.");
});
