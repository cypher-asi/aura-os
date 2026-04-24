import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { PNG } from "pngjs";

import {
  assessMediaModelQuality,
  buildPublishableMediaManifest,
  discoverCaptureApiBaseUrlFromFrontend,
  preflightCaptureAuth,
  resolveCaptureApiBaseUrl,
  runChangelogMediaEvaluation,
} from "./evaluate-changelog-media-pipeline.mjs";

function fakeResponse({ status, headers = {}, body = "" }) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        return headers[name.toLowerCase()] || "";
      },
    },
    async text() {
      return body;
    },
  };
}

test("resolveCaptureApiBaseUrl prefers explicit API origins", async () => {
  const resolved = await resolveCaptureApiBaseUrl({
    baseUrl: "https://frontend.example.com",
    apiBaseUrl: "https://api.example.com/some/path",
    fetchImpl: async () => {
      throw new Error("explicit API URL should not need discovery");
    },
  });

  assert.equal(resolved, "https://api.example.com");
});

test("assessMediaModelQuality blocks non-Opus models from producing publishable media", () => {
  const gate = assessMediaModelQuality({
    anthropicModel: "claude-sonnet-4-6",
    browserUseModel: "claude-opus-4.6",
    visionJudgeModel: "claude-haiku-4-5",
  });

  assert.equal(gate.ok, false);
  assert.equal(gate.status, "blocked");
  assert.ok(gate.concerns.some((concern) => concern.includes("planner")));
  assert.ok(gate.concerns.some((concern) => concern.includes("vision")));
});

test("buildPublishableMediaManifest omits failed media instead of creating placeholders", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-media-manifest-"));
  const pngPath = path.join(tempDir, "branded.png");
  writeStructuredPng(pngPath, 160, 90);

  const manifest = buildPublishableMediaManifest({
    captureResults: [
      {
        candidate: {
          entryId: "ready",
          title: "Ready media",
          publicCaption: "Ready media is safe to publish.",
        },
        status: "accepted",
        provider: "browser-use-cloud",
        captureAccepted: true,
        publishReady: true,
        qualityGate: { ok: true, status: "accepted" },
        visionGate: { ok: true, status: "accepted" },
        branding: {
          status: "created",
          quality: { ok: true, status: "accepted" },
          asset: {
            path: path.join(tempDir, "branded.svg"),
            preview: {
              path: pngPath,
              format: "png",
              dimensions: { width: 160, height: 90 },
              bytes: fs.statSync(pngPath).size,
            },
          },
        },
        brandedVisionGate: { ok: true, status: "accepted" },
        result: { screenshot: { path: path.join(tempDir, "raw.png") } },
      },
      {
        candidate: { entryId: "failed", title: "Failed media" },
        status: "rejected",
        captureAccepted: false,
        publishReady: false,
        branding: { status: "blocked" },
      },
    ],
  });

  assert.equal(manifest.assets.length, 1);
  assert.equal(manifest.assets[0].entryId, "ready");
  assert.equal(manifest.recoveryPolicy.publishOnlyListedAssets, true);
  assert.equal(manifest.recoveryPolicy.failedOrMissingMediaBehavior, "omit-media-entirely");
  assert.equal(manifest.recoveryPolicy.placeholderHtmlAllowed, false);
});

test("buildPublishableMediaManifest requires accepted vision, not skipped vision", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-media-manifest-"));
  const pngPath = path.join(tempDir, "branded.png");
  writeStructuredPng(pngPath, 160, 90);
  const commonEntry = {
    status: "accepted",
    provider: "browser-use-cloud",
    captureAccepted: true,
    publishReady: true,
    qualityGate: { ok: true, status: "accepted" },
    branding: {
      status: "created",
      quality: { ok: true, status: "accepted" },
      asset: {
        path: path.join(tempDir, "branded.svg"),
        preview: {
          path: pngPath,
          format: "png",
          dimensions: { width: 160, height: 90 },
          bytes: fs.statSync(pngPath).size,
        },
      },
    },
  };

  const manifest = buildPublishableMediaManifest({
    captureResults: [
      {
        ...commonEntry,
        candidate: { entryId: "raw-skipped", title: "Raw skipped" },
        visionGate: { ok: true, status: "skipped" },
        brandedVisionGate: { ok: true, status: "accepted" },
      },
      {
        ...commonEntry,
        candidate: { entryId: "branded-skipped", title: "Branded skipped" },
        visionGate: { ok: true, status: "accepted" },
        brandedVisionGate: { ok: true, status: "skipped" },
      },
    ],
  });

  assert.equal(manifest.assets.length, 0);
});

