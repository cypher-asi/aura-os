import assert from "node:assert/strict";
import test from "node:test";

import {
  buildMediaPlannerPrompt,
  extractChangelogMediaEntries,
  normalizeMediaPlan,
  parseAnthropicMediaPlanResponse,
  planChangelogMediaWithAnthropic,
  validateMediaPlanCoverage,
} from "./changelog-media-planner.mjs";

test("extractChangelogMediaEntries normalizes generated changelog entries", () => {
  const entries = extractChangelogMediaEntries({
    rendered: {
      entries: [
        {
          batch_id: "entry-1",
          title: "GPT-5.5 available in the chat model picker",
          summary: "Users can select GPT-5.5 from the chat composer.",
          items: [
            {
              text: "Model picker includes GPT-5.5.",
              commit_shas: ["abc123"],
              changed_files: ["interface/src/apps/agents/components/AgentChat/ChatInputBar.tsx"],
            },
          ],
        },
      ],
    },
  });

  assert.equal(entries.length, 1);
  assert.equal(entries[0].entryId, "entry-1");
  assert.equal(entries[0].changedFiles[0], "interface/src/apps/agents/components/AgentChat/ChatInputBar.tsx");
});

test("buildMediaPlannerPrompt keeps Browser Use behind a conservative Anthropic filter", () => {
  const prompt = buildMediaPlannerPrompt({
    changelogEntries: [{ entryId: "entry-1", title: "Add Android release metadata" }],
    sitemap: { apps: [{ id: "agents", path: "/agents" }] },
    commitLog: "abc123 Add Android release metadata",
    changedFiles: ["interface/android/app/src/main/AndroidManifest.xml"],
  });

  assert.match(prompt, /before any browser automation runs/);
  assert.match(prompt, /mobile-only/);
  assert.match(prompt, /Skip login, auth, sign-in/);
  assert.match(prompt, /targetAppId and targetPath from the sitemap/);
  assert.match(prompt, /Every changelog entry must appear exactly once/);
  assert.match(prompt, /mixes a visible desktop product feature/);
  assert.match(prompt, /default\/empty state/);
  assert.match(prompt, /Browser Use should receive fewer, better candidates/);
  assert.match(prompt, /publicCaption/);
  assert.doesNotMatch(prompt, /Browserbase|Stagehand|Playwright/);
});

test("normalizeMediaPlan keeps only high-confidence capture candidates and preserves coverage under the cap", () => {
  const plan = normalizeMediaPlan({
    candidates: [
      {
        entryId: "low",
        title: "Tiny ambiguous thing",
        shouldCapture: true,
        reason: "Maybe visible",
        targetAppId: "agents",
        targetPath: "/agents",
        proofGoal: "Maybe",
        confidence: 0.2,
      },
      {
        entryId: "strong",
        title: "GPT-5.5 available in model picker",
        shouldCapture: true,
        reason: "Visible model picker option",
        targetAppId: "agents",
        targetPath: "/agents",
        proofGoal: "Open chat model picker and show GPT-5.5",
        publicCaption: "GPT-5.5 is now available directly from the chat model picker.",
        confidence: 0.92,
        changedFiles: ["interface/src/apps/agents/components/AgentChat/ChatInputBar.tsx"],
      },
      {
        entryId: "second-strong",
        title: "Feedback board shows comments",
        shouldCapture: true,
        reason: "Visible feedback board comments",
        targetAppId: "feedback",
        targetPath: "/feedback",
        proofGoal: "Show the feedback board comments",
        confidence: 0.86,
        changedFiles: ["interface/src/apps/feedback/FeedbackApp.tsx"],
      },
      {
        entryId: "missing-target",
        title: "Login redesign",
        shouldCapture: true,
        reason: "Visible login screen redesign",
        targetAppId: null,
        targetPath: null,
        proofGoal: "Show the login redesign",
        publicCaption: "The sign-in screen has a refreshed layout.",
        confidence: 0.8,
        changedFiles: ["interface/src/pages/Login.tsx"],
      },
    ],
    skipped: [
      {
        entryId: "mobile",
        title: "Android update",
        reason: "Mobile-only",
        category: "mobile-only",
      },
    ],
  }, { maxCandidates: 1 });

  assert.equal(plan.candidates.length, 1);
  assert.equal(plan.candidates[0].entryId, "strong");
  assert.equal(plan.skipped[0].category, "mobile-only");
  assert.ok(plan.skipped.some((entry) => entry.entryId === "second-strong" && entry.category === "candidate-limit"));
  assert.ok(plan.skipped.some((entry) => entry.entryId === "low" && entry.category === "too-ambiguous"));
  assert.ok(plan.skipped.some((entry) => entry.entryId === "missing-target" && entry.reason.includes("sitemap-backed")));
});

