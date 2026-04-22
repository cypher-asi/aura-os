function createFeedbackItem({
  id,
  title,
  body,
  category,
  status,
  product,
  createdAt,
  commentCount = 0,
  upvotes = 0,
  downvotes = 0,
  viewerVote = "none",
  authorName = "Test User",
}) {
  return {
    id,
    profileId: "profile-1",
    eventType: "feedback",
    postType: "feedback",
    title,
    summary: body,
    metadata: null,
    category,
    status,
    product,
    createdAt,
    commentCount,
    upvotes,
    downvotes,
    voteScore: upvotes - downvotes,
    viewerVote,
    authorName,
    authorAvatar: null,
  };
}

function createFeedbackComment({
  id,
  itemId,
  content,
  createdAt,
  authorName = "Test User",
}) {
  return {
    id,
    activityEventId: itemId,
    profileId: "profile-1",
    content,
    createdAt,
    authorName,
    authorAvatar: null,
  };
}

function createNotesComment({
  id,
  authorId = "user-1",
  authorName = "Test User",
  body,
  createdAt,
}) {
  return {
    id,
    authorId,
    authorName,
    body,
    createdAt,
  };
}

function createAgent({
  id,
  name,
  role,
  personality,
  systemPrompt,
  createdAt,
  updatedAt = createdAt,
  tags = [],
  isPinned = false,
  permissions = { scope: { orgs: [], projects: [], agent_ids: [] }, capabilities: [] },
}) {
  return {
    agent_id: id,
    user_id: "user-1",
    org_id: "org-1",
    name,
    role,
    personality,
    system_prompt: systemPrompt,
    skills: [],
    icon: null,
    machine_type: "local",
    adapter_type: "aura_harness",
    environment: "local_host",
    auth_source: "aura_managed",
    integration_id: null,
    default_model: null,
    profile_id: "profile-1",
    tags,
    is_pinned: isPinned,
    listing_status: "closed",
    permissions,
    created_at: createdAt,
    updated_at: updatedAt,
  };
}

function createAgentEvent({
  id,
  agentId,
  role,
  content,
  createdAt,
}) {
  return {
    event_id: id,
    agent_instance_id: `standalone-${agentId}`,
    project_id: "proj-1",
    role,
    content,
    created_at: createdAt,
  };
}

function createSession() {
  return {
    user_id: "user-1",
    network_user_id: "user-1",
    profile_id: "profile-1",
    display_name: "Test User",
    profile_image: "",
    primary_zid: "0://test-user",
    zero_wallet: "0x123",
    wallets: ["0x123"],
    is_zero_pro: true,
    is_access_granted: true,
    access_token: "mock-access-token",
    created_at: "2026-03-17T01:00:00.000Z",
    validated_at: "2026-03-17T01:00:00.000Z",
  };
}

