import assert from "node:assert/strict";
import test from "node:test";

import { normalizeCaptureSeedPlan } from "./changelog-media-seed-plan.mjs";

test("normalizeCaptureSeedPlan derives generic capabilities without feature-specific scripts", () => {
  const plan = normalizeCaptureSeedPlan(null, {
    title: "add image generation flow with sidekick panels",
    targetAppId: "aura3d",
    targetPath: "/3d",
    proofGoal: "Show the generated image gallery and sidekick panel.",
    changedFiles: ["interface/src/apps/aura3d/ImageGeneration/ImageGeneration.tsx"],
  });

  assert.equal(plan.schemaVersion, 1);
  assert.equal(plan.mode, "capture-demo-state");
  assert.ok(plan.capabilities.includes("app:aura3d"));
  assert.ok(plan.capabilities.includes("proof-data-populated"));
  assert.ok(plan.capabilities.includes("asset-gallery-populated"));
  assert.ok(plan.capabilities.includes("image-gallery-populated"));
  assert.ok(plan.requiredState.some((entry) => entry.includes("meaningful proof data")));
  assert.ok(plan.requiredState.some((entry) => entry.includes("generated image preview")));
  assert.ok(plan.proofBoundary.some((entry) => entry.includes("feature evidence")));
  assert.ok(plan.contextBoundary.some((entry) => entry.includes("recognizable product")));
  assert.ok(plan.avoid.includes("isolated widget without product context"));
  assert.ok(plan.readinessSignals.includes("desktop shell is visible"));
});

test("normalizeCaptureSeedPlan preserves AI-provided seed intent and deduplicates capabilities", () => {
  const plan = normalizeCaptureSeedPlan({
    mode: "capture-demo-state",
    capabilities: ["project-selected", "project-selected", "run-history-populated"],
    requiredState: ["A run timeline exists."],
    proofBoundary: ["The run status timeline proves the change."],
    contextBoundary: ["The Debug app title and run detail panel remain visible."],
    readinessSignals: ["Run detail timeline is visible."],
    avoid: ["empty run history"],
    notes: "Use seeded data only.",
  }, {
    title: "surface live runs in Debug",
    targetAppId: "debug",
    targetPath: "/debug",
  });

  assert.ok(plan.capabilities.includes("app:debug"));
  assert.ok(plan.capabilities.includes("project-selected"));
  assert.ok(plan.capabilities.includes("run-history-populated"));
  assert.equal(plan.capabilities.filter((entry) => entry === "project-selected").length, 1);
  assert.ok(plan.requiredState.includes("A run timeline exists."));
  assert.ok(plan.proofBoundary.includes("The run status timeline proves the change."));
  assert.ok(plan.contextBoundary.includes("The Debug app title and run detail panel remain visible."));
  assert.ok(plan.avoid.includes("empty run history"));
  assert.ok(plan.readinessSignals.includes("Run detail timeline is visible."));
  assert.equal(plan.notes, "Use seeded data only.");
});

test("normalizeCaptureSeedPlan upgrades shell captures with rich context requirements", () => {
  const plan = normalizeCaptureSeedPlan(null, {
    title: "Restyle desktop shell into floating glass capsules",
    targetAppId: "agents",
    targetPath: "/agents",
    proofGoal: "Show bottom taskbar, sidebar, sidekick, and main panel gaps.",
    changedFiles: [
      "interface/src/components/DesktopShell/DesktopShell.module.css",
      "interface/src/components/BottomTaskbar/BottomTaskbar.module.css",
    ],
  });

  assert.ok(plan.capabilities.includes("shell-context-populated"));
  assert.ok(plan.capabilities.includes("sidekick-context-populated"));
  assert.ok(plan.capabilities.includes("sidebar-list-populated"));
  assert.ok(plan.capabilities.includes("agent-chat-ready"));
  assert.ok(plan.requiredState.some((entry) => entry.includes("not an empty launcher")));
  assert.ok(plan.readinessSignals.some((entry) => entry.includes("sidebar, main panel, sidekick")));
  assert.ok(plan.avoid.includes("mostly black shell with only chrome and no product data"));
});

