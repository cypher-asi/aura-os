import assert from "node:assert/strict";
import test from "node:test";

import {
  buildMediaPlannerPrompt,
  deriveVisualMediaOpportunities,
  deriveVisualMediaSurfaceClusters,
  extractChangelogMediaEntries,
  normalizeMediaPlan,
  parseAnthropicMediaPlanResponse,
  planChangelogMediaWithAnthropic,
  validateMediaPlanCoverage,
} from "./changelog-media-planner.mjs";
import { loadChangelogMediaKnowledge } from "./changelog-media-knowledge.mjs";

test("extractChangelogMediaEntries normalizes generated changelog entries", () => {
  const entries = extractChangelogMediaEntries({
    rendered: {
      entries: [
        {
          batch_id: "entry-1",
          title: "GPT-5.5 available in the chat model picker",
          summary: "Users can select GPT-5.5 from the chat composer.",
          items: [
            {
              text: "Model picker includes GPT-5.5.",
              commit_shas: ["abc123"],
              changed_files: ["interface/src/apps/agents/components/AgentChat/ChatInputBar.tsx"],
            },
          ],
        },
      ],
    },
  });

  assert.equal(entries.length, 1);
  assert.equal(entries[0].entryId, "entry-1");
  assert.equal(entries[0].changedFiles[0], "interface/src/apps/agents/components/AgentChat/ChatInputBar.tsx");
});

test("buildMediaPlannerPrompt keeps Browser Use behind a conservative Anthropic filter", () => {
  const prompt = buildMediaPlannerPrompt({
    changelogEntries: [{ entryId: "entry-1", title: "Add Android release metadata" }],
    sitemap: { apps: [{ id: "agents", path: "/agents" }] },
    learnedKnowledge: loadChangelogMediaKnowledge(),
    commitLog: "abc123 Add Android release metadata",
    changedFiles: ["interface/android/app/src/main/AndroidManifest.xml"],
  });

  assert.match(prompt, /before any browser automation runs/);
  assert.match(prompt, /mobile-only/);
  assert.match(prompt, /Skip login, auth, sign-in/);
  assert.match(prompt, /targetAppId and targetPath from the sitemap/);
  assert.match(prompt, /Every changelog entry must appear exactly once/);
  assert.match(prompt, /mixes a visible desktop product feature/);
  assert.match(prompt, /default\/empty state/);
  assert.match(prompt, /seedPlan/);
  assert.match(prompt, /proof-data-populated/);
  assert.match(prompt, /proofBoundary/);
  assert.match(prompt, /contextBoundary/);
  assert.match(prompt, /visible product context only/);
  assert.match(prompt, /Deterministic app\/route gates verify targetAppId and targetPath separately/);
  assert.match(prompt, /not a visible '\/agents' or 'Agents route' label/);
  assert.match(prompt, /recognizable product context/);
  assert.match(prompt, /isolated widget/);
  assert.match(prompt, /Browser Use should receive fewer, better candidates/);
  assert.match(prompt, /provider pricing, model catalog, routing, config, or API plumbing/);
  assert.match(prompt, /Backend or storage fixes may be valid media candidates/);
  assert.match(prompt, /Visual opportunity index from raw commits and changelog bullets/);
  assert.match(prompt, /Visual surface clusters from commits and changelog bullets/);
  assert.match(prompt, /Parent title alignment is a weak sanity check/);
  assert.match(prompt, /concrete user-visible screen, control, picker, sort\/filter behavior/);
  assert.match(prompt, /mere mention of an app name/);
  assert.match(prompt, /do not target \/desktop/);
  assert.match(prompt, /populated, visually rich desktop app route/);
  assert.match(prompt, /Keep shell\/chrome target and proof wording consistent/);
  assert.match(prompt, /image-gallery-populated/);
  assert.match(prompt, /do not open the 3D Model tab just because the app is called AURA 3D/);
  assert.match(prompt, /transient interaction states/);
  assert.match(prompt, /context menus/);
  assert.match(prompt, /micro-style-only changes/);
  assert.match(prompt, /down to 0\.70/);
  assert.match(prompt, /Demo seed data created only for screenshots is not a product feature/);
  assert.match(prompt, /Low-confidence candidates must be skipped/);
  assert.match(prompt, /publicCaption/);
  assert.match(prompt, /Curated changelog media lessons/);
  assert.match(prompt, /agents\.chat\.model_picker/);
  assert.match(prompt, /aura3d\.image_to_model_viewer/);
  assert.doesNotMatch(prompt, /Browserbase|Stagehand|Playwright/);
});

