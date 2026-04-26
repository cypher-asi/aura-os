const DEFAULT_SEED_CAPABILITIES = ["proof-data-populated"];

function normalizeString(value) {
  return String(value || "").trim();
}

function unique(values, limit = 32) {
  return [...new Set(
    (Array.isArray(values) ? values : [])
      .map(normalizeString)
      .filter(Boolean),
  )].slice(0, limit);
}

function candidateText(candidate = {}) {
  return [
    candidate.title,
    candidate.reason,
    candidate.proofGoal,
    candidate.publicCaption,
    candidate.targetAppId,
    candidate.targetPath,
    ...(Array.isArray(candidate.changedFiles) ? candidate.changedFiles : []),
  ].filter(Boolean).join("\n").toLowerCase();
}

function inferSeedCapabilities(candidate = {}) {
  const capabilities = [...DEFAULT_SEED_CAPABILITIES];
  const appId = normalizeString(candidate.targetAppId);
  const targetPath = normalizeString(candidate.targetPath);
  const text = candidateText(candidate);
  const changedFileText = (Array.isArray(candidate.changedFiles) ? candidate.changedFiles : []).join("\n").toLowerCase();
  const targetsAura3D = appId === "aura3d"
    || /^\/3d(?:\/|$)/.test(targetPath)
    || /interface\/src\/apps\/aura3d\//.test(changedFileText);
  const wantsShellContext = /\b(?:desktop shell|shell chrome|bottom taskbar|taskbar|sidebar|sidekick|floating[- ]glass|floating panel|desktop layout)\b/.test(text);
  const wantsAura3DModelSurface = /\b(?:image\s*(?:to|->|→)\s*(?:3d|model)|3d\s+model|webgl|viewer|convert|conversion|source image|model preview)\b/.test(text);
  const wantsAura3DAssetSurface = targetsAura3D
    || /\b(?:aura\s*3d|aura3d|3d\s+asset|3d\s+model|webgl|glb|image\s*(?:to|->|→)\s*(?:3d|model)|generated\s+image\s+gallery|generated\s+3d)\b/.test(text);
  const wantsAura3DImageGallery = targetsAura3D
    || /\b(?:aura\s*3d.*(?:image|gallery)|generated\s+image\s+gallery|3d\s+generated\s+image|image\s*(?:to|->|→)\s*(?:3d|model))\b/.test(text);
  const wantsTaskBoard = appId === "tasks"
    || /^\/tasks(?:\/|$)/.test(targetPath)
    || /interface\/src\/apps\/tasks\//.test(changedFileText)
    || /\b(?:task(?:s| board)?|kanban|lanes?)\b/.test(text);
  const wantsProcessGraph = appId === "process"
    || /^\/process(?:\/|$)/.test(targetPath)
    || /interface\/src\/apps\/process\//.test(changedFileText)
    || /\b(?:processes?|workflow|nodes?|graph|run history)\b/.test(text);
  const wantsProjectSurface = appId === "projects"
    || /^\/projects(?:\/|$)/.test(targetPath)
    || /interface\/src\/(?:apps\/projects|views\/project|components\/project|queries\/project|stores\/projects-list-store)\//.test(changedFileText)
    || /\b(?:project workspace|project stats|project summary|project navigation|project list|specs?|project tasks?)\b/.test(text);
  const wantsProjectStats = wantsProjectSurface
    && (/\b(?:stats?|metrics?|completion|tokens?|events?|sessions?|contributors?|cost|lines changed)\b/.test(text)
      || /ProjectStatsView|StatsDashboard|project-stats|stats-dashboard/i.test(changedFileText));

  if (appId) {
    capabilities.push(`app:${appId}`);
  }
  if (targetPath.includes(":projectId") || /^\/projects(?:\/|$)/.test(targetPath) || /\bproject\b/.test(text)) {
    capabilities.push("project-selected");
  }
  if (wantsProjectSurface) {
    capabilities.push("project-summary-populated");
    capabilities.push("sidebar-list-populated");
    capabilities.push("sidekick-context-populated");
  }
  if (wantsProjectStats) {
    capabilities.push("project-stats-populated");
    capabilities.push("run-history-populated");
  }
  if (wantsAura3DAssetSurface) {
    capabilities.push("asset-gallery-populated");
  }
  if (wantsAura3DImageGallery) {
    capabilities.push("image-gallery-populated");
  }
  if (appId === "aura3d" && wantsAura3DModelSurface && !wantsShellContext) {
    capabilities.push("model-source-image-populated");
  }
  if (appId === "agents" || /\b(?:chat|message|conversation|model picker|skills?|agent row|agent sidebar)\b/.test(text)) {
    capabilities.push("agent-chat-ready");
  }
  if (appId === "feedback" || /\b(?:feedback|ideas?|votes?|comments?|thread|board|status)\b/.test(text)) {
    capabilities.push("feedback-board-populated");
    capabilities.push("feedback-thread-populated");
    capabilities.push("sidebar-list-populated");
    capabilities.push("sidekick-context-populated");
  }
  if (appId === "notes" || /\b(?:notes?|documents?|editor|toc|table of contents|markdown)\b/.test(text)) {
    capabilities.push("notes-tree-populated");
    capabilities.push("note-editor-populated");
    capabilities.push("project-selected");
    capabilities.push("sidekick-context-populated");
  }
  if (wantsTaskBoard) {
    capabilities.push("task-board-populated");
    capabilities.push("project-selected");
    capabilities.push("sidebar-list-populated");
    capabilities.push("sidekick-context-populated");
  }
  if (wantsProcessGraph) {
    capabilities.push("process-graph-populated");
    capabilities.push("run-history-populated");
    capabilities.push("project-selected");
    capabilities.push("sidekick-context-populated");
  }
  if (appId === "feed" || /\b(?:feed|timeline|activity|updates?|posts?|commit activity)\b/.test(text)) {
    capabilities.push("feed-timeline-populated");
    capabilities.push("proof-data-populated");
  }
  if (/\b(?:debug|run|timeline|logs?|loop|activity|progress|harness)\b/.test(text)) {
    capabilities.push("run-history-populated");
  }
  if (wantsShellContext) {
    capabilities.push("shell-context-populated");
    capabilities.push("sidekick-context-populated");
    capabilities.push("sidebar-list-populated");
  }
  if (/\b(?:loopprogress|loop progress|activity indicator|spinner|running|active loop)\b/.test(text)) {
    capabilities.push("active-loop-visible");
    capabilities.push("sidebar-list-populated");
  }

  return capabilities;
}

