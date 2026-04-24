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
  assert.match(prompt, /Skip mobile-only/);
  assert.match(prompt, /Every changelog entry must appear exactly once/);
  assert.match(prompt, /mixes a visible desktop product feature/);
  assert.match(prompt, /Browser Use should receive fewer, better candidates/);
  assert.doesNotMatch(prompt, /Browserbase|Stagehand|Playwright/);
});

test("normalizeMediaPlan keeps only high-confidence capture candidates", () => {
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
        confidence: 0.92,
        changedFiles: ["interface/src/apps/agents/components/AgentChat/ChatInputBar.tsx"],
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
  });

  assert.equal(plan.candidates.length, 1);
  assert.equal(plan.candidates[0].entryId, "strong");
  assert.equal(plan.skipped[0].category, "mobile-only");
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