test("discoverCaptureApiBaseUrlFromFrontend finds the API origin used by the deployed app bundle", async () => {
  const requests = [];
  const resolved = await discoverCaptureApiBaseUrlFromFrontend({
    baseUrl: "https://frontend.example.com",
    fetchImpl: async (url) => {
      requests.push(String(url));
      if (String(url) === "https://frontend.example.com") {
        return fakeResponse({
          status: 200,
          headers: { "content-type": "text/html" },
          body: '<script type="module" src="/assets/host-config.js"></script>',
        });
      }
      if (String(url) === "https://frontend.example.com/assets/host-config.js") {
        return fakeResponse({
          status: 200,
          headers: { "content-type": "application/javascript" },
          body: 'const api = "https://api.example.com";',
        });
      }
      if (String(url) === "https://api.example.com/api/auth/session") {
        return fakeResponse({
          status: 401,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ error: "missing authorization token" }),
        });
      }
      return fakeResponse({ status: 404, body: "not found" });
    },
  });

  assert.equal(resolved, "https://api.example.com");
  assert.deepEqual(requests, [
    "https://frontend.example.com",
    "https://frontend.example.com/assets/host-config.js",
    "https://api.example.com/api/auth/session",
  ]);
});

function writeStructuredPng(filePath, width = 160, height = 90) {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = ((width * y) + x) * 4;
      const bright = (x + y) % 24 < 12;
      png.data[offset] = bright ? 235 : 18;
      png.data[offset + 1] = bright ? 240 : 24;
      png.data[offset + 2] = bright ? 245 : 38;
      png.data[offset + 3] = 255;
    }
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, PNG.sync.write(png));
}

test("preflightCaptureAuth requires a live capture entry route and capture token JSON", async () => {
  const report = await preflightCaptureAuth({
    baseUrl: "https://example.com",
    apiBaseUrl: "https://api.example.com",
    captureSecret: "capture-secret-with-enough-entropy",
    fetchImpl: async (url) => {
      if (String(url).includes("capture-login=1")) {
        return fakeResponse({ status: 404, body: "Not Found" });
      }
      return fakeResponse({ status: 200, body: "" });
    },
  });

  assert.equal(report.ok, false);
  assert.ok(report.concerns.some((concern) => concern.includes("Capture login route returned HTTP 404")));
  assert.ok(report.concerns.some((concern) => concern.includes("expected 201")));
  assert.ok(report.concerns.some((concern) => concern.includes("aura-capture access token")));
});

test("preflightCaptureAuth accepts the deployed capture contract shape", async () => {
  const report = await preflightCaptureAuth({
    baseUrl: "https://example.com",
    apiBaseUrl: "https://api.example.com",
    captureSecret: "capture-secret-with-enough-entropy",
    fetchImpl: async (url) => {
      if (String(url).includes("capture-login=1")) {
        return fakeResponse({ status: 200, headers: { "content-type": "text/html" }, body: "<html></html>" });
      }
      return fakeResponse({
        status: 201,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ access_token: "aura-capture:test" }),
      });
    },
  });

  assert.equal(report.ok, true);
  assert.deepEqual(report.concerns, []);
});