function createCommonSeed() {
  const notesRoot = "/Users/demo/workspaces/Demo Project";
  const ceoPermissions = {
    scope: {
      orgs: ["org-1"],
      projects: ["proj-1"],
      agent_ids: [],
    },
    capabilities: [
      { type: "spawnAgent" },
      { type: "controlAgent" },
      { type: "readAgent" },
      { type: "manageOrgMembers" },
      { type: "manageBilling" },
      { type: "invokeProcess" },
      { type: "postToFeed" },
      { type: "generateMedia" },
      { type: "readProject", id: "proj-1" },
      { type: "writeProject", id: "proj-1" },
    ],
  };

  return {
    orgs: [
      {
        org_id: "org-1",
        name: "Test Org",
        owner_user_id: "user-1",
        billing: null,
        github: null,
        created_at: "2026-03-17T01:00:00.000Z",
        updated_at: "2026-03-17T01:00:00.000Z",
      },
    ],
    projects: [
      {
        project_id: "proj-1",
        org_id: "org-1",
        name: "Demo Project",
        description: "Parity test project",
        current_status: "active",
        created_at: "2026-03-17T01:00:00.000Z",
        updated_at: "2026-03-17T01:00:00.000Z",
      },
    ],
    feedbackItems: [
      createFeedbackItem({
        id: "fb-1",
        title: "Ship the feedback board with visible comments",
        body: "Let teams post ideas, vote on them, and keep the discussion visible in the sidekick.",
        category: "feature_request",
        status: "in_progress",
        product: "aura",
        createdAt: "2026-03-17T01:02:00.000Z",
        commentCount: 2,
        upvotes: 12,
        downvotes: 1,
        authorName: "Shahroz",
      }),
      createFeedbackItem({
        id: "fb-2",
        title: "Polish changelog video approvals",
        body: "Add better approval flow so release videos can be reviewed before publishing.",
        category: "ui_ux",
        status: "in_review",
        product: "aura",
        createdAt: "2026-03-17T01:07:00.000Z",
        commentCount: 1,
        upvotes: 7,
        downvotes: 0,
        authorName: "Launch Team",
      }),
    ],
    feedbackComments: {
      "fb-1": [
        createFeedbackComment({
          id: "fb-comment-1",
          itemId: "fb-1",
          content: "The sidekick thread makes the board feel collaborative instead of flat.",
          createdAt: "2026-03-17T01:03:00.000Z",
          authorName: "Design Team",
        }),
        createFeedbackComment({
          id: "fb-comment-2",
          itemId: "fb-1",
          content: "We should make sure the demo capture shows voting and comments in one pass.",
          createdAt: "2026-03-17T01:05:00.000Z",
          authorName: "Product",
        }),
      ],
      "fb-2": [
        createFeedbackComment({
          id: "fb-comment-3",
          itemId: "fb-2",
          content: "A quick approve-or-hold step would make release content much safer.",
          createdAt: "2026-03-17T01:08:00.000Z",
          authorName: "Ops",
        }),
      ],
    },
    notesTree: [
      {
        kind: "folder",
        name: "Release",
        relPath: "Release",
        children: [
          {
            kind: "note",
            name: "Feedback rollout.md",
            relPath: "Release/Feedback rollout.md",
            title: "Feedback rollout",
            absPath: `${notesRoot}/Release/Feedback rollout.md`,
            updatedAt: "2026-03-17T01:10:00.000Z",
          },
        ],
      },
      {
        kind: "note",
        name: "Roadmap recap.md",
        relPath: "Roadmap recap.md",
        title: "Roadmap recap",
        absPath: `${notesRoot}/Roadmap recap.md`,
        updatedAt: "2026-03-17T01:12:00.000Z",
      },
    ],
    notesRoot,
    notesDocuments: {
      "Release/Feedback rollout.md": {
        content: [
          "---",
          'created_at: "2026-03-17T01:10:00.000Z"',
          'created_by: "Test User"',
          "---",
          "",
          "# Feedback rollout",
          "",
          "## Goal",
          "",
          "Show the feedback board, the discussion thread, and the approval state in one pass.",
          "",
          "## Proof points",
          "",
          "- Visible board with status",
          "- Threaded comments in the sidekick",
          "- Fast approval loop for release content",
        ].join("\n"),
        title: "Feedback rollout",
        frontmatter: {
          created_at: "2026-03-17T01:10:00.000Z",
          created_by: "Test User",
          updated_at: "2026-03-17T01:10:00.000Z",
        },
        absPath: `${notesRoot}/Release/Feedback rollout.md`,
        updatedAt: "2026-03-17T01:10:00.000Z",
      },
      "Roadmap recap.md": {
        content: [
          "# Roadmap recap",
          "",
          "## Desktop",
          "",
          "Self-healing loopback and updater controls.",
          "",
          "## Sidekick",
          "",
          "Inline rename and stronger placeholders.",
        ].join("\n"),
        title: "Roadmap recap",
        frontmatter: {
          created_at: "2026-03-17T01:12:00.000Z",
          created_by: "Test User",
          updated_at: "2026-03-17T01:12:00.000Z",
        },
        absPath: `${notesRoot}/Roadmap recap.md`,
        updatedAt: "2026-03-17T01:12:00.000Z",
      },
    },
    notesComments: {
      "Release/Feedback rollout.md": [
        createNotesComment({
          id: "note-comment-1",
          authorName: "Launch Team",
          body: "This makes the release story much easier to explain visually.",
          createdAt: "2026-03-17T01:13:00.000Z",
        }),
      ],
    },
    agents: [
      createAgent({
        id: "agent-ceo",
        name: "Aura CEO",
        role: "CEO SuperAgent",
        personality: "Decisive, calm, and deeply aware of the product surface.",
        systemPrompt: "Coordinate Aura workflows and keep teams moving.",
        createdAt: "2026-03-17T00:58:00.000Z",
        updatedAt: "2026-03-17T01:16:00.000Z",
        tags: ["super_agent"],
        isPinned: true,
        permissions: ceoPermissions,
      }),
      createAgent({
        id: "agent-research-pilot",
        name: "Research Pilot",
        role: "Product Researcher",
        personality: "Curious, crisp, and great at turning scattered notes into structured insights.",
        systemPrompt: "Study product signals, synthesize findings, and propose next steps.",
        createdAt: "2026-03-17T01:01:00.000Z",
        updatedAt: "2026-03-17T01:14:00.000Z",
      }),
      createAgent({
        id: "agent-launch-copy",
        name: "Launch Copywriter",
        role: "Launch Writer",
        personality: "Clear, energetic, and focused on release narratives that are easy to skim.",
        systemPrompt: "Draft launch copy, changelog summaries, and product storytelling assets.",
        createdAt: "2026-03-17T01:04:00.000Z",
        updatedAt: "2026-03-17T01:11:00.000Z",
      }),
    ],
    agentEvents: {
      "agent-ceo": [
        createAgentEvent({
          id: "agent-event-1",
          agentId: "agent-ceo",
          role: "user",
          content: "Give me a quick launch status check.",
          createdAt: "2026-03-17T01:15:00.000Z",
        }),
        createAgentEvent({
          id: "agent-event-2",
          agentId: "agent-ceo",
          role: "assistant",
          content: "Feedback board is ready, notes are seeded, and the demo capture pipeline is green for screenshot runs.",
          createdAt: "2026-03-17T01:16:00.000Z",
        }),
      ],
      "agent-research-pilot": [
        createAgentEvent({
          id: "agent-event-3",
          agentId: "agent-research-pilot",
          role: "user",
          content: "What did the latest feedback say about release storytelling?",
          createdAt: "2026-03-17T01:12:00.000Z",
        }),
        createAgentEvent({
          id: "agent-event-4",
          agentId: "agent-research-pilot",
          role: "assistant",
          content: "People want visible proof, less manual recording, and a smoother path from feature story to polished changelog assets.",
          createdAt: "2026-03-17T01:14:00.000Z",
        }),
      ],
      "agent-launch-copy": [
        createAgentEvent({
          id: "agent-event-5",
          agentId: "agent-launch-copy",
          role: "assistant",
          content: "I can turn a feature brief into launch-ready copy, changelog bullets, and short demo captions.",
          createdAt: "2026-03-17T01:11:00.000Z",
        }),
      ],
    },
    agentProjectBindings: {
      "agent-research-pilot": [
        {
          project_agent_id: "proj-agent-1",
          project_id: "proj-1",
          project_name: "Demo Project",
        },
      ],
      "agent-launch-copy": [
        {
          project_agent_id: "proj-agent-2",
          project_id: "proj-1",
          project_name: "Demo Project",
        },
      ],
    },
    specs: [
      {
        spec_id: "spec-1",
        project_id: "proj-1",
        title: "Stabilize completed task output",
        order_index: 1,
        markdown_contents: [
          "# Stabilize completed task output",
          "",
          "Keep completed run output visible after reloads and remounts.",
          "",
          "- Rehydrate structured task output from cache",
          "- Keep the final run text visible while the stream catches up",
        ].join("\n"),
        created_at: "2026-03-17T01:17:00.000Z",
        updated_at: "2026-03-17T01:17:00.000Z",
      },
    ],
    tasks: [
      {
        task_id: "task-1",
        project_id: "proj-1",
        spec_id: "spec-1",
        title: "Test task",
        description: "Verify that completed task output survives remounts and reloads.",
        status: "done",
        order_index: 1,
        dependency_ids: [],
        parent_task_id: null,
        assigned_agent_instance_id: "proj-agent-1",
        completed_by_agent_instance_id: "proj-agent-1",
        session_id: null,
        execution_notes: "Completed task output remained visible after the seeded reload sequence.",
        files_changed: [
          {
            op: "update",
            path: "interface/src/components/TaskOutputPanel/CompletedTaskOutput.tsx",
            lines_added: 18,
            lines_removed: 4,
          },
        ],
        live_output: "",
        build_steps: [
          {
            kind: "build",
            command: "npm run build",
            stdout: "Build completed successfully.",
            attempt: 1,
          },
        ],
        test_steps: [
          {
            kind: "test",
            command: "npm test -- CompletedTaskOutput",
            stdout: "PASS CompletedTaskOutput",
            attempt: 1,
            tests: [
              {
                name: "rehydrates cached completed output",
                status: "passed",
              },
            ],
            summary: "1 passed",
          },
        ],
        total_input_tokens: 1280,
        total_output_tokens: 412,
        created_at: "2026-03-17T01:18:00.000Z",
        updated_at: "2026-03-17T01:19:00.000Z",
      },
    ],
    taskOutputs: {
      "task-1": {
        output: [
          "Completed Task Output",
          "",
          "Test task",
          "",
          "Completed output stays visible after reload and remount.",
          "Cached session timeline restored from local storage successfully.",
        ].join("\n"),
        build_steps: [
          {
            kind: "build",
            command: "npm run build",
            stdout: "Build completed successfully.",
            attempt: 1,
          },
        ],
        test_steps: [
          {
            kind: "test",
            command: "npm test -- CompletedTaskOutput",
            stdout: "PASS CompletedTaskOutput",
            attempt: 1,
            tests: [
              {
                name: "rehydrates cached completed output",
                status: "passed",
              },
            ],
            summary: "1 passed",
          },
        ],
      },
    },
    feedEvents: [],
    feedComments: {},
    processes: [],
    processFolders: [],
    processNodes: {},
    processConnections: {},
    processRuns: {},
    processRunEvents: {},
  };
}