export function normalizeCaptureSeedPlan(seedPlan = null, candidate = {}) {
  const explicit = seedPlan && typeof seedPlan === "object" ? seedPlan : {};
  const capabilities = unique([
    ...inferSeedCapabilities(candidate),
    ...(Array.isArray(explicit.capabilities) ? explicit.capabilities : []),
  ]);
  const requiredState = unique([
    ...(Array.isArray(explicit.requiredState) ? explicit.requiredState : []),
    ...(capabilities.includes("project-selected") ? ["A demo project is selected before capture."] : []),
    ...(capabilities.includes("project-summary-populated") ? ["The selected project has realistic specs, tasks, and an assigned agent before capture."] : []),
    ...(capabilities.includes("project-stats-populated") ? ["The selected project stats dashboard has non-zero completion, task, cost, token, event, and contributor metrics before capture."] : []),
    ...(capabilities.includes("image-gallery-populated") ? ["A generated image preview and gallery are populated before capture."] : []),
    ...(capabilities.includes("model-source-image-populated") ? ["A source image is selected so the 3D model surface is not an empty placeholder."] : []),
    ...(capabilities.includes("agent-chat-ready") ? ["A seeded agent is selected with a populated chat transcript before capture."] : []),
    ...(capabilities.includes("feedback-board-populated") ? ["A feedback board is populated with realistic idea cards, votes, statuses, and a selected item before capture."] : []),
    ...(capabilities.includes("feedback-thread-populated") ? ["A feedback thread is selected with visible comments before capture."] : []),
    ...(capabilities.includes("notes-tree-populated") ? ["A notes project tree is populated with realistic documents before capture."] : []),
    ...(capabilities.includes("note-editor-populated") ? ["A note editor is open with readable markdown content before capture."] : []),
    ...(capabilities.includes("task-board-populated") ? ["A task board is populated across multiple lanes before capture."] : []),
    ...(capabilities.includes("process-graph-populated") ? ["A process graph is populated with connected nodes and run context before capture."] : []),
    ...(capabilities.includes("feed-timeline-populated") ? ["A feed timeline is populated with realistic release activity before capture."] : []),
    ...(capabilities.includes("shell-context-populated") ? ["The desktop shell surrounds a populated product app, not an empty launcher or blank route."] : []),
    ...(capabilities.includes("sidekick-context-populated") ? ["The sidekick panel has meaningful selected-item detail instead of an empty prompt."] : []),
    ...(capabilities.includes("sidebar-list-populated") ? ["The app sidebar contains multiple realistic rows with readable labels and status context."] : []),
    ...(capabilities.includes("active-loop-visible") ? ["At least one durable activity/progress indicator is visible without relying on hover or transient UI."] : []),
    ...(capabilities.includes("proof-data-populated") ? ["The target surface has meaningful proof data instead of an empty/default state."] : []),
  ]);
  const proofBoundary = unique([
    ...(Array.isArray(explicit.proofBoundary) ? explicit.proofBoundary : []),
    "The feature evidence itself is visible and readable.",
  ]);
  const contextBoundary = unique([
    ...(Array.isArray(explicit.contextBoundary) ? explicit.contextBoundary : []),
    "The crop includes the nearest recognizable product title, tab, sidebar, toolbar, or navigation that explains the proof.",
  ]);
  const avoid = unique([
    ...(Array.isArray(explicit.avoid) ? explicit.avoid : []),
    "isolated widget without product context",
    "empty or placeholder-only state",
    "mostly black shell with only chrome and no product data",
  ]);
  const readinessSignals = unique([
    ...(Array.isArray(explicit.readinessSignals) ? explicit.readinessSignals : []),
    "desktop shell is visible",
    "target app route is active",
    "no blocking modal or placeholder state is visible",
    ...(capabilities.includes("image-gallery-populated") ? ["generated image preview and image gallery are visible"] : []),
    ...(capabilities.includes("model-source-image-populated") ? ["source image for 3D conversion is visible"] : []),
    ...(capabilities.includes("agent-chat-ready") ? ["selected agent chat transcript is populated"] : []),
    ...(capabilities.includes("project-summary-populated") ? ["selected project has visible summary, specs, tasks, or agent context"] : []),
    ...(capabilities.includes("project-stats-populated") ? ["project stats dashboard has non-zero metric cards and completion progress"] : []),
    ...(capabilities.includes("feedback-board-populated") ? ["feedback board has multiple visible cards"] : []),
    ...(capabilities.includes("feedback-thread-populated") ? ["selected feedback thread has comments"] : []),
    ...(capabilities.includes("note-editor-populated") ? ["selected note has readable editor content"] : []),
    ...(capabilities.includes("task-board-populated") ? ["kanban lanes contain seeded tasks"] : []),
    ...(capabilities.includes("process-graph-populated") ? ["process canvas contains connected seeded nodes"] : []),
    ...(capabilities.includes("feed-timeline-populated") ? ["feed timeline contains seeded activity entries"] : []),
    ...(capabilities.includes("shell-context-populated") ? ["sidebar, main panel, sidekick, and bottom taskbar are all visible around product data"] : []),
    ...(capabilities.includes("active-loop-visible") ? ["loop/progress indicator is visible on a stable row or panel"] : []),
  ]);

  return {
    schemaVersion: 1,
    mode: normalizeString(explicit.mode) || "capture-demo-state",
    capabilities,
    requiredState,
    proofBoundary,
    contextBoundary,
    readinessSignals,
    avoid,
    notes: normalizeString(explicit.notes) || null,
  };
}
