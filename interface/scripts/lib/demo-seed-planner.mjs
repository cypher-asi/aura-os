import { listDemoAgentApps } from "./demo-agent-app-catalog.mjs";
import { getDemoScreenshotProfile } from "./demo-screenshot-seeds.mjs";

function clipText(value, maxLength) {
  const text = String(value || "").trim();
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 1).trimEnd()}…`;
}

function normalizeArray(values, limit = 8) {
  return Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => String(value || "").trim())
        .filter(Boolean),
    ),
  ).slice(0, limit);
}

function tokenize(values) {
  return new Set(
    values
      .flatMap((value) => String(value || "").toLowerCase().split(/[^a-z0-9]+/g))
      .map((token) => token.trim())
      .filter((token) => token.length >= 3),
  );
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

function toTitleCase(value) {
  return String(value || "")
    .split(/\s+/g)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function extractNamedEntity(story, options = {}) {
  const text = String(story || "").trim();
  const quoted = text.match(/["']([^"']{3,80})["']/);
  if (quoted) {
    return quoted[1].trim();
  }

  const called = text.match(/\b(?:called|named|title[d]?)\s+([A-Za-z0-9][A-Za-z0-9 _-]{2,80})/i);
  if (called) {
    return called[1].trim();
  }

  return options.fallback || "";
}

function buildStorySummary({ prompt, changelogDoc, story }) {
  return clipText(
    prompt
      || changelogDoc?.rendered?.intro
      || changelogDoc?.rendered?.title
      || story
      || "",
    180,
  );
}

function normalizeTextForMatch(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function scoreTextValues(values, storyTerms) {
  let score = 0;
  const matchedKeywords = [];
  const normalizedValues = normalizeArray(values, 20);
  for (const value of normalizedValues) {
    const valueTokens = tokenize([value]);
    for (const term of storyTerms) {
      if (valueTokens.has(term)) {
        score += 2;
        matchedKeywords.push(term);
      }
    }
  }
  return {
    score,
    matchedKeywords: normalizeArray(matchedKeywords, 8),
  };
}

function detectStoryIntent(story, brief) {
  const text = `${story} ${brief?.title || ""}`.toLowerCase();
  const wantsCreate = /\b(create|new|add|post)\b/.test(text);
  const wantsDelete = /\b(delete|remove)\b/.test(text);
  const wantsComment = /\b(comment|reply|discussion|thread)\b/.test(text);
  const wantsChat = /\b(chat|message|response|conversation)\b/.test(text);
  const wantsSkills = /\b(skill|skills)\b/.test(text);
  const wantsPermissions = /\b(permission|permissions|capabilit(?:y|ies)|scope|tool|tools)\b/.test(text);
  const wantsMemory = /\b(memory)\b/.test(text);
  const wantsProfile = /\b(profile)\b/.test(text);
  const wantsTabs = wantsSkills || wantsPermissions || wantsMemory || wantsProfile || /\btab\b/.test(text);
  const wantsModal = /\b(modal|dialog)\b/.test(text);
  const wantsHover = /\b(hover|popover|tooltip)\b/.test(text);
  const wantsModelSurface = /\b(model|models|provider|providers)\b/.test(text);
  const wantsNamedEntity = Boolean(extractNamedEntity(story));
  const wantsCreateAgent = /\b(create|new)\s+(?:an?\s+)?agent\b/.test(text);

  return {
    wantsCreate,
    wantsDelete,
    wantsComment,
    wantsChat,
    wantsSkills,
    wantsPermissions,
    wantsMemory,
    wantsProfile,
    wantsTabs,
    wantsModal,
    wantsHover,
    wantsModelSurface,
    wantsNamedEntity,
    wantsCreateAgent,
  };
}

function buildFeedEvent({
  id,
  title,
  summary,
  createdAt,
  authorName = "Launch Team",
  eventType = "announcement",
  postType = "post",
}) {
  return {
    id,
    profile_id: "profile-1",
    event_type: eventType,
    post_type: postType,
    title,
    summary,
    metadata: {
      summary,
      author_name: authorName,
      profileName: authorName,
      profileType: "user",
    },
    org_id: "org-1",
    project_id: "proj-1",
    agent_id: null,
    user_id: "user-1",
    push_id: null,
    commit_ids: [],
    created_at: createdAt,
    comment_count: 1,
    author_name: authorName,
    author_avatar: null,
  };
}

function buildFeedComment({ id, eventId, content, createdAt, authorName = "Product" }) {
  return {
    id,
    activity_event_id: eventId,
    profile_id: "profile-1",
    content,
    created_at: createdAt,
    author_name: authorName,
    author_avatar: null,
  };
}

function buildProcessRecord({ id, name, description, createdAt }) {
  return {
    process_id: id,
    org_id: "org-1",
    user_id: "user-1",
    project_id: "proj-1",
    name,
    description,
    enabled: true,
    folder_id: null,
    schedule: null,
    tags: ["demo", "seeded"],
    last_run_at: null,
    next_run_at: null,
    created_at: createdAt,
    updated_at: createdAt,
  };
}

function buildProcessNode({ processId, nodeId, label, prompt = "", x = 120, y = 120 }) {
  const timestamp = new Date().toISOString();
  return {
    node_id: nodeId,
    process_id: processId,
    node_type: "prompt",
    label,
    agent_id: null,
    prompt,
    config: {},
    position_x: x,
    position_y: y,
    created_at: timestamp,
    updated_at: timestamp,
  };
}

function buildProcessRun({ processId, runId, startedAt, completedAt, output }) {
  return {
    run_id: runId,
    process_id: processId,
    status: "completed",
    trigger: "manual",
    error: null,
    started_at: startedAt,
    completed_at: completedAt,
    total_input_tokens: 1280,
    total_output_tokens: 412,
    cost_usd: 0.01,
    output,
  };
}

function buildProcessEvent({ processId, runId, nodeId, startedAt, completedAt, output }) {
  return {
    event_id: `event-${runId}`,
    run_id: runId,
    node_id: nodeId,
    process_id: processId,
    status: "completed",
    input_snapshot: JSON.stringify({
      task: "Render a seeded changelog proof output block.",
      source: "changelog-media-seed",
    }),
    output,
    started_at: startedAt,
    completed_at: completedAt,
    input_tokens: 1280,
    output_tokens: 412,
    model: "claude-sonnet-4-6",
    content_blocks: [
      {
        type: "text",
        text: output,
      },
    ],
  };
}

function buildNoteDocument({ title, body, relPath }) {
  const timestamp = new Date().toISOString();
  const normalizedTitle = String(title || "").trim() || "Untitled";
  const content = [
    `# ${normalizedTitle}`,
    "",
    clipText(body || "Seeded changelog proof note.", 240),
  ].join("\n");
  return {
    relPath,
    document: {
      content,
      title: normalizedTitle,
      frontmatter: {
        created_at: timestamp,
        created_by: "Test User",
        updated_at: timestamp,
      },
      absPath: `/Users/demo/workspaces/Demo Project/${relPath}`,
      updatedAt: timestamp,
      wordCount: content.split(/\s+/g).filter(Boolean).length,
    },
    treeNode: {
      kind: "note",
      name: relPath.split("/").pop() || `${normalizedTitle}.md`,
      relPath,
      title: normalizedTitle,
      absPath: `/Users/demo/workspaces/Demo Project/${relPath}`,
      updatedAt: timestamp,
    },
  };
}

