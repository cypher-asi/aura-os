import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { buildDemoAgentBrief, sanitizeVisibleProofPhrases } from "./demo-agent-brief.mjs";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(MODULE_DIR, "../../..");

test("buildDemoAgentBrief chooses feedback from a feedback story without Anthropic", async () => {
  const previous = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;

  const brief = await buildDemoAgentBrief({
    prompt: "Open the feedback app, add a new idea, and leave the thread visible.",
  });

  assert.equal(brief.generator, "fallback");
  assert.equal(brief.targetAppId, "feedback");
  assert.match(brief.openAppInstruction, /Feedback/i);
  assert.match(brief.openAppInstruction, /visible controls only/i);
  assert.match(brief.systemPrompt, /direct URL navigation/i);
  assert.equal(brief.desktopOnly, true);
  assert.ok(Array.isArray(brief.setupPlan));
  assert.ok(Array.isArray(brief.validationSignals));

  if (previous) {
    process.env.ANTHROPIC_API_KEY = previous;
  }
});

test("buildDemoAgentBrief adds thread-specific proof rules for feedback comment stories", async () => {
  const previous = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;

  const brief = await buildDemoAgentBrief({
    prompt: "Open the feedback app, leave the comments visible, and show the feedback thread.",
  });

  assert.equal(brief.targetAppId, "feedback");
  assert.ok(brief.requiredUiSignals.includes("feedbackThreadVisible"));
  assert.equal(brief.proofRequirements.length, 0);
  assert.ok(brief.forbiddenPhrases.includes("Select a feedback item to view comments"));

  if (previous) {
    process.env.ANTHROPIC_API_KEY = previous;
  }
});

test("buildDemoAgentBrief uses changed file evidence to infer an agent skills surface", async () => {
  const previous = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;

  const brief = await buildDemoAgentBrief({
    prompt: "Add skills to your agent.",
    changedFiles: [
      "interface/src/apps/agents/AgentInfoPanel/SkillsTab.tsx",
      "interface/src/api/harness-skills.ts",
    ],
  });

  assert.equal(brief.generator, "fallback");
  assert.equal(brief.targetAppId, "agents");
  assert.match(brief.proofInstruction, /Skills/i);
  assert.ok(brief.setupPlan.some((entry) => /Skills|tab/i.test(entry)));
  assert.ok(brief.validationSignals.some((entry) => /Skills|Skill Shop|Installed|Available/i.test(entry)));
  assert.ok(brief.proofRequirements.some((entry) =>
    entry.anyOf.some((signal) => /Skill Shop|Installed|Available/i.test(signal))
  ));

  if (previous) {
    process.env.ANTHROPIC_API_KEY = previous;
  }
});

test("buildDemoAgentBrief uses changed file evidence to infer an integrations provider surface", async () => {
  const previous = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;

  const brief = await buildDemoAgentBrief({
    prompt: "Added new models.",
    changedFiles: [
      "interface/src/apps/integrations/integration-groups.ts",
      "interface/src/apps/integrations/IntegrationsNav/IntegrationsNav.tsx",
      "interface/src/constants/models.ts",
    ],
  });

  assert.equal(brief.generator, "fallback");
  assert.equal(brief.targetAppId, "integrations");
  assert.match(brief.proofInstruction, /providers|models/i);
  assert.match(brief.rationale, /changed-file evidence/i);
  assert.equal(brief.desktopOnly, true);
  assert.match(brief.validationInstruction, /mobile mode/i);

  if (previous) {
    process.env.ANTHROPIC_API_KEY = previous;
  }
});

test("buildDemoAgentBrief adds grounded model-picker proof rules for named model stories", async () => {
  const previous = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;

  const brief = await buildDemoAgentBrief({
    prompt: "GPT-5.5 is now available from the chat input model picker.",
    changedFiles: [
      "interface/src/components/ChatInputBar/ChatInputBar.tsx",
      "interface/src/constants/models.ts",
    ],
  });

  assert.equal(brief.generator, "fallback");
  assert.equal(brief.targetAppId, "agents");
  assert.ok(brief.validationSignals.includes("GPT-5.5"));
  assert.ok(brief.proofRequirements.some((entry) => entry.anyOf.includes("GPT-5.5")));
  assert.ok(brief.requiredUiSignals.includes("chatComposerVisible"));
  assert.ok(brief.requiredUiSignals.includes("modelPickerVisible"));
  assert.equal(brief.navigationContract.primarySurface, "chat input model picker");
  assert.equal(brief.navigationContract.captureMode, "contextual-proof");
  assert.ok(brief.navigationContract.expectedVisibleLabels.includes("GPT-5.5"));
  assert.ok(brief.matchedNavigationLessons.some((lesson) => lesson.id === "chat-model-picker-visible-option"));
  assert.equal(brief.matchedNavigationLessons.some((lesson) => lesson.id === "agent-skills-tab-proof"), false);
  assert.match(brief.proofInstruction, /Navigation contract/i);

  if (previous) {
    process.env.ANTHROPIC_API_KEY = previous;
  }
});