test("deriveVisualMediaOpportunities finds visual sub-features inside broad changelog entries", () => {
  const changelog = {
    rawCommits: [
      {
        sha: "feed1234567890",
        subject: "feat(feedback): add feedback app board",
        files: [
          "interface/src/apps/feedback/FeedbackMainPanel/FeedbackMainPanel.tsx",
          "interface/src/apps/feedback/FeedbackItemCard/FeedbackItemCard.tsx",
        ],
      },
      {
        sha: "stats1234567890",
        subject: "feat(projects): show project stats dashboard",
        files: ["interface/src/views/ProjectStatsView/ProjectStatsView.tsx"],
      },
      {
        sha: "infra1234567890",
        subject: "ci: update release workflow",
        files: [".github/workflows/release-nightly.yml"],
      },
    ],
    rendered: {
      entries: [
        {
          batch_id: "entry-product",
          title: "Daily product updates",
          items: [
            {
              text: "Feedback app now tracks votes and comments.",
              commit_shas: ["feed1234"],
              changed_files: ["interface/src/apps/feedback/FeedbackMainPanel/FeedbackMainPanel.tsx"],
            },
            {
              text: "Project stats dashboard shows delivery progress.",
              commit_shas: ["stats123"],
              changed_files: ["interface/src/views/ProjectStatsView/ProjectStatsView.tsx"],
            },
          ],
        },
        {
          batch_id: "entry-infra",
          title: "Release pipeline hardened",
          items: [
            {
              text: "Nightly workflow got safer defaults.",
              commit_shas: ["infra123"],
              changed_files: [".github/workflows/release-nightly.yml"],
            },
          ],
        },
      ],
    },
  };

  const opportunities = deriveVisualMediaOpportunities(changelog, {
    sitemap: {
      apps: [
        {
          id: "feedback",
          label: "Feedback",
          path: "/feedback",
          keywords: ["feedback", "board", "votes", "comments"],
          captureSeedProfile: {
            runtimeSeedSupport: "supported",
            preferredStableSurface: "feedback board",
            capabilities: ["feedback-board-populated"],
          },
        },
        {
          id: "projects",
          label: "Projects",
          path: "/projects",
          keywords: ["project", "stats", "dashboard"],
          captureSeedProfile: {
            runtimeSeedSupport: "supported",
            preferredStableSurface: "project stats dashboard",
            capabilities: ["project-selected", "stats-dashboard-populated"],
          },
        },
      ],
    },
    allowedEntryIds: new Set(["entry-product"]),
  });

  assert.equal(opportunities.length, 2);
  assert.deepEqual([...new Set(opportunities.map((opportunity) => opportunity.entryId))], ["entry-product"]);
  assert.ok(opportunities.some((opportunity) => opportunity.commitSha === "feed12345678"));
  assert.ok(opportunities.some((opportunity) => opportunity.likelyApps[0]?.id === "feedback"));
  assert.ok(opportunities.some((opportunity) => opportunity.likelyApps[0]?.id === "projects"));
  assert.ok(opportunities.every((opportunity) => opportunity.changedFiles.every((filePath) => filePath.startsWith("interface/src/"))));
  assert.equal(opportunities.some((opportunity) => opportunity.entryId === "entry-infra"), false);
});

test("deriveVisualMediaOpportunities ignores changelog media seed infrastructure as product media", () => {
  const opportunities = deriveVisualMediaOpportunities({
    rawCommits: [
      {
        sha: "media1234567890",
        subject: "feat(changelog): improve media inference and seeded proofs",
        files: [
          "interface/src/apps/feedback/FeedbackMainPanel/FeedbackMainPanel.tsx",
          "interface/scripts/evaluate-changelog-media-pipeline.mjs",
        ],
      },
    ],
    rendered: {
      entries: [
        {
          batch_id: "entry-media",
          title: "Smarter changelog media planning",
          items: [
            {
              text: "Changelog media inference now uses richer seeded proofs across feedback and stats capture surfaces.",
              commit_shas: ["media123"],
              changed_files: ["interface/src/apps/feedback/FeedbackMainPanel/FeedbackMainPanel.tsx"],
            },
          ],
        },
      ],
    },
  }, {
    sitemap: {
      apps: [
        {
          id: "feedback",
          label: "Feedback",
          path: "/feedback",
          keywords: ["feedback"],
          captureSeedProfile: { runtimeSeedSupport: "supported" },
        },
      ],
    },
  });

  assert.deepEqual(opportunities, []);
});

test("deriveVisualMediaOpportunities skips pricing and benchmark plumbing without picker proof", () => {
  const opportunities = deriveVisualMediaOpportunities({
    rawCommits: [
      {
        sha: "price1234567890",
        subject: "feat(models): add Fireworks pricing coverage",
        files: [
          "interface/src/constants/models.ts",
          "interface/src/lib/inference-pricing.ts",
        ],
      },
    ],
    rendered: {
      entries: [
        {
          batch_id: "entry-pricing",
          title: "Provider pricing and benchmark coverage",
          items: [
            {
              text: "Fireworks open model pricing coverage was added for usage accounting.",
              commit_shas: ["price123"],
              changed_files: ["interface/src/constants/models.ts"],
            },
          ],
        },
      ],
    },
  }, {
    sitemap: {
      apps: [
        {
          id: "agents",
          label: "Agents",
          path: "/agents",
          keywords: ["chat", "model picker"],
          captureSeedProfile: { runtimeSeedSupport: "supported" },
        },
      ],
    },
  });

  assert.deepEqual(opportunities, []);
});

test("deriveVisualMediaOpportunities skips mobile-scoped and changelog-validator noise", () => {
  const opportunities = deriveVisualMediaOpportunities({
    rawCommits: [
      {
        sha: "mobile123456789",
        subject: "feat(mobile): add project agents roster",
        files: [
          "interface/src/mobile/components/MobileAgentsRoster.tsx",
          "interface/android/app/src/main/AndroidManifest.xml",
        ],
      },
      {
        sha: "valid1234567890",
        subject: "test(changelog): add changelog validator regression tests",
        files: [
          "interface/scripts/changelog-validator.test.mjs",
          "interface/scripts/changelog-validator.mjs",
        ],
      },
      {
        sha: "selector1234567",
        subject: "feat(chat): add mobile model selector",
        files: [
          "interface/src/components/ChatInputBar/ChatInputBar.tsx",
          "interface/src/components/ChatInputBar/ChatInputBar.module.css",
        ],
      },
    ],
    rendered: {
      entries: [
        {
          batch_id: "entry-mobile",
          title: "Mobile project shell redesign with a new Agents roster",
          items: [
            {
              text: "Mobile project shell now includes an Agents roster.",
              commit_shas: ["mobile123"],
              changed_files: ["interface/src/mobile/components/MobileAgentsRoster.tsx"],
            },
          ],
        },
        {
          batch_id: "entry-validator",
          title: "Linux packaging retry and changelog tooling improvements",
          items: [
            {
              text: "Added changelog validator regression tests.",
              commit_shas: ["valid123"],
              changed_files: ["interface/scripts/changelog-validator.test.mjs"],
            },
          ],
        },
        {
          batch_id: "entry-mobile-shared",
          title: "Mobile chat model selector",
          items: [
            {
              text: "Mobile chat now has a dedicated model selector.",
              commit_shas: ["selector123"],
              changed_files: ["interface/src/components/ChatInputBar/ChatInputBar.tsx"],
            },
          ],
        },
      ],
    },
  }, {
    sitemap: {
      apps: [
        {
          id: "projects",
          label: "Projects",
          path: "/projects",
          keywords: ["project", "agents"],
          captureSeedProfile: { runtimeSeedSupport: "supported" },
        },
      ],
    },
  });

  assert.deepEqual(opportunities, []);
});