function createFeedbackSteps() {
  return [
    {
      id: "board",
      title: "Feedback board",
      summary: "Open the seeded feedback board with visible ideas.",
      assertions: [
        { type: "title", value: "Post a new idea" },
        { type: "role", role: "article", hasText: "Ship the feedback board with visible comments" },
      ],
      screenshot: {
        path: "01-feedback-board.png",
        targets: [{ type: "css", value: '[data-demo-shot="feedback-board-list"]' }],
        padding: 24,
      },
    },
    {
      id: "thread",
      title: "Feedback detail thread",
      summary: "Open the seeded feedback thread from the board.",
      actions: [
        {
          type: "script",
          code: "({ itemId }) => window.__AURA_SCREENSHOT_BRIDGE__?.selectFeedbackItem?.(itemId)",
          args: { itemId: "fb-1" },
        },
      ],
      assertionsAfter: [
        { type: "role", role: "button", name: "Close feedback detail" },
        { type: "role", role: "textbox", name: "Add a comment" },
      ],
      screenshot: {
        path: "02-feedback-thread.png",
        targets: [
          { type: "css", value: '[data-demo-shot="feedback-selected-card"]' },
          { type: "css", value: '[data-demo-shot="feedback-sidekick-header"]' },
          { type: "css", value: '[data-demo-shot="feedback-thread-comments"]' },
        ],
        padding: 20,
      },
    },
    {
      id: "comment",
      title: "Commented thread",
      summary: "Add a visible comment to prove the seeded session can demonstrate interaction and output.",
      actions: [
        {
          type: "script",
          code: "({ itemId, text }) => window.__AURA_SCREENSHOT_BRIDGE__?.addFeedbackComment?.(itemId, text)",
          args: {
            itemId: "fb-1",
            text: "This seeded thread proves the screenshot harness can show real collaboration.",
          },
        },
      ],
      assertions: [
        { type: "role", role: "button", name: "Close feedback detail" },
        { type: "role", role: "textbox", name: "Add a comment" },
      ],
      assertionsAfter: [
        { type: "text", value: "This seeded thread proves the screenshot harness can show real collaboration.", exact: true },
      ],
      screenshot: {
        path: "03-feedback-comment.png",
        targets: [
          { type: "css", value: '[data-demo-shot="feedback-selected-card"]' },
          { type: "css", value: '[data-demo-shot="feedback-sidekick-header"]' },
          { type: "css", value: '[data-demo-shot="feedback-thread-comments"]' },
        ],
        padding: 20,
      },
    },
  ];
}

