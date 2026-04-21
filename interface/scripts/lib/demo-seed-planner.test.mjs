import assert from "node:assert/strict";
import test from "node:test";

import { buildDemoSeedPlan } from "./demo-seed-planner.mjs";
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
    },
  });

  assert.equal(patched.entryPath, "/desktop");
  assert.ok(patched.seed.feedEvents.some((event) => event.id === "feed-demo-1"));
  assert.ok(patched.seed.processes.some((process) => process.process_id === "process-seeded"));
});