function extractBaselineWorld(profile) {
  const seed = profile?.seed ?? {};
  return {
    projects: Array.isArray(seed.projects) ? seed.projects : [],
    feedbackItems: Array.isArray(seed.feedbackItems) ? seed.feedbackItems : [],
    feedbackComments: seed.feedbackComments ?? {},
    agents: Array.isArray(seed.agents) ? seed.agents : [],
    agentEvents: seed.agentEvents ?? {},
    agentProjectBindings: seed.agentProjectBindings ?? {},
    notesDocuments: seed.notesDocuments ?? {},
    specs: Array.isArray(seed.specs) ? seed.specs : [],
    tasks: Array.isArray(seed.tasks) ? seed.tasks : [],
    taskOutputs: seed.taskOutputs ?? {},
    processes: Array.isArray(seed.processes) ? seed.processes : [],
    processNodes: seed.processNodes ?? {},
    feedEvents: Array.isArray(seed.feedEvents) ? seed.feedEvents : [],
    debugRuns: seed.debugRuns ?? {},
    debugRunLogs: seed.debugRunLogs ?? {},
    debugRunSummaries: seed.debugRunSummaries ?? {},
  };
}

function buildBaselineTaskMatches(context) {
  const specsById = new Map(context.baseline.specs.map((spec) => [spec.spec_id, spec]));

  return context.baseline.tasks
    .map((task) => {
      const spec = specsById.get(task.spec_id) ?? null;
      const output = context.baseline.taskOutputs[task.task_id] ?? null;
      const buildSummaries = Array.isArray(task.build_steps)
        ? task.build_steps.map((step) => `${step.command || ""} ${step.stdout || ""}`.trim())
        : [];
      const testSummaries = Array.isArray(task.test_steps)
        ? task.test_steps.flatMap((step) => [
          `${step.command || ""} ${step.stdout || ""}`.trim(),
          `${step.summary || ""}`.trim(),
          ...(Array.isArray(step.tests) ? step.tests.map((entry) => `${entry.name || ""} ${entry.status || ""}`.trim()) : []),
        ])
        : [];
      const scored = scoreTextValues([
        task.title,
        task.description,
        task.execution_notes,
        task.status,
        spec?.title,
        spec?.markdown_contents,
        output?.output,
        ...buildSummaries,
        ...testSummaries,
      ], context.storyTerms);

      if ((/\b(output|reload|remount|rehydrat|run pane|completed)\b/i.test(context.story)) && output?.output) {
        scored.score += 10;
      }
      if (spec?.title) {
        scored.score += 2;
      }

      return {
        task,
        spec,
        output,
        score: scored.score,
        matchedKeywords: scored.matchedKeywords,
      };
    })
    .sort((left, right) => right.score - left.score || left.task.title.localeCompare(right.task.title));
}