test("runChangelogMediaEvaluation plans media and blocks capture when Browser Use credentials are absent", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-media-eval-"));
  const changelogPath = path.join(tempDir, "latest.json");
  fs.writeFileSync(changelogPath, JSON.stringify({
    rawCommits: [
      {
        sha: "abc123456789",
        subject: "feat(chat): add GPT-5.5 model picker option",
        files: ["interface/src/apps/agents/components/AgentChat/ChatInputBar.tsx"],
      },
    ],
    rendered: {
      entries: [
        {
          batch_id: "entry-1",
          title: "GPT-5.5 available in the chat model picker",
          summary: "Users can choose GPT-5.5 in chat.",
          items: [
            {
              text: "Added GPT-5.5 to the model picker.",
              commit_shas: ["abc123456789"],
              changed_files: ["interface/src/apps/agents/components/AgentChat/ChatInputBar.tsx"],
            },
          ],
        },
      ],
    },
  }));

  const previousAnthropic = process.env.ANTHROPIC_API_KEY;
  const previousBrowserUse = process.env.BROWSER_USE_API_KEY;
  const previousCaptureSecret = process.env.AURA_CHANGELOG_CAPTURE_SECRET;
  process.env.ANTHROPIC_API_KEY = "test-key";
  delete process.env.BROWSER_USE_API_KEY;
  delete process.env.AURA_CHANGELOG_CAPTURE_SECRET;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    async json() {
      return {
        content: [
          {
            type: "tool_use",
            name: "submit_changelog_media_plan",
            input: {
              candidates: [
                {
                  entryId: "entry-1",
                  title: "GPT-5.5 available in the chat model picker",
                  shouldCapture: true,
                  reason: "The model picker option is visible desktop UI.",
                  targetAppId: "agents",
                  targetPath: "/agents",
                  proofGoal: "Open the chat model picker and show GPT-5.5.",
                  publicCaption: "GPT-5.5 is now available directly from the chat model picker.",
                  confidence: 0.91,
                  changedFiles: ["interface/src/apps/agents/components/AgentChat/ChatInputBar.tsx"],
                },
              ],
              skipped: [],
            },
          },
        ],
      };
    },
  });

  try {
    const report = await runChangelogMediaEvaluation({
      changelogFile: changelogPath,
      outputDir: path.join(tempDir, "out"),
      baseUrl: "https://example.com",
      maxCandidates: 1,
    });

    assert.equal(report.counts.plannedCandidates, 1);
    assert.equal(report.counts.captureBlocked, 1);
    assert.equal(report.counts.publishableMediaAssets, 0);
    assert.deepEqual(report.publishableMedia.assets, []);
    assert.equal(report.publishableMedia.recoveryPolicy.placeholderHtmlAllowed, false);
    assert.match(report.captureResults[0].blockers[0], /BROWSER_USE_API_KEY/);
    assert.equal(fs.existsSync(path.join(tempDir, "out", "evaluation-report.json")), true);
    assert.equal(fs.existsSync(path.join(tempDir, "out", "publishable-media-manifest.json")), true);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousAnthropic === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = previousAnthropic;
    if (previousBrowserUse === undefined) delete process.env.BROWSER_USE_API_KEY;
    else process.env.BROWSER_USE_API_KEY = previousBrowserUse;
    if (previousCaptureSecret === undefined) delete process.env.AURA_CHANGELOG_CAPTURE_SECRET;
    else process.env.AURA_CHANGELOG_CAPTURE_SECRET = previousCaptureSecret;
  }
});