function createProfile({
  id,
  title,
  description,
  entryPath,
  match,
  mode = "seeded-demo",
  steps = [],
}) {
  return {
    id,
    title,
    description,
    match,
    mode,
    authMode: "bootstrapped-demo-session",
    dataMode: "seeded-api-routes",
    entryPath,
    viewport: {
      width: 1600,
      height: 1000,
    },
    session: createSession(),
    seed: createCommonSeed(),
    steps,
  };
}

export const DEMO_SCREENSHOT_PROFILES = [
  createProfile({
    id: "agent-shell-explorer",
    title: "Agent-first seeded shell explorer",
    description: "Boot a seeded desktop shell with enough fake data for an agent to discover apps and capture a feature screenshot without a hand-authored scenario.",
    entryPath: "/desktop",
    mode: "seeded-agent-demo",
    match: {
      keywords: [
        "desktop",
        "shell",
        "feedback",
        "notes",
        "sidekick",
        "app",
        "taskbar",
        "comment",
        "approval",
        "toc",
        "editor",
      ],
      areas: ["Interface", "Desktop"],
    },
  }),
  createProfile({
    id: "feedback-thread-proof",
    title: "Feedback board and discussion thread",
    description: "Boot a seeded demo session, open the feedback board, and show a threaded discussion with a new visible comment.",
    entryPath: "/feedback",
    match: {
      keywords: [
        "feedback",
        "board",
        "thread",
        "discussion",
        "comment",
        "comments",
        "ideas",
        "idea",
        "vote",
        "votes",
        "sidekick",
        "collaboration",
        "review",
        "approval",
      ],
      areas: ["Interface", "Desktop"],
    },
    steps: createFeedbackSteps(),
  }),
];