function buildTaskExistingPlan(context, taskMatch) {
  const { task, spec, output } = taskMatch;
  const projectBindingEntry = Object.values(context.baseline.agentProjectBindings)
    .flatMap((bindings) => Array.isArray(bindings) ? bindings : [])
    .find((binding) => binding.project_agent_id === task.assigned_agent_instance_id || binding.project_id === task.project_id) ?? null;
  const isOutputStory = /\b(output|reload|remount|rehydrat|run pane|completed)\b/i.test(context.story);
  const startPath = isOutputStory && task.assigned_agent_instance_id
    ? `/projects/${task.project_id}/agents/${task.assigned_agent_instance_id}`
    : context.targetApp?.id === "projects"
      ? `/projects/${task.project_id}`
      : `/tasks/${task.project_id}`;
  const projectLabel = projectBindingEntry?.project_name || "Demo Project";
  const validationSignals = normalizeArray([
    projectLabel,
    spec?.title,
    task.title,
    isOutputStory ? "Completed Task Output" : null,
    isOutputStory ? "Test task" : null,
    context.targetApp?.label || "Tasks",
  ], 8);
  const checklist = normalizeArray([
    `${context.targetApp?.label || "Tasks"} app is open and stable`,
    `${projectLabel} is visible in the current workspace`,
    spec?.title ? `The spec "${spec.title}" is visible or selected` : null,
    `The task "${task.title}" is visible`,
    isOutputStory ? "Completed task output is visibly open" : null,
  ], 5);

  return {
    status: "runtime-ready",
    strategy: "runtime",
    startPath,
    capabilityId: isOutputStory ? "tasks.reuse-seeded-output" : "tasks.reuse-seeded-task",
    supportLevel: "full",
    rationale: `The baseline seeded workspace already contains ${spec ? `spec "${spec.title}" and ` : ""}task "${task.title}", so the agent can show a truthful task surface without depending on a hand-authored feature script.`,
    coverageGaps: [],
    seed: {},
    seededEntities: normalizeArray([
      JSON.stringify({ type: "project", projectId: task.project_id, name: projectLabel, source: "baseline" }),
      spec ? JSON.stringify({ type: "spec", specId: spec.spec_id, title: spec.title, source: "baseline" }) : null,
      JSON.stringify({ type: "task", taskId: task.task_id, title: task.title, source: "baseline" }),
      output ? JSON.stringify({ type: "task-output", taskId: task.task_id, source: "baseline" }) : null,
    ]).map((entry) => JSON.parse(entry)),
    instructionPatch: {
      systemPromptAppend: `A seeded project workspace already contains task "${task.title}"${spec ? ` under spec "${spec.title}"` : ""}. Open that same workspace state instead of inventing a new task flow.`,
      proofInstruction: isOutputStory
        ? `Story to demonstrate: ${context.story} Open the seeded project workspace for "${projectLabel}", reveal task "${task.title}", and stop on the clearest view of the completed task output.`
        : `Story to demonstrate: ${context.story} Open the seeded workspace for "${projectLabel}", select task "${task.title}", and leave the clearest related task screen visible.`,
      interactionInstruction: isOutputStory
        ? `Story to demonstrate: ${context.story} Keep the seeded task "${task.title}" selected. If the task output is hidden behind a selected project or task row, select those visible items first and then stop once the completed output is legible.`
        : `Story to demonstrate: ${context.story} Keep the seeded task "${task.title}" selected and prefer a stable selected-task view over opening create dialogs.`,
      successChecklist: checklist,
      validationSignals,
      setupPlan: normalizeArray([
        `Open or keep the ${context.targetApp?.label || "Tasks"} app visible.`,
        `Select the project "${projectLabel}" if the UI asks for a project first.`,
        spec?.title ? `Keep the spec "${spec.title}" visible if it appears.` : null,
        `Keep the task "${task.title}" visible.`,
        isOutputStory ? "Stop on the completed task output once it is visible." : null,
      ], 6),
    },
    score: isOutputStory ? 52 : 44,
    matchedKeywords: taskMatch.matchedKeywords,
    fileSignals: context.changedFiles.filter((file) => /\/(tasks|projects)\//i.test(file)),
  };
}

function buildBaselineDebugRunMatches(context) {
  const projectsById = new Map(context.baseline.projects.map((project) => [project.project_id, project]));

  return Object.entries(context.baseline.debugRuns ?? {})
    .flatMap(([projectId, runs]) => {
      const project = projectsById.get(projectId) ?? { project_id: projectId, name: projectId };
      return (Array.isArray(runs) ? runs : []).map((run) => {
        const summary = context.baseline.debugRunSummaries?.[run.run_id]?.markdown ?? "";
        const runLogs = context.baseline.debugRunLogs?.[run.run_id] ?? {};
        const logPreview = Object.values(runLogs)
          .map((value) => String(value || ""))
          .join("\n");
        const taskLabels = Array.isArray(run.tasks)
          ? run.tasks.flatMap((task) => [task.task_id, task.spec_id, task.status])
          : [];
        const counterLabels = run.counters
          ? [
            `${run.counters.llm_calls || 0} llm calls`,
            `${run.counters.iterations || 0} iterations`,
            `${run.counters.blockers || 0} blockers`,
            `${run.counters.retries || 0} retries`,
          ]
          : [];
        const scored = scoreTextValues([
          project.name,
          run.run_id,
          run.status,
          summary,
          logPreview,
          ...taskLabels,
          ...counterLabels,
        ], context.storyTerms);

        if (Array.isArray(run.tasks) && run.tasks.length > 0) {
          scored.score += 4;
        }
        if (/\b(sidekick|inspector|toolbar|copy all|copy filtered|export|llm|blockers|retries|stats|tasks|run detail)\b/i.test(context.story)) {
          scored.score += 8;
        }

        return {
          project,
          run,
          summary,
          score: scored.score,
          matchedKeywords: scored.matchedKeywords,
        };
      });
    })
    .sort((left, right) => right.score - left.score || left.run.run_id.localeCompare(right.run.run_id));
}

function buildDebugExistingPlan(context, runMatch) {
  const { project, run } = runMatch;
  const changedFilesText = context.changedFiles.join(" ");
  const wantsRunDetail = /\b(sidekick|inspector|toolbar|copy all|copy filtered|export|llm|blockers|retries|stats|tasks|log list|run detail)\b/i.test(context.story)
    || /DebugRunDetailView|DebugSidekick/i.test(changedFilesText);
  const startPath = wantsRunDetail
    ? `/debug/${run.project_id}/runs/${run.run_id}`
    : `/debug/${run.project_id}`;
  const toolbarProof = {
    label: "debug run toolbar",
    anyOf: ["Copy all", "Copy filtered", "Export"],
  };
  const sidekickProof = {
    label: "debug sidekick content",
    anyOf: ["Copy JSONL", "Run ID", "Counters"],
  };

  return {
    status: "runtime-ready",
    strategy: "runtime",
    startPath,
    capabilityId: "debug.reuse-seeded-run",
    supportLevel: "full",
    rationale: `The baseline seeded shell already contains a truthful Debug run bundle inside "${project.name}", so the agent can prove Debug UI work without a handwritten scenario or a live backend run.`,
    coverageGaps: [],
    seed: {},
    seededEntities: [
      { type: "project", projectId: project.project_id, name: project.name, source: "baseline" },
      { type: "debug-run", projectId: run.project_id, runId: run.run_id, source: "baseline" },
    ],
    instructionPatch: {
      systemPromptAppend: `A seeded Debug run already exists for project "${project.name}". Prefer that seeded run detail surface over empty states or generic project routes.`,
      proofInstruction: wantsRunDetail
        ? `Story to demonstrate: ${context.story} Open the seeded Debug run in "${project.name}" and stop when the run-detail toolbar plus the sidekick tabs are both clearly visible.`
        : `Story to demonstrate: ${context.story} Open the Debug app for "${project.name}" and stop on the clearest seeded run surface instead of an empty state.`,
      interactionInstruction: wantsRunDetail
        ? `Story to demonstrate: ${context.story} Keep the seeded Debug run selected. Avoid empty states, and stop once Copy all / Copy filtered / Export and the sidekick tabs are visible together.`
        : `Story to demonstrate: ${context.story} Keep the seeded Debug project visible and select the seeded run if the view is still waiting for a concrete run.`,
      successChecklist: normalizeArray([
        "The Debug app is open and stable",
        `The seeded project "${project.name}" is visible in the left navigation`,
        wantsRunDetail ? "A seeded debug run is selected and the Run Detail view is visible" : "A seeded debug project or run is visible",
        wantsRunDetail ? "The header toolbar shows Copy all, Copy filtered, and Export" : null,
        wantsRunDetail ? "The debug sidekick content is visible with run info like Copy JSONL, Run ID, or Counters" : null,
      ], 5),
      validationSignals: normalizeArray([
        "Debug",
        project.name,
        wantsRunDetail ? "Copy all" : null,
        wantsRunDetail ? "Export" : null,
        wantsRunDetail ? "Copy JSONL" : null,
      ], 6),
      proofRequirements: wantsRunDetail ? [toolbarProof, sidekickProof] : [],
      requiredUiSignals: wantsRunDetail ? ["sidekickVisible"] : [],
      setupPlan: normalizeArray([
        "Open or keep the Debug app visible.",
        `Select the seeded project "${project.name}" if the app is waiting on a project.`,
        wantsRunDetail ? "Keep the seeded run detail open instead of stopping on a list or empty state." : "Select the seeded run if one is visible.",
      ], 5),
    },
    score: wantsRunDetail ? 54 : 44,
    matchedKeywords: runMatch.matchedKeywords,
    fileSignals: context.changedFiles.filter((file) => file.toLowerCase().includes("/debug/")),
  };
}

function buildNotesExistingPlan(context, noteMatch) {
  const relPath = noteMatch.relPath;
  const title = noteMatch.title;
  return {
    status: "runtime-ready",
    strategy: "runtime",
    startPath: `/notes/proj-1/${encodeURIComponent(relPath)}`,
    capabilityId: "notes.reuse-seeded-note",
    supportLevel: "full",
    rationale: `The baseline seeded workspace already contains the note "${title}", so the agent can open a truthful proof state without authoring a custom note flow.`,
    coverageGaps: [],
    seed: {},
    seededEntities: [{ type: "note", relPath, title, source: "baseline" }],
    instructionPatch: {
      systemPromptAppend: `A seeded note titled "${title}" already exists in the workspace. Open that same note and keep the editor visible instead of creating a second note.`,
      proofInstruction: `Story to demonstrate: ${context.story} The seeded workspace already contains a note titled "${title}". Open that note and leave its editor visible with the title clearly shown.`,
      interactionInstruction: `Story to demonstrate: ${context.story} Keep the seeded note "${title}" selected. If helpful, click into the editor body or open a visible sidekick tab, but do not create or rename additional notes.`,
      successChecklist: [
        "The Notes app is open and its main panel is visible",
        `The seeded note "${title}" is selected`,
        `The note title "${title}" is clearly visible in the editor`,
        "The note tree or sidekick confirms the same note is open",
      ],
      validationSignals: [title, "Notes", "Editor mode"],
      setupPlan: [
        `Open or keep the Notes app visible.`,
        `Select the seeded note "${title}".`,
      ],
    },
    score: 42,
    matchedKeywords: noteMatch.matchedKeywords,
    fileSignals: context.changedFiles.filter((file) => file.toLowerCase().includes("/notes/")),
  };
}

function buildNotesPreseedPlan(context) {
  const requestedTitle = extractNamedEntity(context.story, { fallback: "Demo Capture Plan" });
  const title = requestedTitle.replace(/\.md$/i, "").trim() || "Demo Capture Plan";
  const relPath = `${title}.md`;
  const note = buildNoteDocument({
    title,
    body: buildStorySummary(context),
    relPath,
  });
  return {
    status: "preseeded",
    strategy: "preseed",
    startPath: `/notes/proj-1/${encodeURIComponent(relPath)}`,
    capabilityId: "notes.preseed-note",
    supportLevel: "full",
    rationale: `The story needs a visible named note, so the planner seeds "${title}" directly instead of hoping a create-note flow lands on a stable proof state.`,
    coverageGaps: [],
    seed: {
      notesTreeAppend: [note.treeNode],
      notesDocuments: {
        [relPath]: note.document,
      },
    },
    seededEntities: [{ type: "note", title, relPath, source: "generated" }],
    instructionPatch: {
      systemPromptAppend: `A note titled "${title}" is already seeded in the workspace. Open that seeded note and leave the editor visible. Do not create a second note.`,
      proofInstruction: `Story to demonstrate: ${context.story} The seeded workspace already contains a note titled "${title}". Open that note and leave the editor visible with the title clearly shown. Do not create another note.`,
      interactionInstruction: `Story to demonstrate: ${context.story} Keep the seeded note "${title}" selected. If helpful, click into the editor body or metadata panel, but do not create or rename additional notes.`,
      successChecklist: [
        "The Notes app is open and its main panel is visible",
        `The seeded note "${title}" is selected`,
        `The note title "${title}" is clearly visible in the editor`,
        "The metadata panel or note tree confirms the same note is open",
      ],
      validationSignals: [title, "Notes", "Editor mode"],
      setupPlan: [
        "Open or keep the Notes app visible on the desktop shell.",
        `Navigate to the seeded note "${title}".`,
      ],
    },
    score: 46,
    matchedKeywords: normalizeArray([title]),
    fileSignals: context.changedFiles.filter((file) => file.toLowerCase().includes("/notes/")),
  };
}

function detectProcessRunOutputIntent(context) {
  const fileEvidenceText = (Array.isArray(context.brief?.changedFileEvidence?.files)
    ? context.brief.changedFileEvidence.files
      .flatMap((fileInfo) => [
        fileInfo?.filePath,
        fileInfo?.surfaceLabel,
        ...(Array.isArray(fileInfo?.componentNames) ? fileInfo.componentNames : []),
      ])
    : []
  ).join(" ");
  const text = [
    context.story,
    context.brief?.title,
    context.brief?.rationale,
    ...(Array.isArray(context.brief?.setupPlan) ? context.brief.setupPlan : []),
    ...(Array.isArray(context.changedFiles) ? context.changedFiles : []),
    fileEvidenceText,
  ].join(" ").toLowerCase();

  const wantsRunSurface = /\b(run|runs|timeline|event|events|node|sidekick|preview)\b/i.test(text);
  const wantsOutputSurface = /\b(output|outputs|task|tasks|live|build|block|blocks|artifact|artifacts)\b/i.test(text);

  return {
    wantsRunSurface,
    wantsOutputSurface,
  };
}

function buildProcessPreseedPlan(context) {
  const requestedName = extractNamedEntity(context.story, { fallback: "Demo Process" }).trim();
  const name = requestedName || "Demo Process";
  const description = buildStorySummary(context);
  const processId = `process-${slugify(name) || "demo-process"}`;
  const processIntent = detectProcessRunOutputIntent(context);
  const shouldSeedRun = processIntent.wantsRunSurface || processIntent.wantsOutputSurface;
  const runId = `run-${slugify(name) || "demo-process"}-proof`;
  const runStartedAt = "2026-03-17T01:20:00.000Z";
  const runCompletedAt = "2026-03-17T01:24:30.000Z";
  const outputText = [
    "Completed Task Output",
    "PASS visual-border-contract",
    "Run timeline rows and task output blocks use the standard block outline.",
  ].join("\n");
  const process = buildProcessRecord({
    id: processId,
    name,
    description,
    createdAt: new Date().toISOString(),
  });
  const starterNode = buildProcessNode({
    processId,
    nodeId: `node-${slugify(name) || "demo"}`,
    label: processIntent.wantsOutputSurface ? "Build Output" : "Starter Step",
    prompt: description,
  });
  const processWithRun = shouldSeedRun
    ? {
        ...process,
        last_run_at: runCompletedAt,
        updated_at: runCompletedAt,
      }
    : process;
  const runDetailRequirement = {
    label: "process run detail",
    anyOf: ["Run Detail", "Node Events", "Events", "Build Output"],
  };
  const outputRequirement = {
    label: "process output block",
    anyOf: ["Completed Task Output", "Output", "Copy output"],
  };
  const proofRequirements = normalizeProofRequirements([
    shouldSeedRun ? runDetailRequirement : null,
    processIntent.wantsOutputSurface ? outputRequirement : null,
  ], 4);
  return {
    status: "preseeded",
    strategy: "preseed",
    startPath: `/process/${processId}`,
    capabilityId: "process.preseed-process",
    supportLevel: "partial",
    rationale: `The process UI is most reliable when a concrete seeded process already exists, so the planner creates "${name}" ahead of capture.`,
    coverageGaps: [],
    seed: {
      processes: [processWithRun],
      processNodes: {
        [processId]: [starterNode],
      },
      processConnections: {
        [processId]: [],
      },
      ...(shouldSeedRun ? {
        processRuns: {
          [processId]: [buildProcessRun({
            processId,
            runId,
            startedAt: runStartedAt,
            completedAt: runCompletedAt,
            output: outputText,
          })],
        },
        processRunEvents: {
          [runId]: [buildProcessEvent({
            processId,
            runId,
            nodeId: starterNode.node_id,
            startedAt: "2026-03-17T01:20:10.000Z",
            completedAt: "2026-03-17T01:23:48.000Z",
            output: outputText,
          })],
        },
      } : {}),
    },
    seededEntities: [
      { type: "process", processId, name, source: "generated" },
      ...(shouldSeedRun ? [{ type: "process-run", processId, runId, label: "Completed Task Output", source: "generated" }] : []),
    ],
    instructionPatch: {
      systemPromptAppend: [
        `A process named "${name}" is already seeded. Open that seeded process and leave its detail surface visible. Do not create another process.`,
        shouldSeedRun ? "A completed seeded run is also available; use it when the story mentions runs, events, tasks, output, blocks, or timeline UI." : null,
      ].filter(Boolean).join(" "),
      proofInstruction: shouldSeedRun
        ? `Story to demonstrate: ${context.story} The seeded environment already contains a process named "${name}" with a completed run. Open that process, keep the Run Detail or Node Events surface visible, and expand the completed event if output text is hidden. Do not create another process.`
        : `Story to demonstrate: ${context.story} The seeded environment already contains a process named "${name}". Open that process and leave its detail or workflow surface visible. Do not create another process.`,
      interactionInstruction: shouldSeedRun
        ? `Story to demonstrate: ${context.story} Keep the seeded process "${name}" selected. If the Run Detail opens, keep it visible. If Node Events are collapsed, expand the completed "${starterNode.label}" event so "Completed Task Output" or "Output" is visible.`
        : `Story to demonstrate: ${context.story} Keep the seeded process "${name}" selected. Prefer showing the process details or canvas state rather than reopening the creation dialog.`,
      successChecklist: normalizeArray([
        "The Processes app is open and its main panel is visible",
        `The seeded process "${name}" is present in the process list`,
        `The process name "${name}" is legible in the UI`,
        shouldSeedRun ? "Run Detail or Node Events are visible in the sidekick" : "The process detail or selected-process sidekick is visible",
        processIntent.wantsOutputSurface ? "Completed Task Output or Output is visible inside a run/event block" : null,
      ], 5),
      validationSignals: normalizeArray([
        name,
        "Process",
        shouldSeedRun ? "Run Detail" : null,
        shouldSeedRun ? "Node Events" : null,
        processIntent.wantsOutputSurface ? "Completed Task Output" : null,
        processIntent.wantsOutputSurface ? "Output" : null,
      ], 8),
      proofRequirements,
      requiredUiSignals: shouldSeedRun ? ["sidekickVisible"] : [],
      forbiddenPhrases: shouldSeedRun ? ["No runs yet", "No events for this run", "No output persisted for this node"] : [],
      setupPlan: normalizeArray([
        "Open or keep the Processes app visible.",
        `Select the seeded process "${name}".`,
        shouldSeedRun ? "Use the sidekick Runs, Events, or Run Detail surface instead of stopping on the blank canvas." : null,
        processIntent.wantsOutputSurface ? `Expand the completed "${starterNode.label}" event if the output block is collapsed.` : null,
      ], 6),
    },
    score: shouldSeedRun ? 54 : 45,
    matchedKeywords: normalizeArray([name]),
    fileSignals: context.changedFiles.filter((file) => file.toLowerCase().includes("/process/")),
  };
}

function buildFeedPreseedPlan(context) {
  const title = clipText(
    extractNamedEntity(context.story, {
      fallback: String(context.changelogDoc?.rendered?.title || "").trim() || context.brief.title || "Launch update",
    }) || String(context.changelogDoc?.rendered?.title || "").trim() || "Launch update",
    84,
  );
  const summary = buildStorySummary(context);
  const eventId = `feed-${slugify(title) || "launch-update"}`;
  const event = buildFeedEvent({
    id: eventId,
    title,
    summary,
    createdAt: new Date().toISOString(),
  });
  const comment = buildFeedComment({
    id: `feed-comment-${slugify(title) || "launch-update"}`,
    eventId,
    content: "This seeded update is ready to be shown in changelog capture mode.",
    createdAt: new Date().toISOString(),
  });
  return {
    status: "preseeded",
    strategy: "preseed",
    startPath: "/desktop",
    capabilityId: "feed.preseed-event",
    supportLevel: "partial",
    rationale: "Feed needs a concrete seeded event and opens most reliably from the desktop shell instead of the placeholder route.",
    coverageGaps: [],
    seed: {
      feedEvents: [event],
      feedComments: {
        [eventId]: [comment],
      },
    },
    seededEntities: [{ type: "feed-event", eventId, title, source: "generated" }],
    instructionPatch: {
      systemPromptAppend: `A feed event titled "${title}" is already seeded. Open the Feed app from the shell and leave that event visible. Use the direct app launcher labeled "Feed" when it is visible. Do not open the generic Apps modal, and do not try to author a new backend event live.`,
      openAppInstruction: `From the desktop shell, click the direct app launcher labeled "Feed" with the visible Feed icon or button label. Do not use a generic apps-management modal unless no direct Feed launcher is visible.`,
      proofInstruction: `Story to demonstrate: ${context.story} The seeded environment already contains a feed event titled "${title}". Open the Feed app, select that event if needed, and stop on the clearest view of the event card or its comments.`,
      interactionInstruction: `Story to demonstrate: ${context.story} If helpful, select the seeded feed event titled "${title}" so its comments or detail sidekick becomes visible. Do not create a second event.`,
      successChecklist: [
        "The Feed app is open and its main panel is visible",
        `A seeded event titled "${title}" is visible in the feed`,
        "The selected feed event or comments sidekick is visible",
        "No empty-state placeholder is blocking the proof screen",
      ],
      validationSignals: [title, "Feed"],
      setupPlan: [
        "Start from the desktop shell.",
        "Open the Feed app from the visible launcher.",
        `Keep the seeded event "${title}" visible.`,
      ],
    },
    score: 47,
    matchedKeywords: normalizeArray([title, "feed"]),
    fileSignals: context.changedFiles.filter((file) => file.toLowerCase().includes("/feed/")),
  };
}

function pickAgentTab(context) {
  if (context.storyIntent.wantsSkills) return "Skills";
  if (context.storyIntent.wantsPermissions) return "Permissions";
  if (context.storyIntent.wantsMemory) return "Memory";
  if (context.storyIntent.wantsProfile) return "Profile";
  if (context.storyIntent.wantsChat) return "Chats";
  return null;
}

function buildAgentExistingPlan(context, agentMatch) {
  const tab = pickAgentTab(context);
  const agent = agentMatch.agent;
  const tabInstruction = tab
    ? `Open the ${tab} tab for "${agent.name}" using visible controls only.`
    : `Keep "${agent.name}" selected and centered in the agent detail view.`;
  const tabSignal = tab ? [tab] : [];
  const tabSpecificSignals =
    tab === "Skills"
      ? ["Installed", "Available"]
      : tab === "Permissions"
        ? ["Capabilities", "Scope"]
        : [];

  return {
    status: "runtime-ready",
    strategy: "runtime",
    startPath: `/agents/${agent.agent_id}`,
    capabilityId: "agents.reuse-seeded-agent",
    supportLevel: "full",
    rationale: `The baseline seeded environment already contains "${agent.name}", so the agent can open a real detail surface instead of inventing a temporary setup flow.`,
    coverageGaps: [],
    seed: {},
    seededEntities: [{ type: "agent", agentId: agent.agent_id, name: agent.name, source: "baseline" }],
    instructionPatch: {
      systemPromptAppend: `A seeded agent named "${agent.name}" already exists. Open that same agent and keep it selected instead of creating another one.`,
      proofInstruction: `Story to demonstrate: ${context.story} The seeded environment already contains an agent named "${agent.name}". Open that agent and stop on the clearest visible proof surface. ${tabInstruction}`,
      interactionInstruction: `Story to demonstrate: ${context.story} Keep "${agent.name}" selected. ${tabInstruction} If a chat or sidekick surface is already visible, keep it stable instead of reopening the agent picker.`,
      successChecklist: normalizeArray([
        "The Agents app is open and stable",
        `"${agent.name}" is selected in the agent list or header`,
        tab ? `The ${tab} tab is visibly active` : "The agent detail or chat surface is clearly visible",
        context.storyIntent.wantsChat ? "A chat transcript or response is visible" : null,
      ], 5),
      validationSignals: normalizeArray([agent.name, ...tabSignal, ...tabSpecificSignals, "Agents"], 8),
      setupPlan: normalizeArray([
        "Open or keep the Agents app visible.",
        `Select the seeded agent "${agent.name}".`,
        tab ? `Switch to the ${tab} tab.` : null,
      ], 4),
    },
    score: context.storyIntent.wantsCreateAgent ? 10 : 44,
    matchedKeywords: agentMatch.matchedKeywords,
    fileSignals: context.changedFiles.filter((file) => file.toLowerCase().includes("/agents/")),
  };
}

function buildFeedbackExistingPlan(context, itemMatch) {
  const item = itemMatch.item;
  const wantsComment = context.storyIntent.wantsComment;

  return {
    status: "runtime-ready",
    strategy: "runtime",
    startPath: "/feedback",
    capabilityId: "feedback.reuse-seeded-item",
    supportLevel: "full",
    rationale: `The baseline seeded board already contains "${item.title}", so the agent can open a truthful feedback thread without needing a handcrafted script.`,
    coverageGaps: [],
    seed: {},
    seededEntities: [{ type: "feedback-item", itemId: item.id, title: item.title, source: "baseline" }],
    instructionPatch: {
      systemPromptAppend: `A seeded feedback item titled "${item.title}" already exists. Open that item and keep the board plus thread visible instead of creating a duplicate.`,
      proofInstruction: `Story to demonstrate: ${context.story} Open the Feedback app, select the seeded item titled "${item.title}", and stop on the clearest proof screen.`,
      interactionInstruction: wantsComment
        ? `Story to demonstrate: ${context.story} Keep the seeded item "${item.title}" selected and, if the comment box is visible, leave the thread ready for a visible comment interaction.`
        : `Story to demonstrate: ${context.story} Keep the seeded item "${item.title}" selected and leave the thread or board detail visible.`,
      successChecklist: [
        "The Feedback app is open and its main panel is visible",
        `A feedback item titled "${item.title}" is visible`,
        `The thread or detail surface for "${item.title}" is visible`,
        wantsComment ? "The comment box is visible" : "The selected item remains legible",
      ],
      validationSignals: normalizeArray([item.title, "Feedback", wantsComment ? "Add a comment" : null], 6),
      setupPlan: [
        "Open or keep the Feedback app visible.",
        `Select the seeded feedback item "${item.title}".`,
      ],
    },
    score: context.storyIntent.wantsCreate ? 18 : wantsComment ? 45 : 40,
    matchedKeywords: itemMatch.matchedKeywords,
    fileSignals: context.changedFiles.filter((file) => file.toLowerCase().includes("/feedback/")),
  };
}

function buildRuntimeBaselinePlan(context) {
  const baseRouteKind = context.targetApp?.sourceContext?.baseRouteKind || "unknown";
  const prefersShellLaunch = baseRouteKind === "placeholder";
  const startPath = prefersShellLaunch ? "/desktop" : context.brief.startPath || context.targetApp?.entryPath || "/desktop";
  const rationale = prefersShellLaunch
    ? `${context.targetApp.label} is most reliable when opened from the seeded desktop shell because its direct route is placeholder-backed.`
    : `The ${context.targetApp.label} app can be explored live against the baseline seeded shell without extra feature-specific setup.`;
  return {
    status: "runtime-ready",
    strategy: "runtime",
    startPath,
    capabilityId: `${context.targetApp.id}.${prefersShellLaunch ? "runtime-shell" : "runtime-direct"}`,
    supportLevel: prefersShellLaunch ? "partial" : "full",
    rationale,
    coverageGaps: prefersShellLaunch
      ? ["Open the app through visible shell controls instead of depending on the placeholder direct route."]
      : [],
    seed: {},
    seededEntities: [],
    instructionPatch: prefersShellLaunch
      ? {
          systemPromptAppend: `Open ${context.targetApp.label} from the seeded desktop shell instead of relying on a direct placeholder route.`,
          openAppInstruction: `From the desktop shell, open ${context.targetApp.label} using a visible launcher, taskbar item, or labeled navigation control. Do not type hidden URLs.`,
          setupPlan: [
            "Start from the desktop shell.",
            `Open ${context.targetApp.label} using visible UI only.`,
          ],
          validationSignals: [context.targetApp.label],
        }
      : {
          setupPlan: [`Open or keep the ${context.targetApp.label} app visible.`],
          validationSignals: [context.targetApp.label],
        },
    score: prefersShellLaunch ? 20 : 28,
    matchedKeywords: normalizeArray(context.targetApp?.keywords ?? [], 6).filter((keyword) => context.storyTerms.has(keyword.toLowerCase())),
    fileSignals: context.changedFiles.filter((file) => file.toLowerCase().includes(`/${context.targetApp.id}/`)),
  };
}

function buildRuntimeCreatePlan(context) {
  const createSignals = context.targetApp?.sourceContext?.createLabels ?? [];
  return {
    status: "runtime-ready",
    strategy: "runtime",
    startPath: context.brief.startPath || context.targetApp?.entryPath || "/desktop",
    capabilityId: `${context.targetApp.id}.runtime-create`,
    supportLevel: "full",
    rationale: `The ${context.targetApp.label} source already exposes visible creation controls, so the agent can demonstrate the story live without predeclared feature scripts.`,
    coverageGaps: [],
    seed: {},
    seededEntities: [],
    instructionPatch: {
      setupPlan: normalizeArray([
        `Open or keep the ${context.targetApp.label} app visible.`,
        createSignals[0] ? `Use the visible "${createSignals[0]}" control to enter the creation flow.` : "Use the first clear create/add/new control you can see.",
      ], 4),
      validationSignals: normalizeArray([
        context.targetApp.label,
        ...createSignals.slice(0, 2),
      ], 5),
    },
    score: 43,
    matchedKeywords: normalizeArray(["create", ...createSignals], 6),
    fileSignals: context.changedFiles.filter((file) => file.toLowerCase().includes(`/${context.targetApp.id}/`)),
  };
}

function buildBaselineFeedbackMatches(context) {
  return context.baseline.feedbackItems
    .map((item) => {
      const comments = context.baseline.feedbackComments[item.id] ?? [];
      const scored = scoreTextValues([
        item.title,
        item.summary,
        item.category,
        item.status,
        ...comments.map((comment) => comment.content),
      ], context.storyTerms);
      return {
        item,
        score: scored.score,
        matchedKeywords: scored.matchedKeywords,
      };
    })
    .sort((left, right) => right.score - left.score || left.item.title.localeCompare(right.item.title));
}

function buildBaselineAgentMatches(context) {
  return context.baseline.agents
    .map((agent) => {
      const events = context.baseline.agentEvents[agent.agent_id] ?? [];
      const capabilityTypes = Array.isArray(agent.permissions?.capabilities)
        ? agent.permissions.capabilities.map((capability) => capability.type)
        : [];
      const scored = scoreTextValues([
        agent.name,
        agent.role,
        agent.personality,
        agent.system_prompt,
        ...(agent.tags ?? []),
        ...capabilityTypes,
        ...events.map((event) => event.content),
      ], context.storyTerms);
      if (context.storyIntent.wantsPermissions && capabilityTypes.length > 0) {
        scored.score += 8;
      }
      if (context.storyIntent.wantsChat && events.length > 0) {
        scored.score += 6;
      }
      return {
        agent,
        score: scored.score,
        matchedKeywords: scored.matchedKeywords,
      };
    })
    .sort((left, right) => right.score - left.score || left.agent.name.localeCompare(right.agent.name));
}

function buildBaselineNoteMatches(context) {
  return Object.entries(context.baseline.notesDocuments)
    .map(([relPath, document]) => {
      const title = String(document?.title || relPath.replace(/\.md$/i, "")).trim();
      const scored = scoreTextValues([title, relPath, document?.content], context.storyTerms);
      return {
        relPath,
        title,
        score: scored.score,
        matchedKeywords: scored.matchedKeywords,
      };
    })
    .sort((left, right) => right.score - left.score || left.title.localeCompare(right.title));
}

function buildSeedCandidates(context) {
  const candidates = [];
  const appId = context.targetApp?.id;
  const baseRuntime = buildRuntimeBaselinePlan(context);
  candidates.push(baseRuntime);

  if (appId === "feedback") {
    const bestItem = buildBaselineFeedbackMatches(context)[0] ?? null;
    if (bestItem) {
      candidates.push(buildFeedbackExistingPlan(context, bestItem));
    }
    if (context.storyIntent.wantsCreate && (context.targetApp?.sourceContext?.createLabels?.length ?? 0) > 0) {
      candidates.push(buildRuntimeCreatePlan(context));
    }
  } else if (appId === "agents") {
    const bestAgent = buildBaselineAgentMatches(context)[0] ?? null;
    if (bestAgent) {
      candidates.push(buildAgentExistingPlan(context, bestAgent));
    }
    if (context.storyIntent.wantsCreateAgent && (context.targetApp?.sourceContext?.createLabels?.length ?? 0) > 0) {
      const createPlan = buildRuntimeCreatePlan(context);
      createPlan.capabilityId = "agents.runtime-create-agent";
      createPlan.score = 46;
      candidates.push(createPlan);
    }
  } else if (appId === "notes") {
    const bestNote = buildBaselineNoteMatches(context)[0] ?? null;
    if (bestNote && !context.storyIntent.wantsCreate) {
      candidates.push(buildNotesExistingPlan(context, bestNote));
    }
    if (context.storyIntent.wantsCreate || context.storyIntent.wantsNamedEntity || !bestNote) {
      candidates.push(buildNotesPreseedPlan(context));
    }
  } else if (appId === "tasks" || appId === "projects") {
    const bestTask = buildBaselineTaskMatches(context)[0] ?? null;
    if (bestTask) {
      candidates.push(buildTaskExistingPlan(context, bestTask));
    }
  } else if (appId === "debug") {
    const bestRun = buildBaselineDebugRunMatches(context)[0] ?? null;
    if (bestRun) {
      candidates.push(buildDebugExistingPlan(context, bestRun));
    }
  } else if (appId === "process") {
    candidates.push(buildProcessPreseedPlan(context));
  } else if (appId === "feed") {
    candidates.push(buildFeedPreseedPlan(context));
  }

  return candidates
    .map((candidate) => {
      let score = candidate.score;

      if (context.storyIntent.wantsCreate && candidate.capabilityId.includes("runtime-create")) {
        score += 6;
      }
      if (!context.storyIntent.wantsCreate && candidate.capabilityId.includes("reuse-seeded")) {
        score += 5;
      }
      if (context.storyIntent.wantsNamedEntity && candidate.capabilityId.includes("preseed")) {
        score += 4;
      }
      if (context.targetApp?.sourceContext?.baseRouteKind === "placeholder" && candidate.startPath === "/desktop") {
        score += 4;
      }

      return {
        ...candidate,
        score,
      };
    })
    .sort((left, right) => right.score - left.score || left.capabilityId.localeCompare(right.capabilityId));
}

export async function buildDemoSeedPlan({
  brief,
  prompt = "",
  changelogDoc = null,
  changedFiles = [],
} = {}) {
  const apps = await listDemoAgentApps();
  const targetApp = apps.find((app) => app.id === brief?.targetAppId) ?? null;
  const baselineProfile = getDemoScreenshotProfile("agent-shell-explorer");
  const story = String(brief?.story || prompt || changelogDoc?.rendered?.title || "").trim();
  const storyTerms = tokenize([
    story,
    ...(Array.isArray(changelogDoc?.rendered?.highlights) ? changelogDoc.rendered.highlights : []),
    ...(Array.isArray(brief?.setupPlan) ? brief.setupPlan : []),
    ...(Array.isArray(brief?.validationSignals) ? brief.validationSignals : []),
  ]);

  if (!targetApp) {
    return {
      status: "unplanned",
      strategy: "runtime",
      startPath: brief?.startPath || "/desktop",
      capabilityId: null,
      supportLevel: "unknown",
      rationale: "No matching target app was inferred, so the baseline seeded shell will be used without extra planning.",
      coverageGaps: ["No target app match"],
      seed: {},
      seededEntities: [],
      instructionPatch: {},
      scoredCapabilities: [],
    };
  }

  const context = {
    brief,
    prompt,
    changelogDoc,
    changedFiles,
    story,
    storyTerms,
    storyIntent: detectStoryIntent(story, brief),
    targetApp,
    baseline: extractBaselineWorld(baselineProfile),
  };

  const candidates = buildSeedCandidates(context);
  const primary = candidates[0];

  return {
    status: primary.status,
    strategy: primary.strategy,
    startPath: primary.startPath,
    capabilityId: primary.capabilityId,
    supportLevel: primary.supportLevel,
    rationale: primary.rationale,
    coverageGaps: primary.coverageGaps,
    seed: primary.seed,
    seededEntities: primary.seededEntities,
    instructionPatch: primary.instructionPatch,
    scoredCapabilities: candidates.map((candidate) => ({
      capabilityId: candidate.capabilityId,
      appId: targetApp.id,
      score: candidate.score,
      matchedKeywords: normalizeArray(candidate.matchedKeywords),
      fileSignals: normalizeArray(candidate.fileSignals, 5),
      reasons: normalizeArray([
        candidate.rationale,
        ...(candidate.coverageGaps ?? []),
      ], 4),
    })),
  };
}

function normalizeProofRequirements(entries, limit = 8) {
  return (Array.isArray(entries) ? entries : [])
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }
      const anyOf = normalizeArray(entry.anyOf ?? entry.signals ?? [], 4);
      if (anyOf.length === 0) {
        return null;
      }
      return {
        label: clipText(String(entry.label || anyOf[0] || "").trim(), 80),
        anyOf,
      };
    })
    .filter(Boolean)
    .slice(0, limit);
}