test("validateMediaPlanCoverage catches planner omissions and duplicates", () => {
  const coverage = validateMediaPlanCoverage({
    candidates: [{ entryId: "entry-1" }],
    skipped: [{ entryId: "entry-1" }, { entryId: "entry-999" }],
  }, [
    { entryId: "entry-1" },
    { entryId: "entry-2" },
  ]);

  assert.equal(coverage.ok, false);
  assert.deepEqual(coverage.missing, ["entry-2"]);
  assert.deepEqual(coverage.duplicate, ["entry-1"]);
  assert.deepEqual(coverage.unknown, ["entry-999"]);
});

test("parseAnthropicMediaPlanResponse reads tool output", () => {
  const parsed = parseAnthropicMediaPlanResponse({
    content: [
      {
        type: "tool_use",
        name: "submit_changelog_media_plan",
        input: { candidates: [], skipped: [] },
      },
    ],
  });

  assert.deepEqual(parsed, { candidates: [], skipped: [] });
});

test("planChangelogMediaWithAnthropic retries when coverage misses an entry", async () => {
  const requestBodies = [];
  const result = await planChangelogMediaWithAnthropic({
    apiKey: "test-key",
    model: "claude-opus-4-7",
    changelogEntries: [
      { entryId: "entry-1", title: "Feedback board" },
      { entryId: "entry-2", title: "Backend fix" },
    ],
    sitemap: { apps: [{ id: "feedback", path: "/feedback" }] },
    fetchImpl: async (_url, options) => {
      requestBodies.push(JSON.parse(options.body));
      const isRetry = requestBodies.length > 1;
      return {
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
                      title: "Feedback board",
                      shouldCapture: true,
                      reason: "Visible feedback board",
                      targetAppId: "feedback",
                      targetPath: "/feedback",
                      proofGoal: "Show the feedback board",
                      publicCaption: "Feedback discussions are easier to review on the board.",
                      confidence: 0.86,
                      changedFiles: ["interface/src/apps/feedback/FeedbackApp.tsx"],
                    },
                  ],
                  skipped: isRetry
                    ? [
                      {
                        entryId: "entry-2",
                        title: "Backend fix",
                        reason: "Backend-only change.",
                        category: "backend-only",
                      },
                    ]
                    : [],
                },
              },
            ],
          };
        },
      };
    },
  });

  assert.equal(requestBodies.length, 2);
  assert.equal(requestBodies[0].model, "claude-opus-4-7");
  assert.equal(requestBodies[0].tool_choice.name, "submit_changelog_media_plan");
  assert.match(requestBodies[1].messages[0].content, /Missing entry IDs: entry-2/);
  assert.equal(result.coverage.ok, true);
  assert.equal(result.plan.candidates[0].targetAppId, "feedback");
});

