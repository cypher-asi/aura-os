import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  annotateRenderedEntriesWithMedia,
  assertStrictToolModelSupport,
  batchCommits,
  buildMediaPlaceholderBlock,
  buildAnthropicRequestBody,
  preserveExistingPublishedMedia,
  validateRenderedEntry,
} from "./generate-daily-changelog.mjs";

const fixturesDir = path.join(import.meta.dirname, "fixtures");

function readFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(fixturesDir, name), "utf8"));
}

function buildFixtureBatches() {
  return batchCommits(readFixture("changelog-commits.json"), "America/Los_Angeles");
}

test("batchCommits groups the fixture history into stable Pacific-time sections", () => {
  const batches = buildFixtureBatches();

  assert.equal(batches.length, 4);
  assert.deepEqual(
    batches.map((batch) => batch.id),
    ["entry-1", "entry-2", "entry-3", "entry-4"],
  );
  assert.deepEqual(
    batches.map((batch) => batch.time_label),
    ["12:00 AM", "3:50 AM", "9:10 AM", "3:00 PM"],
  );
  assert.deepEqual(
    batches.map((batch) => batch.commits.length),
    [2, 2, 1, 1],
  );
});

test("validateRenderedEntry accepts the publication-ready fixture draft", () => {
  const batches = buildFixtureBatches();
  const candidate = readFixture("changelog-good-candidate.json");

  const rendered = validateRenderedEntry(candidate, batches, 6);

  assert.equal(rendered.entries.length, 4);
  assert.equal(rendered.highlights.length, 4);
  assert.equal(rendered.entries[0].time_label, "12:00 AM");
  assert.equal(rendered.entries[1].items.length, 2);
});

test("validateRenderedEntry accepts a structurally valid generic draft", () => {
  const batches = buildFixtureBatches();
  const candidate = readFixture("changelog-bad-generic-candidate.json");

  const rendered = validateRenderedEntry(candidate, batches, 6);

  assert.equal(rendered.entries.length, candidate.entries.length);
  assert.equal(rendered.highlights.length, candidate.highlights.length);
});

test("validateRenderedEntry rejects entries that reference unknown batches", () => {
  const batches = buildFixtureBatches();
  const candidate = readFixture("changelog-good-candidate.json");
  candidate.entries[0].batch_id = "entry-999";

  assert.throws(
    () => validateRenderedEntry(candidate, batches, 6),
    /entry\.batch_id must reference a known batch/,
  );
});

test("validateRenderedEntry rejects bullets without valid SHAs from the batch", () => {
  const batches = buildFixtureBatches();
  const candidate = readFixture("changelog-good-candidate.json");
  candidate.entries[0].items[0].commit_shas = ["not-a-real-sha"];

  assert.throws(
    () => validateRenderedEntry(candidate, batches, 6),
    /entry item must cite at least one SHA from batch entry-1/,
  );
});

test("validateRenderedEntry rejects duplicate batch entries", () => {
  const batches = buildFixtureBatches();
  const candidate = readFixture("changelog-good-candidate.json");
  candidate.entries[1].batch_id = candidate.entries[0].batch_id;

  assert.throws(
    () => validateRenderedEntry(candidate, batches, 6),
    /entry\.batch_id must be unique/,
  );
});

test("assertStrictToolModelSupport warns instead of failing for non-allowlisted models", () => {
  assert.equal(assertStrictToolModelSupport("claude-sonnet-4-20250514"), false);
});

test("buildAnthropicRequestBody omits deprecated temperature and preserves tool mode", () => {
  const request = buildAnthropicRequestBody({
    model: "claude-sonnet-4-6",
    maxTokens: 4096,
    systemPrompt: "system prompt",
    tool: { name: "submit_daily_changelog", input_schema: { type: "object" } },
    userPrompt: "user prompt",
    retryInstruction: null,
  });

  assert.equal(request.model, "claude-sonnet-4-6");
  assert.equal(request.max_tokens, 4096);
  assert.equal(request.tool_choice.type, "any");
  assert.equal(request.messages.length, 1);
  assert.equal(request.messages[0].content, "user prompt");
  assert.equal("temperature" in request, false);
});

test("buildAnthropicRequestBody includes retry guidance when requested", () => {
  const request = buildAnthropicRequestBody({
    model: "claude-sonnet-4-6",
    maxTokens: 6144,
    systemPrompt: "system prompt",
    tool: { name: "submit_daily_changelog", input_schema: { type: "object" } },
    userPrompt: "user prompt",
    retryInstruction: "validation failed",
  });

  assert.match(request.messages[0].content, /validation failed/);
  assert.match(request.messages[0].content, /Call the tool again with corrected input\./);
  assert.equal("temperature" in request, false);
});

test("assertStrictToolModelSupport accepts Claude Opus 4.7", () => {
  assert.equal(assertStrictToolModelSupport("claude-opus-4-7"), true);
});