function mergeProofRequirements(entries, limit = 8) {
  const mergedByLabel = new Map();
  for (const entry of normalizeProofRequirements(entries, 40)) {
    const key = normalizeTextForMatch(entry.label || entry.anyOf[0]);
    if (!key) {
      continue;
    }
    const current = mergedByLabel.get(key);
    mergedByLabel.set(key, current
      ? {
          ...current,
          anyOf: normalizeArray([...current.anyOf, ...entry.anyOf], 4),
        }
      : entry);
  }
  return Array.from(mergedByLabel.values()).slice(0, limit);
}

function extractSeedEntityLabel(entity) {
  if (!entity || typeof entity !== "object") {
    return "";
  }

  return clipText(
    String(
      entity.title
      || entity.name
      || entity.label
      || entity.tab
      || entity.section
      || entity.relPath?.split("/")?.pop()?.replace(/\.md$/i, "")
      || ""
    ).trim(),
    60,
  );
}

function deriveSeedPlanValidationSignals(seedPlan) {
  return normalizeArray([
    ...(Array.isArray(seedPlan?.instructionPatch?.validationSignals) ? seedPlan.instructionPatch.validationSignals : []),
    ...(Array.isArray(seedPlan?.seededEntities) ? seedPlan.seededEntities.map(extractSeedEntityLabel) : []),
  ], 10);
}

