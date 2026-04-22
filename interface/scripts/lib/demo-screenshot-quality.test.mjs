import assert from "node:assert/strict";
import test from "node:test";

import { assessDemoScreenshotQuality } from "./demo-screenshot-quality.mjs";

test("assessDemoScreenshotQuality passes a strong desktop proof frame", () => {
  const report = assessDemoScreenshotQuality({
    phaseId: "validate-proof",
    viewport: { width: 1600, height: 1000 },
    screenshot: {
      kind: "surface-union",
      clip: { x: 120, y: 80, width: 1240, height: 720 },
    },
    visibleText: "Agents Aura CEO Skills Installed Skill Shop Permissions Memory Project Copilot",
    validationMatches: ["Agents", "Skills"],
    minSignalMatches: 1,
    routeMatched: true,
    activeAppMatched: true,
    uiSignals: {
      placeholderVisible: false,
      emptyStateVisible: false,
      mobileLayoutVisible: false,
      errorTextVisible: false,
    },
  });

  assert.equal(report.ok, true);
  assert.ok(report.score >= 80);
});

test("assessDemoScreenshotQuality fails when a disallowed navigation tool was used", () => {
  const report = assessDemoScreenshotQuality({
    phaseId: "validate-proof",
    viewport: { width: 1600, height: 1000 },
    screenshot: {
      kind: "surface-union",
      clip: { x: 120, y: 80, width: 1240, height: 720 },
    },
    visibleText: "Feedback Launch Update Comments Feedback App Desktop Shell",
    validationMatches: ["Feedback"],
    minSignalMatches: 1,
    routeMatched: true,
    activeAppMatched: true,
    uiSignals: {
      placeholderVisible: false,
      emptyStateVisible: false,
      mobileLayoutVisible: false,
      errorTextVisible: false,
    },
    forbiddenToolCalls: ["goto"],
  });

  assert.equal(report.ok, false);
  assert.ok(report.hardFailures.some((check) => check.name === "forbidden-tool"));
});

test("assessDemoScreenshotQuality fails placeholder and mobile layouts", () => {
  const report = assessDemoScreenshotQuality({
    phaseId: "validate-proof",
    viewport: { width: 1600, height: 1000 },
    screenshot: {
      kind: "full-page",
      clip: null,
    },
    visibleText: "Feed This area is not available in the web app yet.",
    validationMatches: [],
    minSignalMatches: 1,
    routeMatched: false,
    activeAppMatched: false,
    uiSignals: {
      placeholderVisible: true,
      emptyStateVisible: true,
      mobileLayoutVisible: true,
      errorTextVisible: false,
    },
  });

  assert.equal(report.ok, false);
  assert.ok(report.hardFailures.some((check) => check.name === "placeholder-surface"));
  assert.ok(report.hardFailures.some((check) => check.name === "desktop-layout"));
});

test("assessDemoScreenshotQuality fails when story-specific proof requirements are missing", () => {
  const report = assessDemoScreenshotQuality({
    phaseId: "validate-proof",
    viewport: { width: 1600, height: 1000 },
    screenshot: {
      kind: "surface-union",
      clip: { x: 120, y: 80, width: 1240, height: 720 },
    },
    visibleText: "Agents Skill Shop Installed My Skills Available",
    validationMatches: ["Agents", "Skill Shop"],
    minSignalMatches: 2,
    proofRequirements: [
      { label: "delete skill modal", anyOf: ["Delete skill"] },
      { label: "confirmation controls", anyOf: ["Cancel"] },
    ],
    proofRequirementMatches: [],
    routeMatched: true,
    activeAppMatched: true,
    uiSignals: {
      placeholderVisible: false,
      emptyStateVisible: false,
      mobileLayoutVisible: false,
      errorTextVisible: false,
      feedbackThreadVisible: false,
    },
  });

  assert.equal(report.ok, false);
  assert.ok(report.hardFailures.some((check) => check.name === "proof-requirements"));
});

test("assessDemoScreenshotQuality fails when a required UI state or forbidden placeholder phrase is present", () => {
  const report = assessDemoScreenshotQuality({
    phaseId: "validate-proof",
    viewport: { width: 1600, height: 1000 },
    screenshot: {
      kind: "surface-union",
      clip: { x: 120, y: 80, width: 1240, height: 720 },
    },
    visibleText: "Feedback Select a feedback item to view comments",
    validationMatches: ["Feedback"],
    minSignalMatches: 1,
    requiredUiSignals: ["feedbackThreadVisible"],
    routeMatched: true,
    activeAppMatched: true,
    uiSignals: {
      placeholderVisible: false,
      emptyStateVisible: false,
      mobileLayoutVisible: false,
      errorTextVisible: false,
      feedbackThreadVisible: false,
    },
    forbiddenPhrases: ["Select a feedback item to view comments"],
    forbiddenPhraseMatches: ["Select a feedback item to view comments"],
  });

  assert.equal(report.ok, false);
  assert.ok(report.hardFailures.some((check) => check.name === "required-ui-state"));
  assert.ok(report.hardFailures.some((check) => check.name === "forbidden-proof-phrase"));
});

test("assessDemoScreenshotQuality rejects an overly loose multi-panel crop", () => {
  const report = assessDemoScreenshotQuality({
    phaseId: "validate-proof",
    viewport: { width: 1600, height: 1000 },
    screenshot: {
      kind: "surface-union",
      targets: ["main-panel", "sidekick-header", "sidekick-panel"],
      clip: { x: 0, y: 50, width: 1600, height: 900 },
    },
    visibleText: "Launch Team 0 commits Legacy push cards show a correct commit count Product This seeded update is ready to be shown in changelog capture mode.",
    validationMatches: ["0 commits"],
    minSignalMatches: 1,
    routeMatched: true,
    activeAppMatched: true,
    uiSignals: {
      placeholderVisible: false,
      emptyStateVisible: false,
      mobileLayoutVisible: false,
      errorTextVisible: false,
    },
  });

  assert.equal(report.ok, false);
  assert.ok(report.checks.some((check) => check.name === "composed-crop" && check.ok === false));
});
