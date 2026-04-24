import assert from "node:assert/strict";
import test from "node:test";

import { applyDemoSeedPlanToBrief, buildDemoSeedPlan } from "./demo-seed-planner.mjs";
import { applyDemoSeedPatch, getDemoScreenshotProfile } from "./demo-screenshot-seeds.mjs";

test("notes story becomes a preseeded note plan", async () => {
  const brief = {
    title: "Create note",
    story: 'Create a new note called "Demo Capture Plan" in Notes and show it open.',
    targetAppId: "notes",
    startPath: "/notes",
  };

  const plan = await buildDemoSeedPlan({ brief });

  assert.equal(plan.capabilityId, "notes.preseed-note");
  assert.equal(plan.status, "preseeded");
  assert.match(plan.startPath, /^\/notes\/proj-1\//);
  assert.equal(plan.seededEntities[0]?.title, "Demo Capture Plan");
  assert.ok(plan.seed.notesDocuments["Demo Capture Plan.md"]);
});

test("process story becomes a preseeded process plan", async () => {
  const brief = {
    title: "Create process",
    story: 'Create a process called "Launch Review" and leave the process visible.',
    targetAppId: "process",
    startPath: "/process",
  };

  const plan = await buildDemoSeedPlan({ brief });

  assert.equal(plan.capabilityId, "process.preseed-process");
  assert.equal(plan.status, "preseeded");
  assert.match(plan.startPath, /^\/process\/process-launch-review$/);
  assert.equal(plan.seededEntities[0]?.name, "Launch Review");
  assert.equal(plan.seed.processes[0]?.process_id, "process-launch-review");
  assert.equal(plan.seed.processNodes["process-launch-review"][0]?.label, "Starter Step");
});

test("process output story seeds run detail proof instead of accepting a blank canvas", async () => {
  const brief = {
    title: "Process output borders",
    story: "Run event timeline rows and task live/build output blocks now use the standard border token.",
    targetAppId: "process",
    startPath: "/process",
    changedFileEvidence: {
      files: [
        {
          filePath: "interface/src/apps/process/components/ProcessSidekickContent/EventTimelineItem.tsx",
          surfaceLabel: "Event Timeline Item",
          componentNames: ["EventTimelineItem", "EventsTimeline"],
        },
      ],
    },
  };

  const plan = await buildDemoSeedPlan({
    brief,
    changedFiles: [
      "interface/src/apps/process/components/ProcessSidekickContent/EventTimelineItem.tsx",
    ],
  });

  assert.equal(plan.capabilityId, "process.preseed-process");
  assert.equal(plan.status, "preseeded");
  assert.ok(plan.seed.processRuns["process-demo-process"]);
  assert.ok(plan.seed.processRunEvents["run-demo-process-proof"]);
  assert.equal(plan.seed.processNodes["process-demo-process"][0]?.label, "Build Output");
  assert.ok(plan.instructionPatch.proofRequirements.some((entry) => entry.anyOf.includes("Completed Task Output")));
  assert.ok(plan.instructionPatch.requiredUiSignals.includes("sidekickVisible"));
  assert.ok(plan.instructionPatch.forbiddenPhrases.includes("No output persisted for this node"));
});

test("feed story becomes a preseeded feed plan from the desktop shell", async () => {
  const brief = {
    title: "Show feed",
    story: "Show the new feedback launch update in Feed and leave the comments visible.",
    targetAppId: "feed",
    startPath: "/feed",
  };

  const plan = await buildDemoSeedPlan({ brief });

  assert.equal(plan.capabilityId, "feed.preseed-event");
  assert.equal(plan.status, "preseeded");
  assert.equal(plan.startPath, "/desktop");
  assert.equal(plan.seededEntities[0]?.type, "feed-event");
  assert.equal(plan.seed.feedEvents.length, 1);
});

test("applyDemoSeedPlanToBrief promotes seeded entities into validation signals and proof requirements", () => {
  const brief = {
    title: "Show feed",
    story: "Show the seeded feed update.",
    targetAppId: "feed",
    startPath: "/feed",
    successChecklist: ["Feed is visible"],
    setupPlan: [],
    validationSignals: ["Feed"],
    proofRequirements: [],
    requiredUiSignals: [],
    forbiddenPhrases: [],
    systemPrompt: "Base prompt",
    openAppInstruction: "Open Feed",
    proofInstruction: "Show the feed card",
    interactionInstruction: "Keep the card visible",
  };
  const seedPlan = {
    startPath: "/desktop",
    seededEntities: [{ type: "feed-event", eventId: "feed-0-commits", title: "0 commits", source: "generated" }],
    instructionPatch: {
      validationSignals: ["0 commits"],
    },
  };

  const patched = applyDemoSeedPlanToBrief(brief, seedPlan);

  assert.equal(patched.startPath, "/desktop");
  assert.ok(patched.validationSignals.includes("0 commits"));
  assert.ok(patched.proofRequirements.some((entry) => entry.anyOf.includes("0 commits")));
});

test("applyDemoSeedPlanToBrief does not force seeded context into already-specific proof shots", () => {
  const brief = {
    title: "Model picker",
    story: "Show GPT-5.5 in the chat input model picker.",
    targetAppId: "agents",
    startPath: "/agents/agent-ceo",
    successChecklist: ["Model picker is visible"],
    setupPlan: [],
    validationSignals: ["GPT-5.5"],
    proofRequirements: [{ label: "named model option", anyOf: ["GPT-5.5"] }],
    requiredUiSignals: ["chatComposerVisible", "modelPickerVisible"],
    forbiddenPhrases: [],
    systemPrompt: "Base prompt",
    openAppInstruction: "Open Agents",
    proofInstruction: "Show the model picker",
    interactionInstruction: "Keep the dropdown visible",
  };
  const seedPlan = {
    startPath: "/agents/agent-ceo",
    seededEntities: [{ type: "agent", agentId: "agent-ceo", name: "Aura CEO", source: "baseline" }],
    instructionPatch: {
      validationSignals: ["Aura CEO"],
    },
  };

  const patched = applyDemoSeedPlanToBrief(brief, seedPlan);

  assert.ok(patched.validationSignals.includes("Aura CEO"));
  assert.ok(patched.proofRequirements.some((entry) => entry.anyOf.includes("GPT-5.5")));
  assert.equal(patched.proofRequirements.some((entry) => entry.anyOf.includes("Aura CEO")), false);
});

test("feedback story stays runtime-ready without extra preseed patching", async () => {
  const brief = {
    title: "Create feedback",
    story: "Open Feedback, create a new idea, and leave the thread visible.",
    targetAppId: "feedback",
    startPath: "/feedback",
  };

  const plan = await buildDemoSeedPlan({ brief });

  assert.equal(plan.capabilityId, "feedback.runtime-create");
  assert.equal(plan.status, "runtime-ready");
  assert.deepEqual(plan.seed, {});
  assert.equal(plan.startPath, "/feedback");
});

test("agent skills story reuses a seeded agent instead of requiring a custom feature registry", async () => {
  const brief = {
    title: "Agent skills",
    story: "Add skills to your agent and leave the Skills tab visible.",
    targetAppId: "agents",
    startPath: "/agents",
  };

  const plan = await buildDemoSeedPlan({
    brief,
    changedFiles: [
      "interface/src/apps/agents/AgentInfoPanel/SkillsTab.tsx",
      "interface/src/apps/agents/AgentInfoPanel/AgentInfoPanel.tsx",
    ],
  });

  assert.equal(plan.capabilityId, "agents.reuse-seeded-agent");
  assert.equal(plan.status, "runtime-ready");
  assert.match(plan.startPath, /^\/agents\//);
  assert.equal(plan.seededEntities[0]?.type, "agent");
  assert.ok(plan.instructionPatch.successChecklist.some((entry) => /Skills/i.test(entry)));
});

test("debug story reuses a seeded debug run and requires run-detail proof", async () => {
  const brief = {
    title: "Debug sidekick inspector",
    story: "Debug app rebuilt around a sidekick inspector with a tighter run toolbar and tabbed detail view.",
    targetAppId: "debug",
    startPath: "/debug",
  };

  const plan = await buildDemoSeedPlan({
    brief,
    changedFiles: [
      "interface/src/apps/debug/DebugRunDetailView/DebugRunDetailView.tsx",
      "interface/src/apps/debug/components/DebugSidekickTaskbar/DebugSidekickTaskbar.tsx",
    ],
  });

  assert.equal(plan.capabilityId, "debug.reuse-seeded-run");
  assert.equal(plan.status, "runtime-ready");
  assert.match(plan.startPath, /^\/debug\/proj-1\/runs\/debug-run-demo-1$/);
  assert.ok(plan.seededEntities.some((entry) => entry.type === "debug-run"));
  assert.ok(plan.instructionPatch.proofRequirements.some((entry) => entry.anyOf.includes("Copy all")));
  assert.ok(plan.instructionPatch.requiredUiSignals.includes("sidekickVisible"));
});

test("task output story reuses seeded project task data instead of needing a feature registry entry", async () => {
  const brief = {
    title: "Task output survives reloads",
    story: "Completed task output survives remounts and reloads in the run pane.",
    targetAppId: "tasks",
    startPath: "/tasks",
  };

  const plan = await buildDemoSeedPlan({
    brief,
    changedFiles: [
      "interface/src/components/TaskOutputPanel/CompletedTaskOutput.tsx",
      "interface/src/stores/task-output-panel-store.ts",
      "interface/src/stores/task-stream-bootstrap.ts",
    ],
  });

  assert.equal(plan.capabilityId, "tasks.reuse-seeded-output");
  assert.equal(plan.status, "runtime-ready");
  assert.match(plan.startPath, /^\/projects\/proj-1\/agents\/proj-agent-1$/);
  assert.ok(plan.seededEntities.some((entry) => entry.type === "task"));
  assert.ok(plan.instructionPatch.validationSignals.includes("Completed Task Output"));
});

test("applyDemoSeedPatch merges preseeded entities into the base profile", () => {
  const profile = getDemoScreenshotProfile("agent-shell-explorer");
  const patched = applyDemoSeedPatch(profile, {
    startPath: "/desktop",
    seed: {
      feedEvents: [
        {
          id: "feed-demo-1",
          profile_id: "profile-1",
          event_type: "announcement",
          post_type: "post",
          title: "Seeded launch update",
          summary: "Visible seeded event",
          metadata: null,
          org_id: "org-1",
          project_id: "proj-1",
          agent_id: null,
          user_id: "user-1",
          push_id: null,
          commit_ids: [],
          created_at: "2026-03-17T01:00:00.000Z",
          comment_count: 0,
          author_name: "Launch Team",
          author_avatar: null,
        },
      ],
      processes: [
        {
          process_id: "process-seeded",
          org_id: "org-1",
          user_id: "user-1",
          project_id: "proj-1",
          name: "Seeded Process",
          description: "Visible seeded process",
          enabled: true,
          folder_id: null,
          schedule: null,
          tags: ["demo"],
          last_run_at: null,
          next_run_at: null,
          created_at: "2026-03-17T01:00:00.000Z",
          updated_at: "2026-03-17T01:00:00.000Z",
        },
      ],
      debugRuns: {
        "proj-1": [
          {
            run_id: "debug-seeded-1",
            project_id: "proj-1",
            agent_instance_id: "proj-agent-1",
            started_at: "2026-03-17T01:00:00.000Z",
            ended_at: "2026-03-17T01:01:00.000Z",
            status: "completed",
            tasks: [],
            spec_ids: [],
            counters: {
              events_total: 1,
              llm_calls: 0,
              iterations: 0,
              blockers: 0,
              retries: 0,
              tool_calls: 0,
              task_completed: 0,
              task_failed: 0,
              input_tokens: 0,
              output_tokens: 0,
            },
          },
        ],
      },
      debugRunLogs: {
        "debug-seeded-1": {
          events: "{\"_ts\":\"2026-03-17T01:00:00.000Z\",\"event\":{\"type\":\"task_started\"}}",
        },
      },
    },
  });

  assert.equal(patched.entryPath, "/desktop");
  assert.ok(patched.seed.feedEvents.some((event) => event.id === "feed-demo-1"));
  assert.ok(patched.seed.processes.some((process) => process.process_id === "process-seeded"));
  assert.ok(patched.seed.debugRuns["proj-1"].some((run) => run.run_id === "debug-seeded-1"));
  assert.equal(patched.seed.debugRunLogs["debug-seeded-1"].events.includes("task_started"), true);
});