test("deriveVisualMediaOpportunities keeps model catalog changes when the picker is visible proof", () => {
  const opportunities = deriveVisualMediaOpportunities({
    rawCommits: [
      {
        sha: "model1234567890",
        subject: "feat(chat): add GPT-5.5 model support",
        files: [
          "interface/src/components/ChatInputBar/ChatInputBar.tsx",
          "interface/src/constants/models.ts",
        ],
      },
    ],
    rendered: {
      entries: [
        {
          batch_id: "entry-model-picker",
          title: "GPT-5.5 available in the chat model picker",
          items: [
            {
              text: "GPT-5.5 is available in the chat model picker.",
              commit_shas: ["model123"],
              changed_files: ["interface/src/components/ChatInputBar/ChatInputBar.tsx"],
            },
          ],
        },
      ],
    },
  }, {
    sitemap: {
      apps: [
        {
          id: "agents",
          label: "Agents",
          path: "/agents",
          keywords: ["agent", "chat", "model picker"],
          captureSeedProfile: {
            runtimeSeedSupport: "supported",
            capabilities: ["agent-chat-ready"],
          },
        },
      ],
    },
  });

  assert.equal(opportunities.length, 1);
  assert.equal(opportunities[0].entryId, "entry-model-picker");
  assert.equal(opportunities[0].likelyApps[0]?.id, "agents");
});

test("deriveVisualMediaOpportunities keeps backend fixes that explicitly repair visible UI state", () => {
  const opportunities = deriveVisualMediaOpportunities({
    rawCommits: [
      {
        sha: "statsfix123456",
        subject: "fix(stats): decode project token/cost/lines/time across key shapes",
        body: "The project stats panel showed Tokens, Time, and Lines stuck at zero. Decode all aliases so the dashboard numbers display correctly.",
        files: [
          "crates/aura-os-storage/src/client/stats.rs",
          "crates/aura-os-storage/src/types.rs",
        ],
      },
    ],
    rendered: {
      entries: [
        {
          batch_id: "entry-stats",
          title: "Project stats decode tokens, time, and lines correctly",
          items: [
            {
              text: "The project stats panel now displays non-zero token, time, cost, and line metrics.",
              commit_shas: ["statsfix"],
              changed_files: ["crates/aura-os-storage/src/client/stats.rs"],
            },
          ],
        },
      ],
    },
  }, {
    sitemap: {
      apps: [
        {
          id: "projects",
          label: "Projects",
          path: "/projects",
          keywords: ["project", "stats", "dashboard", "metrics"],
          captureSeedProfile: {
            runtimeSeedSupport: "supported",
            capabilities: ["project-stats-populated"],
          },
        },
      ],
    },
  });

  assert.equal(opportunities.length, 1);
  assert.equal(opportunities[0].entryId, "entry-stats");
  assert.equal(opportunities[0].likelyApps[0]?.id, "projects");
});

test("deriveVisualMediaOpportunities skips micro-style-only and transient visual changes", () => {
  const opportunities = deriveVisualMediaOpportunities({
    rawCommits: [
      {
        sha: "border123456789",
        subject: "style(tasks): darken block border token in task output",
        files: ["interface/src/apps/tasks/components/TaskOutput.module.css"],
      },
      {
        sha: "hover1234567890",
        subject: "style(chat): polish hover focus ring on preview overlay",
        files: ["interface/src/apps/agents/components/AgentChat/PreviewOverlay.module.css"],
      },
      {
        sha: "token1234567890",
        subject: "style(ui): match chat border token inside sidekick and preview overlays",
        body: "Propagate the chat border token so tables, blocks, and output sections render with the same subtle outline.",
        files: [
          "interface/src/components/PreviewOverlay/PreviewOverlay.module.css",
          "interface/src/components/Sidekick/Sidekick.module.css",
        ],
      },
      {
        sha: "rename12345678",
        subject: "feat(files): add F2 inline rename focus state",
        files: ["interface/src/components/FileExplorer/FileRow.tsx"],
      },
    ],
    rendered: {
      entries: [
        {
          batch_id: "entry-style",
          title: "Task and chat visual polish",
          items: [
            {
              text: "Task output borders and chat preview focus rings were polished.",
              commit_shas: ["border123", "hover123", "rename123"],
              changed_files: ["interface/src/apps/tasks/components/TaskOutput.module.css"],
            },
          ],
        },
      ],
    },
  }, {
    sitemap: {
      apps: [
        {
          id: "tasks",
          label: "Tasks",
          path: "/tasks",
          keywords: ["task", "output", "border"],
          captureSeedProfile: { runtimeSeedSupport: "supported" },
        },
        {
          id: "agents",
          label: "Agents",
          path: "/agents",
          keywords: ["chat", "preview"],
          captureSeedProfile: { runtimeSeedSupport: "supported" },
        },
      ],
    },
  });

  assert.deepEqual(opportunities, []);
});