test("annotateRenderedEntriesWithMedia requests placeholders for UI-facing entries", () => {
  const rendered = {
    title: "Demo day",
    intro: "Intro",
    highlights: [],
    entries: [
      {
        batch_id: "entry-1",
        time_label: "9:10 AM",
        title: "Feedback board and comments stay visible",
        summary: "The feedback board now keeps discussion visible while triaging ideas.",
        items: [
          {
            text: "Comments remain visible next to the feedback board.",
            commit_shas: ["abc1234"],
          },
        ],
      },
      {
        batch_id: "entry-2",
        time_label: "11:30 AM",
        title: "Release packaging reliability improvements",
        summary: "The release workflow handles packaging retries more safely.",
        items: [
          {
            text: "Packaging retries no longer fail on stale artifacts.",
            commit_shas: ["def5678"],
          },
        ],
      },
      {
        batch_id: "entry-3",
        time_label: "2:15 PM",
        title: "Desktop chat shows more useful failures",
        summary: "The desktop chat screen now makes failure states easier to understand.",
        items: [
          {
            text: "Visible error handling is clearer in the desktop chat window.",
            commit_shas: ["9876abc"],
          },
        ],
      },
    ],
  };

  const rawCommits = [
    { sha: "abc1234", files: ["interface/src/apps/feedback/FeedbackMainPanel.tsx"] },
    { sha: "def5678", files: [".github/workflows/release-nightly.yml"] },
    { sha: "9876abc", files: ["apps/aura-os-desktop/src/chat/errors.ts"] },
  ];

  const annotated = annotateRenderedEntriesWithMedia(rendered, rawCommits);

  assert.equal(annotated.entries[0].media.requested, true);
  assert.equal(annotated.entries[0].media.status, "pending");
  assert.equal(annotated.entries[1].media.requested, false);
  assert.equal(annotated.entries[1].media.status, "skipped");
  assert.equal(annotated.entries[2].media.requested, true);
  assert.equal(annotated.entries[2].media.status, "pending");
});

test("annotateRenderedEntriesWithMedia skips runtime config entries without a clear screen target", () => {
  const rendered = {
    title: "Demo day",
    intro: "Intro",
    highlights: [],
    entries: [
      {
        batch_id: "entry-1",
        time_label: "4:45 PM",
        title: "External harness flag surfaced in desktop runtime config",
        summary: "The desktop runtime config now exposes AURA_DESKTOP_EXTERNAL_HARNESS so the UI can tell whether an external harness is in use.",
        items: [
          {
            text: "Desktop runtime config exposes the external harness flag without reading env directly.",
            commit_shas: ["abc1234"],
          },
        ],
      },
    ],
  };

  const rawCommits = [
    { sha: "abc1234", files: ["apps/aura-os-desktop/src/handlers.rs"] },
  ];

  const annotated = annotateRenderedEntriesWithMedia(rendered, rawCommits);

  assert.equal(annotated.entries[0].media.requested, false);
  assert.equal(annotated.entries[0].media.status, "skipped");
});

test("annotateRenderedEntriesWithMedia skips backend-heavy mixed batches without a dominant UI story", () => {
  const rendered = {
    title: "Demo day",
    intro: "Intro",
    highlights: [],
    entries: [
      {
        batch_id: "entry-1",
        time_label: "5:10 PM",
        title: "Autonomous recovery pipeline for truncated dev-loop runs",
        summary: "A full multi-phase pipeline now classifies truncation failures, decomposes oversized tasks, and streams heuristic findings live during a run.",
        items: [
          {
            text: "The Debug app gained a tabbed sidekick, but most of the landing centered on backend recovery and heuristic plumbing.",
            commit_shas: ["abc1234", "def5678"],
          },
        ],
      },
    ],
  };

  const rawCommits = [
    {
      sha: "abc1234",
      files: [
        "apps/aura-os-server/src/handlers/dev_loop.rs",
        "apps/aura-os-server/src/handlers/live_heuristics.rs",
        "crates/aura-run-heuristics/src/lib.rs",
        "crates/aura-run-heuristics/src/rules/high_retry_density.rs",
        "crates/aura-os-core/src/entities.rs",
        "interface/src/apps/debug/DebugSidekick.tsx",
      ],
    },
    {
      sha: "def5678",
      files: [
        "apps/aura-os-server/src/handlers/tasks.rs",
        "apps/aura-run-analyze/src/render.rs",
        "crates/aura-os-storage/src/conversions.rs",
        "crates/aura-os-tasks/tests/state_machine.rs",
      ],
    },
  ];

  const annotated = annotateRenderedEntriesWithMedia(rendered, rawCommits);

  assert.equal(annotated.entries[0].media.requested, false);
  assert.equal(annotated.entries[0].media.status, "skipped");
});