test("runChangelogMediaEvaluation creates branded media only after quality and vision pass", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-media-eval-"));
  const changelogPath = path.join(tempDir, "latest.json");
  fs.writeFileSync(changelogPath, JSON.stringify({
    rawCommits: [
      {
        sha: "abc123456789",
        subject: "feat(chat): add GPT-5.5 model picker option",
        files: ["interface/src/components/ChatInputBar/ChatInputBar.tsx"],
      },
    ],
    rendered: {
      entries: [
        {
          batch_id: "entry-1",
          title: "GPT-5.5 available in the chat model picker",
          summary: "Users can choose GPT-5.5 in chat.",
          items: [
            {
              text: "Added GPT-5.5 to the model picker.",
              commit_shas: ["abc123456789"],
              changed_files: ["interface/src/components/ChatInputBar/ChatInputBar.tsx"],
            },
          ],
        },
      ],
    },
  }));
  const screenshotPath = path.join(tempDir, "browser-use.png");
  writeStructuredPng(screenshotPath, 1920, 1080);

  const previousAnthropic = process.env.ANTHROPIC_API_KEY;
  const previousBrowserUse = process.env.BROWSER_USE_API_KEY;
  const previousCaptureSecret = process.env.AURA_CHANGELOG_CAPTURE_SECRET;
  process.env.ANTHROPIC_API_KEY = "test-key";
  process.env.BROWSER_USE_API_KEY = "browser-use-test-key";
  process.env.AURA_CHANGELOG_CAPTURE_SECRET = "capture-secret-with-enough-entropy";
  let capturedBrowserUseArgs = null;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    async json() {
      return {
        content: [
          {
            type: "tool_use",
            name: "submit_changelog_media_plan",
            input: {
              candidates: [
                {
                  entryId: "entry-1",
                  title: "GPT-5.5 available in the chat model picker",
                  shouldCapture: true,
                  reason: "The model picker option is visible desktop UI.",
                  targetAppId: "agents",
                  targetPath: "/agents",
                  proofGoal: "Open the chat model picker and show GPT-5.5.",
                  publicCaption: "GPT-5.5 is now available directly from the chat model picker.",
                  confidence: 0.91,
                  changedFiles: ["interface/src/components/ChatInputBar/ChatInputBar.tsx"],
                },
              ],
              skipped: [],
            },
          },
        ],
      };
    },
  });

  try {
    const report = await runChangelogMediaEvaluation({
      changelogFile: changelogPath,
      outputDir: path.join(tempDir, "out"),
      baseUrl: "https://example.com",
      maxCandidates: 1,
      preflightCaptureAuthImpl: async () => ({ ok: true, concerns: [], loginStatus: 200, sessionStatus: 201 }),
      requestCaptureSessionImpl: async () => ({
        ok: true,
        sessionStatus: 201,
        concerns: [],
        session: {
          user_id: "capture-demo-user",
          display_name: "Aura Capture",
          profile_image: "",
          primary_zid: "0://aura-capture",
          zero_wallet: "0x0000000000000000000000000000000000000000",
          wallets: [],
          is_zero_pro: true,
          is_access_granted: true,
          access_token: "aura-capture:test-token",
          created_at: "2026-04-24T00:00:00Z",
          validated_at: "2026-04-24T00:00:00Z",
        },
      }),
      browserUseTimeoutMs: 123456,
      browserUseIntervalMs: 3456,
      runBrowserUseTaskImpl: async (args) => {
        capturedBrowserUseArgs = args;
        return {
        ok: true,
        provider: "browser-use-cloud",
        output: {
          shouldCapture: true,
          targetAppId: "agents",
          targetPath: "/agents",
          proofSurface: "chat model picker",
          proofVisible: true,
          visibleProof: ["GPT-5.5 is visible in the chat model picker."],
          screenshotDescription: "Aura desktop chat screen with the model picker open.",
          desktopLayoutVisible: true,
          mobileLayoutVisible: false,
          concerns: [],
        },
        screenshot: {
          path: screenshotPath,
          dimensions: { width: 1920, height: 1080 },
        },
        messages: [],
      };
      },
      visionJudgeImpl: async () => ({
        ok: true,
        status: "accepted",
        concerns: [],
        judgment: {
          pass: true,
          score: 0.9,
          reasons: ["The model picker is visible and readable."],
          visibleProof: ["GPT-5.5 is visible."],
          rejectionCategory: null,
        },
      }),
    });

    assert.equal(report.counts.captureAccepted, 1);
    assert.equal(report.counts.visionAccepted, 1);
    assert.equal(report.counts.brandingCreated, 1);
    assert.equal(report.counts.brandedVisionAccepted, 1);
    assert.equal(report.counts.publishReady, 1);
    assert.equal(report.counts.publishableMediaAssets, 1);
    assert.equal(report.publishableMedia.assets.length, 1);
    assert.equal(report.publishableMedia.assets[0].entryId, "entry-1");
    assert.equal(report.browserUseRunOptions.timeoutMs, 123456);
    assert.equal(report.browserUseRunOptions.intervalMs, 3456);
    assert.equal(capturedBrowserUseArgs.timeoutMs, 123456);
    assert.equal(capturedBrowserUseArgs.intervalMs, 3456);
    const branding = report.captureResults[0].branding;
    assert.equal(branding.status, "created");
    assert.equal(fs.existsSync(branding.asset.path), true);
    assert.equal(fs.existsSync(branding.asset.preview.path), true);
    assert.equal(report.publishableMedia.assets[0].source.brandedPngPath, branding.asset.preview.path);
    assert.equal(branding.asset.preview.format, "png");
    assert.equal(branding.asset.embeddedScreenshot.scale, 1);
    assert.equal(report.captureResults[0].brandedVisionGate.status, "accepted");
  } finally {
    globalThis.fetch = originalFetch;
    if (previousAnthropic === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = previousAnthropic;
    if (previousBrowserUse === undefined) delete process.env.BROWSER_USE_API_KEY;
    else process.env.BROWSER_USE_API_KEY = previousBrowserUse;
    if (previousCaptureSecret === undefined) delete process.env.AURA_CHANGELOG_CAPTURE_SECRET;
    else process.env.AURA_CHANGELOG_CAPTURE_SECRET = previousCaptureSecret;
  }
});