test("deriveVisualMediaOpportunities still keeps durable screen-level visual redesigns", () => {
  const opportunities = deriveVisualMediaOpportunities({
    rawCommits: [
      {
        sha: "taskbar123456",
        subject: "style(taskbar): redesign bottom taskbar into floating capsules",
        files: [
          "interface/src/components/BottomTaskbar/BottomTaskbar.tsx",
          "interface/src/components/BottomTaskbar/BottomTaskbar.module.css",
        ],
      },
    ],
    rendered: {
      entries: [
        {
          batch_id: "entry-taskbar",
          title: "Desktop taskbar redesign",
          items: [
            {
              text: "The bottom taskbar now uses floating capsules around populated app content.",
              commit_shas: ["taskbar123"],
              changed_files: ["interface/src/components/BottomTaskbar/BottomTaskbar.module.css"],
            },
          ],
        },
      ],
    },
  }, {
    sitemap: {
      apps: [
        {
          id: "aura3d",
          label: "AURA 3D",
          path: "/3d",
          keywords: ["taskbar", "desktop shell", "gallery"],
          captureSeedProfile: { runtimeSeedSupport: "supported" },
        },
      ],
    },
  });

  assert.equal(opportunities.length, 1);
  assert.equal(opportunities[0].entryId, "entry-taskbar");
  assert.equal(opportunities[0].likelyApps[0]?.id, "aura3d");
});

test("deriveVisualMediaSurfaceClusters promotes repeated visual surfaces inside broad changelog titles", () => {
  const changelog = {
    rawCommits: [
      {
        sha: "taskbar111111",
        subject: "style(taskbar): split bottom taskbar into three floating capsules",
        files: [
          "interface/src/components/BottomTaskbar/BottomTaskbar.module.css",
          "interface/src/components/BottomTaskbar/BottomTaskbar.tsx",
        ],
      },
      {
        sha: "taskbar222222",
        subject: "style(taskbar): float the bar with 4px inset and tighten side capsules",
        files: ["interface/src/components/BottomTaskbar/BottomTaskbar.module.css"],
      },
      {
        sha: "shell3333333",
        subject: "style(shell): unify desktop corner radii and tighten panel gaps",
        files: ["interface/src/components/DesktopShell/DesktopShell.module.css"],
      },
    ],
    rendered: {
      entries: [
        {
          batch_id: "entry-dev-loop",
          title: "Dev loop rebuilt around the harness with isolated concurrent loops",
          items: [
            {
              text: "Desktop shell now uses a redesigned floating taskbar with three glass capsules.",
              commit_shas: ["taskbar111"],
              changed_files: ["interface/src/components/BottomTaskbar/BottomTaskbar.module.css"],
            },
            {
              text: "Taskbar side capsules have tighter spacing and clearer separation.",
              commit_shas: ["taskbar222"],
              changed_files: ["interface/src/components/BottomTaskbar/BottomTaskbar.module.css"],
            },
            {
              text: "Desktop panels share the same rounded shell geometry.",
              commit_shas: ["shell333"],
              changed_files: ["interface/src/components/DesktopShell/DesktopShell.module.css"],
            },
          ],
        },
      ],
    },
  };

  const opportunities = deriveVisualMediaOpportunities(changelog, {
    sitemap: {
      apps: [
        {
          id: "aura3d",
          label: "AURA 3D",
          path: "/3d",
          keywords: ["aura 3d", "gallery", "desktop shell", "taskbar"],
          captureSeedProfile: {
            runtimeSeedSupport: "supported",
            preferredStableSurface: "generated Image gallery",
            capabilities: ["image-gallery-populated", "asset-gallery-populated"],
          },
        },
        {
          id: "agents",
          label: "Agents",
          path: "/agents",
          keywords: ["agent", "chat"],
          captureSeedProfile: { runtimeSeedSupport: "supported" },
        },
      ],
    },
    allowedEntryIds: new Set(["entry-dev-loop"]),
  });
  const clusters = deriveVisualMediaSurfaceClusters(opportunities);
  const shellCluster = clusters.find((cluster) => cluster.surfaceKey === "desktop-shell-taskbar");

  assert.ok(shellCluster);
  assert.equal(shellCluster.entryId, "entry-dev-loop");
  assert.equal(shellCluster.preferredTargetAppId, "aura3d");
  assert.equal(shellCluster.preferredTargetPath, "/3d");
  assert.ok(shellCluster.opportunityCount >= 2);
  assert.ok(shellCluster.score > 40);
  assert.match(shellCluster.guidance.join("\n"), /parent changelog title is placement context/);
  assert.ok(shellCluster.subjects.some((subject) => subject.includes("bottom taskbar")));
});

test("deriveVisualMediaSurfaceClusters maps Team Settings proof to the Profile app route", () => {
  const opportunities = deriveVisualMediaOpportunities({
    rawCommits: [
      {
        sha: "team1234567890",
        subject: "feat(settings): show build version in Team Settings general section",
        files: [
          "interface/src/components/OrgSettingsPanel/OrgSettingsPanel.tsx",
          "interface/src/components/OrgSettingsGeneral/OrgSettingsGeneral.tsx",
        ],
      },
    ],
    rendered: {
      entries: [
        {
          batch_id: "entry-settings",
          title: "Team Settings general section shows build metadata",
          items: [
            {
              text: "Team Settings now shows the app build version in General.",
              commit_shas: ["team123"],
              changed_files: ["interface/src/components/OrgSettingsGeneral/OrgSettingsGeneral.tsx"],
            },
          ],
        },
      ],
    },
  }, {
    sitemap: {
      apps: [
        {
          id: "profile",
          label: "Profile",
          path: "/profile",
          keywords: ["profile", "account", "settings", "team"],
          captureSeedProfile: {
            runtimeSeedSupport: "supported",
            capabilities: ["profile-summary-populated", "team-settings-open"],
          },
        },
      ],
    },
  });
  const clusters = deriveVisualMediaSurfaceClusters(opportunities);

  assert.equal(clusters[0]?.preferredTargetAppId, "profile");
  assert.equal(clusters[0]?.preferredTargetPath, "/profile");
});