test("buildDemoAgentBrief loads runtime navigation lessons from persistent media memory", async () => {
  const previousKey = process.env.ANTHROPIC_API_KEY;
  const previousLessonsPath = process.env.AURA_DEMO_NAVIGATION_LESSONS_PATH;
  delete process.env.ANTHROPIC_API_KEY;

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-navigation-lessons-"));
  const lessonsPath = path.join(tempDir, "navigation-lessons.json");
  fs.writeFileSync(lessonsPath, `${JSON.stringify({
    schemaVersion: 1,
    lessons: [
      {
        id: "auto-billing-settings-proof",
        description: "Billing identity changes should show the Team Settings billing panel.",
        match: {
          keywords: ["zerobillingmemory", "billing", "identity"],
          changedFileGlobs: ["interface/src/components/OrgSettingsBilling/**"],
        },
        navigation: {
          targetAppId: "settings",
          surface: "team settings billing panel",
          requiredUiSignals: [],
          steps: ["Open Settings.", "Open Team Settings.", "Show the billing panel."],
          forbiddenPhrases: ["Free plan mismatch"],
          captureMode: "surface-proof",
        },
      },
    ],
  }, null, 2)}\n`);
  process.env.AURA_DEMO_NAVIGATION_LESSONS_PATH = lessonsPath;

  try {
    const brief = await buildDemoAgentBrief({
      prompt: "zerobillingmemory billing identity is now locked to the account.",
      changedFiles: ["interface/src/components/OrgSettingsBilling/OrgSettingsBilling.tsx"],
    });

    assert.ok(brief.matchedNavigationLessons.some((lesson) => lesson.id === "auto-billing-settings-proof"));
    assert.equal(brief.navigationContract.primarySurface, "team settings billing panel");
    assert.ok(brief.navigationContract.navigationSteps.some((step) => /billing panel/i.test(step)));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
    if (previousKey) {
      process.env.ANTHROPIC_API_KEY = previousKey;
    } else {
      delete process.env.ANTHROPIC_API_KEY;
    }
    if (previousLessonsPath) {
      process.env.AURA_DEMO_NAVIGATION_LESSONS_PATH = previousLessonsPath;
    } else {
      delete process.env.AURA_DEMO_NAVIGATION_LESSONS_PATH;
    }
  }
});

test("buildDemoAgentBrief adds created-agent proof signals for agent creation stories", async () => {
  const previous = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;

  const brief = await buildDemoAgentBrief({
    prompt: "Create a new agent in the Agents app and leave it selected.",
  });

  assert.equal(brief.targetAppId, "agents");
  assert.ok(brief.validationSignals.includes("AtlasDemoAgent"));
  assert.ok(brief.validationSignals.some((entry) => /is ready/i.test(entry)));
  assert.ok(brief.proofRequirements.some((entry) => entry.anyOf.includes("AtlasDemoAgent")));
  assert.ok(brief.proofRequirements.some((entry) => entry.anyOf.includes("is ready")));

  if (previous) {
    process.env.ANTHROPIC_API_KEY = previous;
  }
});

test("buildDemoAgentBrief adds modal-specific proof rules for deleting a skill", async () => {
  const previous = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;

  const brief = await buildDemoAgentBrief({
    prompt: "Open the delete skill modal in the Skills tab and keep the confirmation dialog visible.",
    changedFiles: [
      "interface/src/apps/agents/AgentInfoPanel/SkillsTab.tsx",
    ],
  });

  assert.equal(brief.targetAppId, "agents");
  assert.ok(brief.proofRequirements.some((entry) => entry.anyOf.includes("Delete skill")));
  assert.ok(brief.proofRequirements.some((entry) => entry.anyOf.includes("Cancel")));
  assert.ok(brief.setupPlan.some((entry) => /create exactly one demo skill/i.test(entry)));
  assert.ok(brief.interactionInstruction.includes("Delete skill confirmation dialog"));
  assert.ok(brief.forbiddenPhrases.includes("No skills yet"));
  assert.equal(brief.navigationContract.primarySurface, "agent skills tab");
  assert.ok(brief.matchedNavigationLessons.some((lesson) => lesson.id === "agent-skills-tab-proof"));

  if (previous) {
    process.env.ANTHROPIC_API_KEY = previous;
  }
});