test("normalizeCaptureSeedPlan keeps AURA 3D shell proof on populated image state", () => {
  const plan = normalizeCaptureSeedPlan(null, {
    title: "Floating glass desktop shell",
    targetAppId: "aura3d",
    targetPath: "/3d",
    proofGoal: "Show the shell chrome around a populated AURA 3D gallery.",
    changedFiles: ["interface/src/components/DesktopShell/DesktopShell.module.css"],
  });

  assert.ok(plan.capabilities.includes("app:aura3d"));
  assert.ok(plan.capabilities.includes("image-gallery-populated"));
  assert.ok(plan.capabilities.includes("shell-context-populated"));
  assert.ok(!plan.capabilities.includes("task-board-populated"));
  assert.ok(!plan.capabilities.includes("model-source-image-populated"));
  assert.ok(plan.readinessSignals.includes("generated image preview and image gallery are visible"));
});

test("normalizeCaptureSeedPlan does not infer tasks from generic board or ready wording", () => {
  const feedbackPlan = normalizeCaptureSeedPlan(null, {
    title: "Feedback board shows review ready statuses",
    targetAppId: "feedback",
    targetPath: "/feedback",
    proofGoal: "Show feedback cards with status pills and comments ready for review.",
    changedFiles: ["interface/src/apps/feedback/FeedbackMainPanel/FeedbackMainPanel.tsx"],
  });
  const aura3dPlan = normalizeCaptureSeedPlan(null, {
    title: "AURA 3D generated image gallery is ready for capture",
    targetAppId: "aura3d",
    targetPath: "/3d",
    proofGoal: "Show generated image previews and gallery thumbnails.",
    changedFiles: ["interface/src/apps/aura3d/Aura3DApp.tsx"],
  });

  assert.ok(feedbackPlan.capabilities.includes("feedback-board-populated"));
  assert.ok(!feedbackPlan.capabilities.includes("task-board-populated"));
  assert.ok(aura3dPlan.capabilities.includes("image-gallery-populated"));
  assert.ok(!aura3dPlan.capabilities.includes("task-board-populated"));
});

test("normalizeCaptureSeedPlan does not infer AURA 3D gallery state from generic model or preview wording", () => {
  const modelPickerPlan = normalizeCaptureSeedPlan(null, {
    title: "Add GPT-5.5 model support",
    targetAppId: "agents",
    targetPath: "/agents",
    proofGoal: "Show GPT-5.5 in the chat model picker.",
    changedFiles: ["interface/src/components/ChatInputBar/ChatInputBar.tsx"],
  });
  const filePreviewPlan = normalizeCaptureSeedPlan(null, {
    title: "Add copy button to file previews in chat",
    targetAppId: "agents",
    targetPath: "/agents",
    proofGoal: "Show a file preview block with its copy button in a chat transcript.",
    changedFiles: ["interface/src/components/Block/renderers/FileBlock.tsx"],
  });

  assert.ok(modelPickerPlan.capabilities.includes("agent-chat-ready"));
  assert.ok(!modelPickerPlan.capabilities.includes("asset-gallery-populated"));
  assert.ok(!modelPickerPlan.capabilities.includes("image-gallery-populated"));
  assert.ok(filePreviewPlan.capabilities.includes("agent-chat-ready"));
  assert.ok(!filePreviewPlan.capabilities.includes("asset-gallery-populated"));
  assert.ok(!filePreviewPlan.capabilities.includes("image-gallery-populated"));
});

