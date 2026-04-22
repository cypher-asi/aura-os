import assert from "node:assert/strict";
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
