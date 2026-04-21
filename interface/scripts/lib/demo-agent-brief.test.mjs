import assert from "node:assert/strict";
import test from "node:test";

import { buildDemoAgentBrief } from "./demo-agent-brief.mjs";

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
  assert.match(brief.proofInstruction, /Skill Shop|Installed|Available/i);
  assert.ok(brief.setupPlan.some((entry) => /Skills|tab/i.test(entry)));
  assert.ok(brief.validationSignals.some((entry) => /Skills|Skill Shop|Installed|Available/i.test(entry)));

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