test("sanitizeVisibleProofPhrases drops implementation-only proof hints", () => {
  const sanitized = sanitizeVisibleProofPhrases([
    "Tasks",
    "Completed Task Output",
    "use task output view",
    "task output panel store",
    "task stream bootstrap",
    "AtlasDemoAgent",
    "is ready",
    "interface/src/stores/task-turn-cache.ts",
    "Tasks app main panel is visible and stable",
  ], 12);

  assert.deepEqual(sanitized, [
    "Tasks",
    "Completed Task Output",
    "AtlasDemoAgent",
    "is ready",
  ]);
});

test("buildDemoAgentBrief filters implementation-only validation hints from changelog-style task stories", async () => {
  const previous = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;

  const brief = await buildDemoAgentBrief({
    prompt: "Completed task output survives remounts and reloads.",
    changedFiles: [
      "interface/src/components/TaskOutputPanel/CompletedTaskOutput.tsx",
      "interface/src/hooks/use-task-output-view.ts",
      "interface/src/stores/task-output-panel-store.ts",
      "interface/src/stores/task-stream-bootstrap.ts",
      "interface/src/stores/task-turn-cache.ts",
    ],
  });

  assert.equal(brief.targetAppId, "projects");
  assert.ok(brief.validationSignals.includes("Projects"));
  assert.ok(brief.validationSignals.some((entry) => /Completed Task Output|Task Output Section/i.test(entry)));
  assert.ok(!brief.validationSignals.some((entry) => /use task output view/i.test(entry)));
  assert.ok(!brief.validationSignals.some((entry) => /task output panel store/i.test(entry)));
  assert.ok(!brief.validationSignals.some((entry) => /task stream bootstrap/i.test(entry)));
  assert.ok(!brief.validationSignals.some((entry) => /task turn cache/i.test(entry)));
  assert.match(brief.validationInstruction, /empty state or selection prompt does not count as proof/i);

  if (previous) {
    process.env.ANTHROPIC_API_KEY = previous;
  }
});

test("buildDemoAgentBrief requires process run output proof for output-block stories", async () => {
  const previous = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;

  const brief = await buildDemoAgentBrief({
    prompt: "Run event timeline rows and task live/build output blocks now use the standard border token.",
    changedFiles: [
      "interface/src/apps/process/components/ProcessSidekickContent/EventTimelineItem.tsx",
      "interface/src/apps/process/components/ProcessEventOutput/ProcessEventOutput.tsx",
    ],
  });

  assert.equal(brief.generator, "fallback");
  assert.equal(brief.targetAppId, "process");
  assert.ok(brief.requiredUiSignals.includes("sidekickVisible"));
  assert.ok(brief.proofRequirements.some((entry) => entry.anyOf.includes("Node Events")));
  assert.ok(brief.proofRequirements.some((entry) => entry.anyOf.includes("Completed Task Output")));
  assert.ok(brief.forbiddenPhrases.includes("No output persisted for this node"));
  assert.equal(brief.navigationContract.primarySurface, "process run detail sidekick");
  assert.ok(brief.navigationContract.navigationSteps.some((entry) => /run detail|node events|output sidekick/i.test(entry)));
  assert.ok(brief.matchedNavigationLessons.some((lesson) => lesson.id === "process-run-output-sidekick"));

  if (previous) {
    process.env.ANTHROPIC_API_KEY = previous;
  }
});

test("buildDemoAgentBrief keeps deterministic proof rules when Anthropic omits them", async () => {
  const previousKey = process.env.ANTHROPIC_API_KEY;
  const previousFetch = global.fetch;
  process.env.ANTHROPIC_API_KEY = "test-key";

  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      content: [{
        type: "text",
        text: JSON.stringify({
          title: "Process output borders",
          story: "Run event timeline rows and task live/build output blocks now use the standard border token.",
          targetAppId: "process",
          confidence: "high",
          validationSignals: ["Demo Process", "Process"],
          proofRequirements: [],
          requiredUiSignals: [],
          forbiddenPhrases: [],
          desktopOnly: true,
        }),
      }],
    }),
  });

  try {
    const brief = await buildDemoAgentBrief({
      prompt: "Run event timeline rows and task live/build output blocks now use the standard border token.",
      changedFiles: [
        "interface/src/apps/process/components/ProcessSidekickContent/EventTimelineItem.tsx",
      ],
    });

    assert.equal(brief.targetAppId, "process");
    assert.equal(brief.generator, "anthropic");
    assert.ok(brief.requiredUiSignals.includes("sidekickVisible"));
    assert.ok(brief.proofRequirements.some((entry) => entry.anyOf.includes("Completed Task Output")));
  } finally {
    global.fetch = previousFetch;
    if (previousKey) {
      process.env.ANTHROPIC_API_KEY = previousKey;
    } else {
      delete process.env.ANTHROPIC_API_KEY;
    }
  }
});