function deriveSeedPlanProofRequirements(seedPlan) {
  const explicit = normalizeProofRequirements(seedPlan?.instructionPatch?.proofRequirements, 8);
  if (explicit.length > 0) {
    return explicit;
  }

  const derived = (Array.isArray(seedPlan?.seededEntities) ? seedPlan.seededEntities : [])
    .map((entity) => {
      const label = extractSeedEntityLabel(entity);
      if (!label) {
        return null;
      }
      const typeLabel = String(entity.type || "item").replace(/[-_]+/g, " ");
      return {
        label: `seeded ${typeLabel}`,
        anyOf: [label],
      };
    })
    .filter(Boolean);

  return normalizeProofRequirements([...explicit, ...derived], 8);
}

export function applyDemoSeedPlanToBrief(brief, seedPlan) {
  if (!seedPlan || !brief) {
    return brief;
  }

  const checklist = Array.isArray(seedPlan.instructionPatch?.successChecklist) && seedPlan.instructionPatch.successChecklist.length > 0
    ? seedPlan.instructionPatch.successChecklist
    : brief.successChecklist;

  return {
    ...brief,
    startPath: seedPlan.startPath || brief.startPath,
    successChecklist: checklist,
    setupPlan: normalizeArray([
      ...(Array.isArray(brief.setupPlan) ? brief.setupPlan : []),
      ...(Array.isArray(seedPlan.instructionPatch?.setupPlan) ? seedPlan.instructionPatch.setupPlan : []),
    ], 8),
    validationSignals: normalizeArray([
      ...deriveSeedPlanValidationSignals(seedPlan),
      ...(Array.isArray(brief.validationSignals) ? brief.validationSignals : []),
    ], 10),
    proofRequirements: mergeProofRequirements([
      ...(Array.isArray(brief.proofRequirements) ? brief.proofRequirements : []),
      ...deriveSeedPlanProofRequirements(seedPlan),
    ], 8),
    requiredUiSignals: normalizeArray([
      ...(Array.isArray(brief.requiredUiSignals) ? brief.requiredUiSignals : []),
      ...(Array.isArray(seedPlan.instructionPatch?.requiredUiSignals) ? seedPlan.instructionPatch.requiredUiSignals : []),
    ], 6),
    forbiddenPhrases: normalizeArray([
      ...(Array.isArray(brief.forbiddenPhrases) ? brief.forbiddenPhrases : []),
      ...(Array.isArray(seedPlan.instructionPatch?.forbiddenPhrases) ? seedPlan.instructionPatch.forbiddenPhrases : []),
    ], 8),
    systemPrompt: [
      brief.systemPrompt,
      seedPlan.instructionPatch?.systemPromptAppend || "",
    ].filter(Boolean).join(" "),
    openAppInstruction: seedPlan.instructionPatch?.openAppInstruction || brief.openAppInstruction,
    proofInstruction: seedPlan.instructionPatch?.proofInstruction || brief.proofInstruction,
    interactionInstruction: seedPlan.instructionPatch?.interactionInstruction || brief.interactionInstruction,
  };
}