test("deriveVisualMediaSurfaceClusters does not emit empty desktop fallback clusters", () => {
  const clusters = deriveVisualMediaSurfaceClusters([
    {
      opportunityId: "entry-1:desktop-platform",
      entryId: "entry-1",
      entryTitle: "Desktop platform polish",
      itemText: "Desktop platform now accepts a runtime flag for external harness use.",
      subject: "feat(desktop): honor --external-harness CLI flag",
      score: 24,
      confidenceHint: 0.8,
      desktopEligible: true,
      changedFiles: [],
      likelyApps: [
        {
          id: "desktop",
          label: "Desktop",
          path: "/desktop",
          score: 12,
        },
      ],
    },
  ]);

  assert.deepEqual(clusters, []);
});

test("normalizeMediaPlan keeps only high-confidence capture candidates and preserves coverage under the cap", () => {
  const plan = normalizeMediaPlan({
    candidates: [
      {
        entryId: "low",
        title: "Tiny ambiguous thing",
        shouldCapture: true,
        reason: "Maybe visible",
        targetAppId: "agents",
        targetPath: "/agents",
        proofGoal: "Maybe",
        confidence: 0.2,
      },
      {
        entryId: "borderline",
        title: "Model catalog plumbing",
        shouldCapture: true,
        reason: "May affect the model picker",
        targetAppId: "agents",
        targetPath: "/agents",
        proofGoal: "Show the model picker",
        confidence: 0.68,
      },
      {
        entryId: "strong",
        title: "GPT-5.5 available in model picker",
        shouldCapture: true,
        reason: "Visible model picker option",
        targetAppId: "agents",
        targetPath: "/agents",
        proofGoal: "Open chat model picker and show GPT-5.5",
        publicCaption: "GPT-5.5 is now available directly from the chat model picker.",
        confidence: 0.92,
        changedFiles: ["interface/src/apps/agents/components/AgentChat/ChatInputBar.tsx"],
      },
      {
        entryId: "second-strong",
        title: "Feedback board shows comments",
        shouldCapture: true,
        reason: "Visible feedback board comments",
        targetAppId: "feedback",
        targetPath: "/feedback",
        proofGoal: "Show the feedback board comments",
        confidence: 0.86,
        changedFiles: ["interface/src/apps/feedback/FeedbackApp.tsx"],
      },
      {
        entryId: "missing-target",
        title: "Login redesign",
        shouldCapture: true,
        reason: "Visible login screen redesign",
        targetAppId: null,
        targetPath: null,
        proofGoal: "Show the login redesign",
        publicCaption: "The sign-in screen has a refreshed layout.",
        confidence: 0.8,
        changedFiles: ["interface/src/pages/Login.tsx"],
      },
    ],
    skipped: [
      {
        entryId: "mobile",
        title: "Android update",
        reason: "Mobile-only",
        category: "mobile-only",
      },
    ],
  }, { maxCandidates: 1 });

  assert.equal(plan.candidates.length, 1);
  assert.equal(plan.candidates[0].entryId, "strong");
  assert.ok(plan.candidates[0].seedPlan.capabilities.includes("proof-data-populated"));
  assert.ok(plan.candidates[0].seedPlan.capabilities.includes("app:agents"));
  assert.equal(plan.skipped[0].category, "mobile-only");
  assert.ok(plan.skipped.some((entry) => entry.entryId === "second-strong" && entry.category === "candidate-limit"));
  assert.ok(plan.skipped.some((entry) => entry.entryId === "low" && entry.category === "too-ambiguous"));
  assert.ok(plan.skipped.some((entry) => entry.entryId === "borderline" && entry.category === "too-ambiguous"));
  assert.ok(plan.skipped.some((entry) => entry.entryId === "missing-target" && entry.reason.includes("sitemap-backed")));
});

test("normalizeMediaPlan routes shell chrome captures through a populated app", () => {
  const plan = normalizeMediaPlan({
    candidates: [
      {
        entryId: "shell",
        title: "Floating glass desktop shell",
        shouldCapture: true,
        reason: "Visible desktop shell chrome and bottom taskbar change.",
        targetAppId: "desktop",
        targetPath: "/desktop",
        proofGoal: "Show the floating-glass desktop shell with bottom taskbar capsules.",
        publicCaption: "The desktop shell now floats as glass capsules.",
        confidence: 0.9,
        changedFiles: [
          "interface/src/components/DesktopShell/DesktopShell.module.css",
          "interface/src/components/BottomTaskbar/BottomTaskbar.module.css",
        ],
        seedPlan: {
          capabilities: ["app:desktop", "proof-data-populated"],
          requiredState: ["The desktop shell is visible."],
          readinessSignals: ["Bottom taskbar split into capsules."],
        },
      },
    ],
    skipped: [],
  }, { maxCandidates: 1 });

  assert.equal(plan.candidates.length, 1);
  assert.equal(plan.candidates[0].targetAppId, "aura3d");
  assert.equal(plan.candidates[0].targetPath, "/3d");
  assert.match(plan.candidates[0].reason, /populated with visual product data instead of landing on an empty \/desktop shell/);
  assert.ok(plan.candidates[0].seedPlan.capabilities.includes("app:aura3d"));
  assert.ok(plan.candidates[0].seedPlan.capabilities.includes("asset-gallery-populated"));
  assert.ok(plan.candidates[0].seedPlan.capabilities.includes("image-gallery-populated"));
  assert.ok(plan.candidates[0].seedPlan.avoid.includes("empty /desktop launcher shell"));
  assert.ok(plan.candidates[0].seedPlan.avoid.some((entry) => entry.includes("model tab")));
});

