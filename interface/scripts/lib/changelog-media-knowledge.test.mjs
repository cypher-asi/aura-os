import assert from "node:assert/strict";
import test from "node:test";

import {
  loadChangelogMediaKnowledge,
  summarizeChangelogMediaKnowledge,
} from "./changelog-media-knowledge.mjs";

test("loadChangelogMediaKnowledge returns only promoted curated lessons by default", () => {
  const knowledge = loadChangelogMediaKnowledge();

  assert.equal(knowledge.schemaVersion, 1);
  assert.ok(knowledge.curationPolicy.some((policy) => /reusable lessons only/i.test(policy)));
  assert.ok(knowledge.lessons.length >= 2);
  assert.ok(knowledge.lessons.every((lesson) => lesson.status === "promoted"));
  assert.ok(knowledge.lessons.some((lesson) => lesson.id === "agents-chat-model-picker"));
  assert.ok(knowledge.lessons.some((lesson) => lesson.id === "empty-state-media-rejection"));
  assert.ok(knowledge.lessons.every((lesson) => !JSON.stringify(lesson).includes("data:image")));
});

test("summarizeChangelogMediaKnowledge gives the planner reusable inference and seed hints", () => {
  const summary = summarizeChangelogMediaKnowledge(loadChangelogMediaKnowledge());

  assert.match(summary, /Curated changelog media lessons/);
  assert.match(summary, /agents\.chat\.model_picker/);
  assert.match(summary, /model-picker-open/);
  assert.match(summary, /aura3d\.image_to_model_viewer/);
  assert.match(summary, /proof-data-populated/);
  assert.doesNotMatch(summary, /Browserbase|Stagehand|Playwright/);
});