export function getDemoScreenshotProfile(profileId) {
  const profile = DEMO_SCREENSHOT_PROFILES.find((entry) => entry.id === profileId);
  if (!profile) {
    throw new Error(`Unknown screenshot profile ${profileId}`);
  }
  return structuredClone(profile);
}

export function listDemoScreenshotProfiles() {
  return DEMO_SCREENSHOT_PROFILES.map((profile) => ({
    id: profile.id,
    title: profile.title,
    description: profile.description,
    mode: profile.mode ?? "seeded-demo",
    match: structuredClone(profile.match ?? { keywords: [], areas: [] }),
    steps: Array.isArray(profile.steps)
      ? profile.steps.map((step) => ({
        id: step.id,
        title: step.title,
        summary: step.summary,
      }))
      : [],
  }));
}

function mergeArrayEntries(base, patch) {
  return [...(Array.isArray(base) ? structuredClone(base) : []), ...(Array.isArray(patch) ? structuredClone(patch) : [])];
}

function mergeRecordEntries(base, patch) {
  return {
    ...(base && typeof base === "object" ? structuredClone(base) : {}),
    ...(patch && typeof patch === "object" ? structuredClone(patch) : {}),
  };
}

export function applyDemoSeedPatch(profile, patch = {}) {
  const next = structuredClone(profile);
  next.seed ??= {};
  const seedPatch = patch.seed && typeof patch.seed === "object" ? patch.seed : {};

  next.seed.orgs = mergeArrayEntries(next.seed.orgs, seedPatch.orgs);
  next.seed.projects = mergeArrayEntries(next.seed.projects, seedPatch.projects);
  next.seed.feedbackItems = mergeArrayEntries(next.seed.feedbackItems, seedPatch.feedbackItems);
  next.seed.feedbackComments = mergeRecordEntries(next.seed.feedbackComments, seedPatch.feedbackComments);
  next.seed.notesTree = mergeArrayEntries(next.seed.notesTree, seedPatch.notesTreeAppend ?? seedPatch.notesTree);
  next.seed.notesDocuments = mergeRecordEntries(next.seed.notesDocuments, seedPatch.notesDocuments);
  next.seed.notesComments = mergeRecordEntries(next.seed.notesComments, seedPatch.notesComments);
  next.seed.agents = mergeArrayEntries(next.seed.agents, seedPatch.agents);
  next.seed.agentEvents = mergeRecordEntries(next.seed.agentEvents, seedPatch.agentEvents);
  next.seed.agentProjectBindings = mergeRecordEntries(next.seed.agentProjectBindings, seedPatch.agentProjectBindings);
  next.seed.specs = mergeArrayEntries(next.seed.specs, seedPatch.specs);
  next.seed.tasks = mergeArrayEntries(next.seed.tasks, seedPatch.tasks);
  next.seed.taskOutputs = mergeRecordEntries(next.seed.taskOutputs, seedPatch.taskOutputs);
  next.seed.feedEvents = mergeArrayEntries(next.seed.feedEvents, seedPatch.feedEvents);
  next.seed.feedComments = mergeRecordEntries(next.seed.feedComments, seedPatch.feedComments);
  next.seed.processes = mergeArrayEntries(next.seed.processes, seedPatch.processes);
  next.seed.processFolders = mergeArrayEntries(next.seed.processFolders, seedPatch.processFolders);
  next.seed.processNodes = mergeRecordEntries(next.seed.processNodes, seedPatch.processNodes);
  next.seed.processConnections = mergeRecordEntries(next.seed.processConnections, seedPatch.processConnections);
  next.seed.processRuns = mergeRecordEntries(next.seed.processRuns, seedPatch.processRuns);
  next.seed.processRunEvents = mergeRecordEntries(next.seed.processRunEvents, seedPatch.processRunEvents);

  if (typeof patch.startPath === "string" && patch.startPath.trim()) {
    next.entryPath = patch.startPath.trim();
  }

  return next;
}