test("normalizeMediaPlan does not route non-shell proofs because the reason mentions shell alternatives", () => {
  const plan = normalizeMediaPlan({
    candidates: [
      {
        entryId: "chat-banner",
        title: "Dropped-stream recovery",
        shouldCapture: true,
        reason: "The chat interrupted banner is the chosen proof; taskbar styling was rejected as too small.",
        targetAppId: "agents",
        targetPath: "/agents",
        proofGoal: "Show the Chat stream interrupted banner in an agent chat transcript.",
        publicCaption: "Aura now surfaces interrupted chat streams directly in the conversation.",
        confidence: 0.8,
        changedFiles: ["interface/src/apps/agents/AgentChatView.tsx"],
      },
    ],
    skipped: [],
  }, { maxCandidates: 1 });

  assert.equal(plan.candidates.length, 1);
  assert.equal(plan.candidates[0].targetAppId, "agents");
  assert.equal(plan.candidates[0].targetPath, "/agents");
});

test("normalizeMediaPlan preserves explicit app targets even when broad release text mentions shell", () => {
  const plan = normalizeMediaPlan({
    candidates: [
      {
        entryId: "models",
        title: "Aura-proxied models, persistent shell, and generate_image",
        shouldCapture: true,
        reason: "The selected visual proof is the Agents chat model picker with gpt-image-2 visible.",
        targetAppId: "agents",
        targetPath: "/agents",
        proofGoal: "Show the Agents chat composer with the model picker open and gpt-image-2 visible.",
        publicCaption: "gpt-image-2 is visible in the chat picker.",
        confidence: 0.82,
        changedFiles: [
          "interface/src/components/AppShell/AppShell.tsx",
          "interface/src/constants/models.ts",
          "interface/src/apps/chat/components/ChatInputBar/ChatInputBar.tsx",
        ],
        seedPlan: {
          capabilities: ["app:agents", "agent-chat-ready", "model-picker-open", "proof-data-populated"],
          requiredState: ["The chat composer model picker is open."],
        },
      },
    ],
    skipped: [],
  }, { maxCandidates: 1 });

  assert.equal(plan.candidates.length, 1);
  assert.equal(plan.candidates[0].targetAppId, "agents");
  assert.equal(plan.candidates[0].targetPath, "/agents");
  assert.ok(plan.candidates[0].seedPlan.capabilities.includes("app:agents"));
  assert.ok(!plan.candidates[0].seedPlan.capabilities.includes("app:aura3d"));
});

test("normalizeMediaPlan skips lower-priority duplicate shell fallback surfaces", () => {
  const plan = normalizeMediaPlan({
    candidates: [
      {
        entryId: "shell-a",
        title: "Desktop shell spacing tightened",
        shouldCapture: true,
        reason: "Visible desktop shell chrome and bottom taskbar change.",
        targetAppId: "desktop",
        targetPath: "/desktop",
        proofGoal: "Show the bottom taskbar and desktop shell spacing.",
        publicCaption: "The desktop shell spacing is tighter.",
        confidence: 0.9,
        changedFiles: ["interface/src/components/DesktopShell/DesktopShell.tsx"],
      },
      {
        entryId: "shell-b",
        title: "Taskbar capsules redesigned",
        shouldCapture: true,
        reason: "Visible desktop shell chrome and taskbar capsule change.",
        targetAppId: "desktop",
        targetPath: "/desktop",
        proofGoal: "Show the same bottom taskbar shell chrome.",
        publicCaption: "The taskbar capsules have a cleaner design.",
        confidence: 0.86,
        changedFiles: ["interface/src/components/BottomTaskbar/BottomTaskbar.tsx"],
      },
      {
        entryId: "feedback",
        title: "Feedback sort control",
        shouldCapture: true,
        reason: "Feedback board sorting is visible and seedable.",
        targetAppId: "feedback",
        targetPath: "/feedback",
        proofGoal: "Show the feedback board with the sort control visible.",
        publicCaption: "Feedback can now be sorted from the board.",
        confidence: 0.8,
        changedFiles: ["interface/src/apps/feedback/FeedbackMainPanel.tsx"],
      },
    ],
    skipped: [],
  }, { maxCandidates: 3 });

  assert.deepEqual(plan.candidates.map((candidate) => candidate.entryId), ["shell-a", "feedback"]);
  assert.ok(plan.skipped.some((entry) => entry.entryId === "shell-b" && entry.category === "duplicate-surface"));
});

test("normalizeMediaPlan skips lower-priority duplicate model-picker surfaces", () => {
  const plan = normalizeMediaPlan({
    candidates: [
      {
        entryId: "gpt55",
        title: "GPT-5.5 support",
        shouldCapture: true,
        reason: "The Agents chat model picker shows GPT-5.5.",
        targetAppId: "agents",
        targetPath: "/agents",
        proofGoal: "Show the chat composer model picker with GPT-5.5 visible.",
        publicCaption: "GPT-5.5 is available in the model picker.",
        confidence: 0.86,
        changedFiles: ["interface/src/components/ChatInputBar/ChatInputBar.tsx"],
      },
      {
        entryId: "deepseek",
        title: "DeepSeek support",
        shouldCapture: true,
        reason: "The Agents chat model picker shows DeepSeek.",
        targetAppId: "agents",
        targetPath: "/agents",
        proofGoal: "Show the chat composer model picker with DeepSeek visible.",
        publicCaption: "DeepSeek is available in the model picker.",
        confidence: 0.78,
        changedFiles: ["interface/src/components/ChatInputBar/ChatInputBar.tsx"],
      },
    ],
    skipped: [],
  }, { maxCandidates: 3 });

  assert.deepEqual(plan.candidates.map((candidate) => candidate.entryId), ["gpt55"]);
  assert.ok(plan.skipped.some((entry) => entry.entryId === "deepseek" && entry.category === "duplicate-surface"));
});

