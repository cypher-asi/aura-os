import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAuraNavigationContract,
  buildAuraNavigationSitemap,
  listAuraNavigationApps,
} from "./aura-navigation-contract.mjs";

test("listAuraNavigationApps extracts apps and agent-facing handles from the registry", async () => {
  const apps = await listAuraNavigationApps();
  const agents = apps.find((app) => app.id === "agents");
  const aura3d = apps.find((app) => app.id === "aura3d");

  assert.ok(apps.length >= 5);
  assert.equal(agents?.path, "/agents");
  assert.ok(Array.isArray(agents?.sourceContext?.surfaces));
  assert.equal(aura3d?.sourceContext?.baseRouteKind, "placeholder");
});

test("buildAuraNavigationSitemap reports coverage gaps for inference hardening", async () => {
  const sitemap = await buildAuraNavigationSitemap();

  assert.equal(sitemap.schemaVersion, 1);
  assert.equal(sitemap.coverage.appCount, sitemap.apps.length);
  assert.ok(Array.isArray(sitemap.coverage.appGaps));
  assert.match(sitemap.updatePolicy.join(" "), /Regenerate this sitemap/);
});

test("buildAuraNavigationContract ranks changed app files as likely targets", async () => {
  const contract = await buildAuraNavigationContract({
    prompt: "GPT-5.5 is available in the chat model picker.",
    changedFiles: ["interface/src/apps/agents/components/AgentChat/ChatInputBar.tsx"],
  });

  assert.equal(contract.schemaVersion, 1);
  assert.equal(contract.likelyApps[0]?.id, "agents");
  assert.ok(contract.apps.some((app) => app.id === "agents"));
  assert.equal(contract.mediaEligibility.shouldAttemptCapture, true);
  assert.equal(contract.desktopCapturePolicy.viewport.width, 1920);
  assert.match(contract.rules.join(" "), /Never capture mobile/);
});

test("buildAuraNavigationContract rejects mobile-only media candidates", async () => {
  const contract = await buildAuraNavigationContract({
    prompt: "Improve the Android mobile release screen.",
    changedFiles: [
      "interface/android/app/src/main/AndroidManifest.xml",
      ".github/workflows/release-mobile-nightly.yml",
    ],
  });

  assert.equal(contract.mediaEligibility.shouldAttemptCapture, false);
  assert.match(contract.mediaEligibility.reason, /mobile-only/);
  assert.deepEqual(contract.desktopCapturePolicy.minimumViewport, {
    width: 1366,
    height: 600,
  });
});

test("buildAuraNavigationContract uses commit logs as an early mobile-only gate", async () => {
  const contract = await buildAuraNavigationContract({
    prompt: "Ship the latest release updates.",
    changedFiles: [],
    commitLog: [
      "a1b2c3d Improve Android mobile release screen",
      "d4e5f6a Add iOS App Store metadata",
    ].join("\n"),
  });

  assert.equal(contract.mediaEligibility.shouldAttemptCapture, false);
  assert.match(contract.mediaEligibility.reason, /commit log is mobile-only/);
  assert.match(contract.commitContext.logExcerpt, /Android mobile release/);
  assert.equal(contract.likelyApps.length, 0);
});

test("buildAuraNavigationContract uses commit logs to rank desktop product surfaces", async () => {
  const contract = await buildAuraNavigationContract({
    prompt: "Ship the latest release updates.",
    changedFiles: [],
    commitLog: "abc123 GPT-5.5 is available in the chat model picker",
  });

  assert.equal(contract.mediaEligibility.shouldAttemptCapture, true);
  assert.equal(contract.likelyApps[0]?.id, "agents");
  assert.match(contract.mediaEligibility.reason, /desktop\/product surface/);
});