test("runChangelogMediaEvaluation does not publish when vision judge is disabled", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-media-eval-"));
  const changelogPath = path.join(tempDir, "latest.json");
  fs.writeFileSync(changelogPath, JSON.stringify({
    rawCommits: [
      {
        sha: "abc123456789",
        subject: "feat(chat): add GPT-5.5 model picker option",
        files: ["interface/src/components/ChatInputBar/ChatInputBar.tsx"],
      },
    ],
    rendered: {
      entries: [
        {
          batch_id: "entry-1",
          title: "GPT-5.5 available in the chat model picker",
          summary: "Users can choose GPT-5.5 in chat.",
          items: [
            {
              text: "Added GPT-5.5 to the model picker.",
              commit_shas: ["abc123456789"],
              changed_files: ["interface/src/components/ChatInputBar/ChatInputBar.tsx"],
            },
          ],
        },
      ],
    },
  }));
  const screenshotPath = path.join(tempDir, "browser-use.png");
  writeStructuredPng(screenshotPath, 1920, 1080);

  const previousAnthropic = process.env.ANTHROPIC_API_KEY;
  const previousBrowserUse = process.env.BROWSER_USE_API_KEY;
  const previousCaptureSecret = process.env.AURA_CHANGELOG_CAPTURE_SECRET;
  process.env.ANTHROPIC_API_KEY = "test-key";
  process.env.BROWSER_USE_API_KEY = "browser-use-test-key";
  process.env.AURA_CHANGELOG_CAPTURE_SECRET = "capture-secret-with-enough-entropy";

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    async json() {
      return {
        content: [
          {
            type: "tool_use",
            name: "submit_changelog_media_plan",
            input: {
              candidates: [
                {
                  entryId: "entry-1",
                  title: "GPT-5.5 available in the chat model picker",
                  shouldCapture: true,
                  reason: "The model picker option is visible desktop UI.",
                  targetAppId: "agents",
                  targetPath: "/agents",
                  proofGoal: "Open the chat model picker and show GPT-5.5.",
                  publicCaption: "GPT-5.5 is now available directly from the chat model picker.",
                  confidence: 0.91,
                  changedFiles: ["interface/src/components/ChatInputBar/ChatInputBar.tsx"],
                },
              ],
              skipped: [],
            },
          },
        ],
      };
    },
  });

  try {
    const report = await runChangelogMediaEvaluation({
      changelogFile: changelogPath,
      outputDir: path.join(tempDir, "out"),
      baseUrl: "https://example.com",
      maxCandidates: 1,
      visionJudge: false,
      preflightCaptureAuthImpl: async () => ({ ok: true, concerns: [], loginStatus: 200, sessionStatus: 201 }),
      requestCaptureSessionImpl: async () => ({
        ok: true,
        sessionStatus: 201,
        concerns: [],
        session: {
          user_id: "capture-demo-user",
          display_name: "Aura Capture",
          primary_zid: "0://aura-capture",
          zero_wallet: "0x0000000000000000000000000000000000000000",
          wallets: [],
          is_zero_pro: true,
          is_access_granted: true,
          access_token: "aura-capture:test-token",
          created_at: "2026-04-24T00:00:00Z",
          validated_at: "2026-04-24T00:00:00Z",
        },
      }),
      runBrowserUseTaskImpl: async () => ({
        ok: true,
        provider: "browser-use-cloud",
        output: {
          shouldCapture: true,
          targetAppId: "agents",
          targetPath: "/agents",
          proofSurface: "chat model picker",
          proofVisible: true,
          visibleProof: ["GPT-5.5 is visible in the chat model picker."],
          screenshotDescription: "Aura desktop chat screen with the model picker open.",
          desktopLayoutVisible: true,
          mobileLayoutVisible: false,
          concerns: [],
        },
        screenshot: {
          path: screenshotPath,
          dimensions: { width: 1920, height: 1080 },
        },
        messages: [],
      }),
    });

    assert.equal(report.counts.captureAccepted, 1);
    assert.equal(report.counts.brandingCreated, 1);
    assert.equal(report.captureResults[0].visionGate.status, "skipped");
    assert.equal(report.captureResults[0].brandedVisionGate.status, "skipped");
    assert.equal(report.captureResults[0].publishReady, false);
    assert.equal(report.counts.publishReady, 0);
    assert.equal(report.counts.publishableMediaAssets, 0);
    assert.deepEqual(report.publishableMedia.assets, []);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousAnthropic === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = previousAnthropic;
    if (previousBrowserUse === undefined) delete process.env.BROWSER_USE_API_KEY;
    else process.env.BROWSER_USE_API_KEY = previousBrowserUse;
    if (previousCaptureSecret === undefined) delete process.env.AURA_CHANGELOG_CAPTURE_SECRET;
    else process.env.AURA_CHANGELOG_CAPTURE_SECRET = previousCaptureSecret;
  }
});