test("validateMediaPlanCoverage catches planner omissions and duplicates", () => {
  const coverage = validateMediaPlanCoverage({
    candidates: [{ entryId: "entry-1" }],
    skipped: [{ entryId: "entry-1" }, { entryId: "entry-999" }],
  }, [
    { entryId: "entry-1" },
    { entryId: "entry-2" },
  ]);

  assert.equal(coverage.ok, false);
  assert.deepEqual(coverage.missing, ["entry-2"]);
  assert.deepEqual(coverage.duplicate, ["entry-1"]);
  assert.deepEqual(coverage.unknown, ["entry-999"]);
});

test("parseAnthropicMediaPlanResponse reads tool output", () => {
  const parsed = parseAnthropicMediaPlanResponse({
    content: [
      {
        type: "tool_use",
        name: "submit_changelog_media_plan",
        input: { candidates: [], skipped: [] },
      },
    ],
  });

  assert.deepEqual(parsed, { candidates: [], skipped: [] });
});

test("planChangelogMediaWithAnthropic retries when coverage misses an entry", async () => {
  const requestBodies = [];
  const result = await planChangelogMediaWithAnthropic({
    apiKey: "test-key",
    model: "claude-opus-4-7",
    changelogEntries: [
      { entryId: "entry-1", title: "Feedback board" },
      { entryId: "entry-2", title: "Backend fix" },
    ],
    sitemap: { apps: [{ id: "feedback", path: "/feedback" }] },
    fetchImpl: async (_url, options) => {
      requestBodies.push(JSON.parse(options.body));
      const isRetry = requestBodies.length > 1;
      return {
        ok: true,
        async json() {
          return {
            content: [
              {
                type: "tool_use",
                name: "submit_changelog_media_plan",
                input: {
                  candidates: [
                    {
                      entryId: "entry-1",
                      title: "Feedback board",
                      shouldCapture: true,
                      reason: "Visible feedback board",
                      targetAppId: "feedback",
                      targetPath: "/feedback",
                      proofGoal: "Show the feedback board",
                      publicCaption: "Feedback discussions are easier to review on the board.",
                      confidence: 0.86,
                      changedFiles: ["interface/src/apps/feedback/FeedbackApp.tsx"],
                    },
                  ],
                  skipped: isRetry
                    ? [
                      {
                        entryId: "entry-2",
                        title: "Backend fix",
                        reason: "Backend-only change.",
                        category: "backend-only",
                      },
                    ]
                    : [],
                },
              },
            ],
          };
        },
      };
    },
  });

  assert.equal(requestBodies.length, 2);
  assert.equal(requestBodies[0].model, "claude-opus-4-7");
  assert.equal(requestBodies[0].tool_choice.name, "submit_changelog_media_plan");
  assert.match(requestBodies[1].messages[0].content, /Missing entry IDs: entry-2/);
  assert.equal(result.coverage.ok, true);
  assert.equal(result.plan.candidates[0].targetAppId, "feedback");
});

test("planChangelogMediaWithAnthropic chunks large entry sets and aggregates coverage", async () => {
  const requestBodies = [];
  const entries = Array.from({ length: 45 }, (_value, index) => ({
    entryId: `entry-${index + 1}`,
    title: index === 0 ? "GPT-5.5 model picker" : `Infra update ${index + 1}`,
    changedFiles: index === 0
      ? ["interface/src/apps/agents/components/AgentChat/ChatInputBar.tsx"]
      : [".github/workflows/release-nightly.yml"],
  }));

  const result = await planChangelogMediaWithAnthropic({
    apiKey: "test-key",
    model: "claude-opus-4-7",
    changelogEntries: entries,
    sitemap: { apps: [{ id: "agents", path: "/agents" }] },
    maxCandidates: 3,
    entryChunkSize: 20,
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      requestBodies.push(body);
      const prompt = body.messages[0].content;
      const ids = [...prompt.matchAll(/"entryId": "([^"]+)"/g)].map((match) => match[1]);
      return {
        ok: true,
        async json() {
          return {
            content: [
              {
                type: "tool_use",
                name: "submit_changelog_media_plan",
                input: {
                  candidates: ids.includes("entry-1")
                    ? [
                      {
                        entryId: "entry-1",
                        title: "GPT-5.5 model picker",
                        shouldCapture: true,
                        reason: "Visible model picker option",
                        targetAppId: "agents",
                        targetPath: "/agents",
                        proofGoal: "Show GPT-5.5 in the model picker",
                        publicCaption: "GPT-5.5 is now available directly from the chat model picker.",
                        confidence: 0.92,
                        changedFiles: ["interface/src/apps/agents/components/AgentChat/ChatInputBar.tsx"],
                      },
                    ]
                    : [],
                  skipped: ids
                    .filter((id) => id !== "entry-1")
                    .map((id) => ({
                      entryId: id,
                      title: `Infra update ${id}`,
                      reason: "Infra-only change.",
                      category: "infra-only",
                    })),
                },
              },
            ],
          };
        },
      };
    },
  });

  assert.equal(requestBodies.length, 3);
  assert.equal(result.coverage.ok, true);
  assert.equal(result.coverage.expectedCount, 45);
  assert.equal(result.plan.candidates.length, 1);
  assert.equal(result.plan.skipped.length, 44);
});

test("planChangelogMediaWithAnthropic times out silent planner calls and emits progress", async () => {
  const progress = [];
  await assert.rejects(
    () => planChangelogMediaWithAnthropic({
      apiKey: "test-key",
      model: "claude-opus-4-7",
      changelogEntries: [{ entryId: "entry-1", title: "Visible product update" }],
      sitemap: { apps: [{ id: "agents", path: "/agents" }] },
      timeoutMs: 10,
      onProgress: (event) => progress.push(event),
      fetchImpl: () => new Promise(() => {}),
    }),
    /timed out after/,
  );

  assert.equal(progress.some((event) => event.stage === "planner-chunk-start"), true);
  assert.equal(progress.some((event) => event.stage === "planner-attempt-start"), true);
});

