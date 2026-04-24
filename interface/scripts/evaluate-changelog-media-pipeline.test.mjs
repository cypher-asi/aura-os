import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { PNG } from "pngjs";

import {
  preflightCaptureAuth,
  runChangelogMediaEvaluation,
} from "./evaluate-changelog-media-pipeline.mjs";

function fakeResponse({ status, headers = {}, body = "" }) {
  return {
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
    assert.match(report.captureResults[0].blockers[0], /BROWSER_USE_API_KEY/);
    assert.equal(fs.existsSync(path.join(tempDir, "out", "evaluation-report.json")), true);
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
  writeStructuredPng(screenshotPath, 1400, 800);

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
          dimensions: { width: 1400, height: 800 },
        },
        messages: [],
      }),
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
    assert.equal(report.counts.publishReady, 1);
    const branding = report.captureResults[0].branding;
    assert.equal(branding.status, "created");
    assert.equal(fs.existsSync(branding.asset.path), true);
    assert.equal(branding.asset.embeddedScreenshot.scale, 1);
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