test("buildMediaPlaceholderBlock emits hidden markers only for requested slots", () => {
  const placeholderLines = buildMediaPlaceholderBlock({
    batch_id: "entry-1",
    title: "Feedback board and comments stay visible",
    media: {
      requested: true,
      slotId: "entry-1-feedback-board-and-comments-stay-visible",
      slug: "feedback-board-and-comments-stay-visible",
      alt: "Feedback board screenshot",
    },
  });

  assert.equal(placeholderLines.length > 0, true);
  assert.match(placeholderLines[0], /AURA_CHANGELOG_MEDIA:BEGIN/);
  assert.match(placeholderLines[1], /AURA_CHANGELOG_MEDIA:PENDING/);
  assert.match(placeholderLines[2], /AURA_CHANGELOG_MEDIA:END/);

  assert.deepEqual(
    buildMediaPlaceholderBlock({
      batch_id: "entry-2",
      title: "Release packaging reliability improvements",
      media: { requested: false },
    }),
    [],
  );
});

test("buildMediaPlaceholderBlock keeps published media visible when rerendering markdown", () => {
  const placeholderLines = buildMediaPlaceholderBlock(
    {
      batch_id: "entry-1",
      title: "Feedback board and comments stay visible",
      media: {
        requested: true,
        status: "published",
        slotId: "entry-1-feedback-board",
        slug: "feedback-board",
        alt: "Feedback board screenshot",
        assetPath: "assets/changelog/nightly/0.1.0-nightly.321.1/entry-1-feedback-board.png",
      },
    },
    {
      pagesDir: "/tmp/aura-pages",
      markdownPath: "/tmp/aura-pages/changelog/nightly/latest.md",
    },
  );

  assert.match(placeholderLines[0], /"status":"published"/);
  assert.match(placeholderLines[1], /!\[Feedback board screenshot\]\(\.\.\/\.\.\/assets\/changelog\/nightly\/0\.1\.0-nightly\.321\.1\/entry-1-feedback-board\.png\)/);
});

test("preserveExistingPublishedMedia prevents rerenders from downgrading existing screenshots", () => {
  const rendered = {
    entries: [
      {
        batch_id: "entry-1",
        title: "Feedback board and comments stay visible",
        media: {
          requested: true,
          status: "pending",
          slotId: "entry-1-feedback-board-and-comments-stay-visible",
          slug: "feedback-board-and-comments-stay-visible",
          alt: "New feedback screenshot",
        },
      },
    ],
  };
  const existingDoc = {
    rendered: {
      entries: [
        {
          batch_id: "entry-1",
          title: "Feedback board",
          items: [
            {
              text: "Feedback board ships.",
              commit_shas: ["abc1234"],
            },
          ],
          media: {
            requested: true,
            status: "published",
            slotId: "entry-1-feedback-board",
            slug: "feedback-board",
            alt: "Feedback board screenshot",
            assetPath: "assets/changelog/nightly/0.1.0-nightly.321.1/entry-1-feedback-board.png",
            screenshotSource: "capture-proof",
            updatedAt: "2026-04-22T10:00:00.000Z",
            storyTitle: "Feedback board proof",
          },
        },
      ],
    },
  };

  const preserved = preserveExistingPublishedMedia(rendered, [existingDoc]);
  assert.equal(preserved.entries[0].media.status, "published");
  assert.equal(preserved.entries[0].media.slotId, "entry-1-feedback-board");
  assert.equal(preserved.entries[0].media.assetPath, "assets/changelog/nightly/0.1.0-nightly.321.1/entry-1-feedback-board.png");
  assert.equal(preserved.entries[0].media.preservedFromSlotId, "entry-1-feedback-board");
});

test("preserveExistingPublishedMedia does not carry batch media to unrelated regenerated entries", () => {
  const rendered = {
    entries: [
      {
        batch_id: "entry-1",
        title: "Model picker gains provider filters",
        items: [
          {
            text: "Provider filters are visible.",
            commit_shas: ["new1234"],
          },
        ],
        media: {
          requested: true,
          status: "pending",
          slotId: "entry-1-model-picker-gains-provider-filters",
          slug: "model-picker-gains-provider-filters",
          alt: "Model picker screenshot",
        },
      },
    ],
  };
  const existingDoc = {
    rendered: {
      entries: [
        {
          batch_id: "entry-1",
          title: "Feedback board",
          items: [
            {
              text: "Feedback board ships.",
              commit_shas: ["abc1234"],
            },
          ],
          media: {
            requested: true,
            status: "published",
            slotId: "entry-1-feedback-board",
            slug: "feedback-board",
            alt: "Feedback board screenshot",
            assetPath: "assets/changelog/nightly/0.1.0-nightly.321.1/entry-1-feedback-board.png",
          },
        },
      ],
    },
  };

  const preserved = preserveExistingPublishedMedia(rendered, [existingDoc]);
  assert.equal(preserved.entries[0].media.status, "pending");
  assert.equal(preserved.entries[0].media.slotId, "entry-1-model-picker-gains-provider-filters");
  assert.equal(preserved.entries[0].media.assetPath, undefined);
});