test("buildDemoAgentBrief keeps fallback proof signals when Anthropic returns empty arrays", async () => {
  const previousKey = process.env.ANTHROPIC_API_KEY;
  const previousFetch = global.fetch;
  process.env.ANTHROPIC_API_KEY = "test-key";
  let requestBody = "";

  global.fetch = async (_url, options) => {
    requestBody = String(options?.body || "");
    return {
      ok: true,
      json: async () => ({
        content: [{
          type: "text",
          text: JSON.stringify({
            title: "GPT-5.5 picker",
            story: "GPT-5.5 is now available from the chat input model picker.",
            targetAppId: "agents",
            confidence: "high",
            validationSignals: [],
            proofRequirements: [],
            requiredUiSignals: [],
            forbiddenPhrases: [],
            desktopOnly: true,
          }),
        }],
      }),
    };
  };

  try {
    const brief = await buildDemoAgentBrief({
      prompt: "GPT-5.5 is now available from the chat input model picker.",
      changedFiles: [
        "interface/src/components/ChatInputBar/ChatInputBar.tsx",
        "interface/src/constants/models.ts",
      ],
    });

    assert.equal(brief.targetAppId, "agents");
    assert.equal(brief.generator, "anthropic");
    assert.ok(brief.validationSignals.includes("GPT-5.5"));
    assert.ok(brief.proofRequirements.some((entry) => entry.anyOf.includes("GPT-5.5")));
    assert.ok(brief.requiredUiSignals.includes("chatComposerVisible"));
    assert.ok(brief.requiredUiSignals.includes("modelPickerVisible"));
    assert.match(requestBody, /UI surface index/);
    assert.match(requestBody, /Matched learned navigation lessons/);
    assert.match(requestBody, /Deterministic navigation contract/);
  } finally {
    global.fetch = previousFetch;
    if (previousKey) {
      process.env.ANTHROPIC_API_KEY = previousKey;
    } else {
      delete process.env.ANTHROPIC_API_KEY;
    }
  }
});

test("buildDemoAgentBrief keeps changed-file inference working from the interface cwd", async () => {
  const previous = process.env.ANTHROPIC_API_KEY;
  const originalCwd = process.cwd();
  delete process.env.ANTHROPIC_API_KEY;

  try {
    process.chdir(path.join(REPO_ROOT, "interface"));
    const brief = await buildDemoAgentBrief({
      prompt: "Capability toggles autosave immediately in the Permissions tab and the saved state is clearly visible.",
      changedFiles: [
        "interface/src/apps/agents/AgentInfoPanel/PermissionsTab.tsx",
        "interface/src/types/permissions.ts",
      ],
    });

    assert.equal(brief.generator, "fallback");
    assert.equal(brief.targetAppId, "agents");
    assert.match(brief.proofInstruction, /Permissions/i);
  } finally {
    process.chdir(originalCwd);
    if (previous) {
      process.env.ANTHROPIC_API_KEY = previous;
    }
  }
});

test("buildDemoAgentBrief salvages partially malformed Anthropic output instead of dropping to generic fallback", async () => {
  const previousKey = process.env.ANTHROPIC_API_KEY;
  const previousFetch = global.fetch;
  process.env.ANTHROPIC_API_KEY = "test-key";

  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      content: [{
        type: "text",
        text: [
          "Here is the best candidate I could infer:",
          "\"title\": \"Feed proof\",",
          "\"story\": \"Show the seeded feed event titled 0 commits and keep it visible.\",",
          "\"targetAppId\": \"feed\",",
          "\"confidence\": \"high\",",
          "\"validationSignals\": [\"0 commits\", \"Feed\"],",
          "\"desktopOnly\": true",
        ].join("\n"),
      }],
    }),
  });

  try {
    const brief = await buildDemoAgentBrief({
      prompt: "Legacy push cards show a correct commit count.",
      changedFiles: [
        "interface/src/components/ActivityCard/ActivityCard.tsx",
        "interface/src/stores/feed-store.test.ts",
      ],
    });

    assert.equal(brief.targetAppId, "feed");
    assert.equal(brief.generator, "anthropic-salvaged");
    assert.ok(brief.validationSignals.includes("0 commits"));
    assert.equal(brief.desktopOnly, true);
  } finally {
    global.fetch = previousFetch;
    if (previousKey) {
      process.env.ANTHROPIC_API_KEY = previousKey;
    } else {
      delete process.env.ANTHROPIC_API_KEY;
    }
  }
});