test("normalizeCaptureSeedPlan does not inherit AURA 3D seed state for explicit agent picker targets", () => {
  const plan = normalizeCaptureSeedPlan({
    capabilities: ["app:agents", "agent-chat-ready", "model-picker-open", "proof-data-populated"],
    requiredState: ["The chat composer model picker is open."],
  }, {
    title: "Aura-proxied models, persistent shell, and generate_image",
    targetAppId: "agents",
    targetPath: "/agents",
    proofGoal: "Show the Agents chat composer with gpt-image-2 visible in the model picker.",
    publicCaption: "gpt-image-2 is visible in the chat picker.",
    changedFiles: [
      "interface/src/constants/models.ts",
      "interface/src/apps/chat/components/ChatInputBar/ChatInputBar.tsx",
      "interface/src/stores/aura3d-store.ts",
    ],
  });

  assert.ok(plan.capabilities.includes("app:agents"));
  assert.ok(plan.capabilities.includes("agent-chat-ready"));
  assert.ok(!plan.capabilities.includes("app:aura3d"));
  assert.ok(!plan.capabilities.includes("asset-gallery-populated"));
  assert.ok(!plan.capabilities.includes("image-gallery-populated"));
});

test("normalizeCaptureSeedPlan opens the AURA 3D model surface only for explicit model proof", () => {
  const plan = normalizeCaptureSeedPlan(null, {
    title: "New AURA 3D image to 3D model viewer",
    targetAppId: "aura3d",
    targetPath: "/3d",
    proofGoal: "Show the selected source image ready for 3D model conversion.",
    changedFiles: ["interface/src/apps/aura3d/ModelGeneration/ModelGeneration.tsx"],
  });

  assert.ok(plan.capabilities.includes("model-source-image-populated"));
  assert.ok(plan.requiredState.some((entry) => entry.includes("source image is selected")));
});

test("normalizeCaptureSeedPlan asks for seeded data on non-empty app surfaces", () => {
  const feedbackPlan = normalizeCaptureSeedPlan(null, {
    title: "Feedback board adds threaded review status",
    targetAppId: "feedback",
    targetPath: "/feedback",
    proofGoal: "Show feedback cards, votes, statuses, and selected comments.",
    changedFiles: ["interface/src/apps/feedback/FeedbackMainPanel/FeedbackMainPanel.tsx"],
  });
  const notesPlan = normalizeCaptureSeedPlan(null, {
    title: "Notes editor adds table of contents sidekick",
    targetAppId: "notes",
    targetPath: "/notes",
    proofGoal: "Show a populated note editor with TOC context.",
    changedFiles: ["interface/src/apps/notes/NotesMainPanel/NotesMainPanel.tsx"],
  });
  const tasksPlan = normalizeCaptureSeedPlan(null, {
    title: "Task board now shows release gates across lanes",
    targetAppId: "tasks",
    targetPath: "/tasks",
    proofGoal: "Show a populated kanban board.",
    changedFiles: ["interface/src/apps/tasks/components/TasksMainPanel/TasksMainPanel.tsx"],
  });
  const processPlan = normalizeCaptureSeedPlan(null, {
    title: "Process graph run history is visible",
    targetAppId: "process",
    targetPath: "/process",
    proofGoal: "Show connected workflow nodes and run history.",
    changedFiles: ["interface/src/apps/process/components/ProcessCanvas/ProcessCanvas.tsx"],
  });
  const projectStatsPlan = normalizeCaptureSeedPlan(null, {
    title: "Project stats now decode every key shape",
    targetAppId: "projects",
    targetPath: "/projects",
    proofGoal: "Show the populated project stats dashboard with completion and metric cards.",
    changedFiles: ["interface/src/views/ProjectStatsView/ProjectStatsView.tsx"],
  });

  assert.ok(feedbackPlan.capabilities.includes("feedback-board-populated"));
  assert.ok(feedbackPlan.capabilities.includes("feedback-thread-populated"));
  assert.ok(notesPlan.capabilities.includes("notes-tree-populated"));
  assert.ok(notesPlan.capabilities.includes("note-editor-populated"));
  assert.ok(tasksPlan.capabilities.includes("task-board-populated"));
  assert.ok(processPlan.capabilities.includes("process-graph-populated"));
  assert.ok(processPlan.capabilities.includes("run-history-populated"));
  assert.ok(projectStatsPlan.capabilities.includes("project-summary-populated"));
  assert.ok(projectStatsPlan.capabilities.includes("project-stats-populated"));
  assert.ok(projectStatsPlan.requiredState.some((entry) => entry.includes("non-zero completion")));
});