test("planChangelogMediaWithAnthropic chunks large entry sets and aggregates coverage", async () => {
  const requestBodies = [];
  const entries = Array.from({ length: 45 }, (_value, index) => ({
    entryId: `entry-${index + 1}`,
    title: index === 0 ? "GPT-5.5 model picker" : `Infra update ${index + 1}`,
    changedFiles: index === 0
      ? ["interface/src/apps/agents/components/AgentChat/ChatInputBar.tsx"]
      : [".github/workflows/release-nightly.yml"],
  }));

  const result = await planChangelogMediaWithAnthropic({
    apiKey: "test-key",
    model: "claude-opus-4-7",
    changelogEntries: entries,
    sitemap: { apps: [{ id: "agents", path: "/agents" }] },
    maxCandidates: 3,
    entryChunkSize: 20,
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      requestBodies.push(body);
      const prompt = body.messages[0].content;
      const ids = [...prompt.matchAll(/"entryId": "([^"]+)"/g)].map((match) => match[1]);
      return {
        ok: true,
        async json() {
          return {
            content: [
              {
                type: "tool_use",
                name: "submit_changelog_media_plan",
                input: {
                  candidates: ids.includes("entry-1")
                    ? [
                      {
                        entryId: "entry-1",
                        title: "GPT-5.5 model picker",
                        shouldCapture: true,
                        reason: "Visible model picker option",
                        targetAppId: "agents",
                        targetPath: "/agents",
                        proofGoal: "Show GPT-5.5 in the model picker",
                        publicCaption: "GPT-5.5 is now available directly from the chat model picker.",
                        confidence: 0.92,
                        changedFiles: ["interface/src/apps/agents/components/AgentChat/ChatInputBar.tsx"],
                      },
                    ]
                    : [],
                  skipped: ids
                    .filter((id) => id !== "entry-1")
                    .map((id) => ({
                      entryId: id,
                      title: `Infra update ${id}`,
                      reason: "Infra-only change.",
                      category: "infra-only",
                    })),
                },
              },
            ],
          };
        },
      };
    },
  });

  assert.equal(requestBodies.length, 3);
  assert.equal(result.coverage.ok, true);
  assert.equal(result.coverage.expectedCount, 45);
  assert.equal(result.plan.candidates.length, 1);
  assert.equal(result.plan.skipped.length, 44);
});

test("planChangelogMediaWithAnthropic safely skips entries omitted after retries", async () => {
  const result = await planChangelogMediaWithAnthropic({
    apiKey: "test-key",
    model: "claude-opus-4-7",
    changelogEntries: [
      { entryId: "entry-1", title: "Visible product update" },
      { entryId: "entry-2", title: "Unclassified update" },
    ],
    sitemap: { apps: [{ id: "agents", path: "/agents" }] },
    fetchImpl: async () => ({
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
                    title: "Visible product update",
                    shouldCapture: true,
                    reason: "Visible desktop UI.",
                    targetAppId: "agents",
                    targetPath: "/agents",
                    proofGoal: "Show the visible update.",
                    publicCaption: "The visible product update is now available in Aura.",
                    confidence: 0.9,
                    changedFiles: ["interface/src/apps/agents/AgentApp.tsx"],
                  },
                ],
                skipped: [],
              },
            },
          ],
        };
      },
    }),
  });

  assert.equal(result.coverage.ok, true);
  assert.equal(result.forcedSkipped.length, 1);
  assert.equal(result.forcedSkipped[0].entryId, "entry-2");
  assert.equal(result.plan.skipped.some((entry) => entry.entryId === "entry-2"), true);
});

test("planChangelogMediaWithAnthropic rescues omitted entries with a focused follow-up pass", async () => {
  let calls = 0;
  const result = await planChangelogMediaWithAnthropic({
    apiKey: "test-key",
    model: "claude-opus-4-7",
    changelogEntries: [
      { entryId: "entry-1", title: "Visible product update" },
      { entryId: "entry-2", title: "GPT-5.5 model support" },
    ],
    sitemap: { apps: [{ id: "agents", path: "/agents" }] },
    fetchImpl: async (_url, options) => {
      calls += 1;
      const isRescue = JSON.parse(options.body).messages[0].content.includes("Planning chunk: rescue");
      return {
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
                      entryId: isRescue ? "entry-2" : "entry-1",
                      title: isRescue ? "GPT-5.5 model support" : "Visible product update",
                      shouldCapture: true,
                      reason: "Visible desktop UI.",
                      targetAppId: "agents",
                      targetPath: "/agents",
                      proofGoal: isRescue ? "Show GPT-5.5 in the model picker." : "Show the visible update.",
                      publicCaption: isRescue
                        ? "GPT-5.5 is now available directly from the chat model picker."
                        : "The visible product update is now available in Aura.",
                      confidence: 0.9,
                      changedFiles: ["interface/src/apps/agents/AgentApp.tsx"],
                    },
                  ],
                  skipped: [],
                },
              },
            ],
          };
        },
      };
    },
  });

  assert.equal(calls, 3);
  assert.equal(result.coverage.ok, true);
  assert.equal(result.forcedSkipped.length, 0);
  assert.deepEqual(result.plan.candidates.map((candidate) => candidate.entryId).sort(), ["entry-1", "entry-2"]);
});