test("planChangelogMediaWithAnthropic safely skips entries omitted after retries", async () => {
  const result = await planChangelogMediaWithAnthropic({
    apiKey: "test-key",
    model: "claude-opus-4-7",
    changelogEntries: [
      { entryId: "entry-1", title: "Visible product update" },
      { entryId: "entry-2", title: "Unclassified update" },
    ],
    sitemap: { apps: [{ id: "agents", path: "/agents" }] },
    fetchImpl: async () => ({
      ok: true,
      async json() {
        return {
          content: [
            {
              type: "tool_use",
              name: "submit_changelog_media_plan",
              input: {
                candidates: [
                  {
                    entryId: "entry-1",
                    title: "Visible product update",
                    shouldCapture: true,
                    reason: "Visible desktop UI.",
                    targetAppId: "agents",
                    targetPath: "/agents",
                    proofGoal: "Show the visible update.",
                    publicCaption: "The visible product update is now available in Aura.",
                    confidence: 0.9,
                    changedFiles: ["interface/src/apps/agents/AgentApp.tsx"],
                  },
                ],
                skipped: [],
              },
            },
          ],
        };
      },
    }),
  });

  assert.equal(result.coverage.ok, true);
  assert.equal(result.forcedSkipped.length, 1);
  assert.equal(result.forcedSkipped[0].entryId, "entry-2");
  assert.equal(result.plan.skipped.some((entry) => entry.entryId === "entry-2"), true);
});

test("planChangelogMediaWithAnthropic drops hallucinated entry IDs before coverage decisions", async () => {
  const result = await planChangelogMediaWithAnthropic({
    apiKey: "test-key",
    model: "claude-opus-4-7",
    changelogEntries: [
      { entryId: "entry-1", title: "Feedback sorting" },
      { entryId: "entry-2", title: "Backend fix" },
    ],
    sitemap: { apps: [{ id: "feedback", path: "/feedback" }] },
    fetchImpl: async () => ({
      ok: true,
      async json() {
        return {
          content: [
            {
              type: "tool_use",
              name: "submit_changelog_media_plan",
              input: {
                candidates: [
                  {
                    entryId: "entry-1",
                    title: "Feedback sorting",
                    shouldCapture: true,
                    reason: "Visible feedback sorting control.",
                    targetAppId: "feedback",
                    targetPath: "/feedback",
                    proofGoal: "Show the feedback board sorted by priority.",
                    publicCaption: "Feedback can now be sorted by priority.",
                    confidence: 0.84,
                    changedFiles: ["interface/src/apps/feedback/FeedbackMainPanel/FeedbackMainPanel.tsx"],
                  },
                  {
                    entryId: "entry-1-dup",
                    title: "Feedback duplicate",
                    shouldCapture: true,
                    reason: "Second proof for the same entry.",
                    targetAppId: "feedback",
                    targetPath: "/feedback",
                    proofGoal: "Show another feedback proof.",
                    publicCaption: "Another feedback screenshot.",
                    confidence: 0.8,
                    changedFiles: ["interface/src/apps/feedback/FeedbackMainPanel/FeedbackMainPanel.tsx"],
                  },
                ],
                skipped: [
                  {
                    entryId: "entry-2",
                    title: "Backend fix",
                    reason: "Backend-only change.",
                    category: "backend-only",
                  },
                ],
              },
            },
          ],
        };
      },
    }),
  });

  assert.equal(result.coverage.ok, true);
  assert.deepEqual(result.coverage.unknown, []);
  assert.deepEqual(result.plan.candidates.map((candidate) => candidate.entryId), ["entry-1"]);
  assert.equal(result.plan.skipped.some((entry) => entry.entryId === "entry-1-dup"), false);
});

test("planChangelogMediaWithAnthropic rescues omitted entries with a focused follow-up pass", async () => {
  let calls = 0;
  const result = await planChangelogMediaWithAnthropic({
    apiKey: "test-key",
    model: "claude-opus-4-7",
    changelogEntries: [
      { entryId: "entry-1", title: "Visible product update" },
      { entryId: "entry-2", title: "GPT-5.5 model support" },
    ],
    sitemap: { apps: [{ id: "agents", path: "/agents" }] },
    fetchImpl: async (_url, options) => {
      calls += 1;
      const isRescue = JSON.parse(options.body).messages[0].content.includes("Planning chunk: rescue");
      return {
        ok: true,
        async json() {
          return {
            content: [
              {
                type: "tool_use",
                name: "submit_changelog_media_plan",
                input: {
                  candidates: [
                    {
                      entryId: isRescue ? "entry-2" : "entry-1",
                      title: isRescue ? "GPT-5.5 model support" : "Visible product update",
                      shouldCapture: true,
                      reason: "Visible desktop UI.",
                      targetAppId: "agents",
                      targetPath: "/agents",
                      proofGoal: isRescue ? "Show GPT-5.5 in the model picker." : "Show the visible update.",
                      publicCaption: isRescue
                        ? "GPT-5.5 is now available directly from the chat model picker."
                        : "The visible product update is now available in Aura.",
                      confidence: 0.9,
                      changedFiles: ["interface/src/apps/agents/AgentApp.tsx"],
                    },
                  ],
                  skipped: [],
                },
              },
            ],
          };
        },
      };
    },
  });

  assert.equal(calls, 3);
  assert.equal(result.coverage.ok, true);
  assert.equal(result.forcedSkipped.length, 0);
  assert.deepEqual(result.plan.candidates.map((candidate) => candidate.entryId).sort(), ["entry-1", "entry-2"]);
});
