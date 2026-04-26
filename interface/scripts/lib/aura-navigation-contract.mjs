import path from "node:path";
import { promises as fs } from "node:fs";

import { resolveDemoRepoPath, toRepoRelativePath } from "./demo-repo-paths.mjs";

const APPS_ROOT = resolveDemoRepoPath("interface", "src", "apps");
const DEFAULT_APP_LIMIT = 24;
const MAX_COMMIT_LOG_CHARS = 6000;
const DESKTOP_CAPTURE_POLICY = Object.freeze({
  target: "desktop-web-product-ui",
  viewport: { width: 1280, height: 720, deviceScaleFactor: 2 },
  minimumViewport: { width: 1280, height: 720 },
  rejectIfVisible: [
    "mobile responsive layout",
    "native iOS or Android surface",
    "hamburger-only mobile navigation",
    "bottom mobile navigation",
    "single narrow column caused by mobile viewport",
  ],
});

const SITEMAP_GENERATOR_VERSION = 1;
const SEEDED_CAPTURE_SURFACES = Object.freeze({
  agents: {
    capabilities: ["agent-chat-ready", "sidebar-list-populated", "sidekick-context-populated"],
    preferredStableSurface: "Agent chat with a selected seeded agent, readable transcript, and sidekick context.",
    seededData: ["selected agent", "chat transcript", "agent sidebar rows", "profile sidekick"],
  },
  aura3d: {
    capabilities: ["asset-gallery-populated", "image-gallery-populated", "generated-result-visible", "project-selected"],
    preferredStableSurface: "Generated Image gallery with a selected demo project, selected image, and visible sidekick thumbnails.",
    seededData: ["selected project", "generated image preview", "image gallery thumbnails"],
  },
  projects: {
    capabilities: [
      "project-selected",
      "project-stats-populated",
      "project-summary-populated",
      "run-history-populated",
      "sidebar-list-populated",
      "sidekick-context-populated",
    ],
    preferredStableSurface: "Selected project workspace with populated stats, active work context, and project navigation visible.",
    seededData: ["selected project", "project stats", "task summary", "assigned agent", "project navigation"],
  },
  feedback: {
    capabilities: ["feedback-board-populated", "feedback-thread-populated", "sidebar-list-populated", "sidekick-context-populated"],
    preferredStableSurface: "Feedback board with multiple idea cards, vote counts, status pills, and a selected comment thread.",
    seededData: ["feedback cards", "vote counts", "review statuses", "selected thread comments"],
  },
  notes: {
    capabilities: ["notes-tree-populated", "note-editor-populated", "project-selected", "sidekick-context-populated"],
    preferredStableSurface: "Notes editor with a selected launch note, populated notes tree, and table-of-contents sidekick.",
    seededData: ["selected project", "notes tree", "markdown note content", "TOC sidekick"],
  },
  tasks: {
    capabilities: ["task-board-populated", "project-selected", "sidebar-list-populated", "sidekick-context-populated"],
    preferredStableSurface: "Tasks kanban board with seeded cards across Done, In Progress, and Ready lanes.",
    seededData: ["selected project", "kanban lanes", "task cards", "assigned agent"],
  },
  process: {
    capabilities: ["process-graph-populated", "run-history-populated", "project-selected", "sidekick-context-populated"],
    preferredStableSurface: "Process canvas with connected automation nodes and visible run context.",
    seededData: ["selected process", "connected nodes", "run history", "node output"],
  },
  feed: {
    capabilities: ["feed-timeline-populated"],
    preferredStableSurface: "Feed timeline with release activity, commit messages, and a selected update.",
    seededData: ["activity entries", "commit messages", "selected event"],
  },
  debug: {
    capabilities: ["debug-run-populated", "run-history-populated", "project-selected", "sidebar-list-populated", "sidekick-context-populated"],
    preferredStableSurface: "Debug app run detail with a populated event timeline, counters, filters, and sidekick inspector.",
    seededData: ["selected debug project", "debug run metadata", "event timeline", "run counters", "sidekick inspector"],
  },
  profile: {
    capabilities: ["profile-summary-populated", "team-settings-open", "sidekick-context-populated"],
    preferredStableSurface: "Profile screen with seeded account context, or Team Settings modal opened over a populated desktop route when settings are the proof.",
    seededData: ["user profile", "active team", "team members", "team settings general section"],
  },
});

const FALLBACK_APPS = [
  {
    id: "desktop",
    label: "Desktop",
    path: "/desktop",
    description: "Shell overview and app launcher.",
    keywords: ["desktop", "shell", "workspace", "launcher"],
  },
  {
    id: "agents",
    label: "Agents",
    path: "/agents",
    description: "Agent library, agent detail, and chat surfaces.",
    keywords: ["agent", "agents", "chat", "model", "skills"],
  },
  {
    id: "projects",
    label: "Projects",
    path: "/projects",
    description: "Project workspace, specs, tasks, and agent entry points.",
    keywords: ["project", "projects", "spec", "task", "planning"],
  },
  {
    id: "tasks",
    label: "Tasks",
    path: "/tasks",
    description: "Task execution, automation, and run management.",
    keywords: ["task", "tasks", "run", "execution", "automation"],
  },
  {
    id: "process",
    label: "Processes",
    path: "/process",
    description: "Process builder and graph-based workflows.",
    keywords: ["process", "workflow", "graph", "canvas"],
  },
  {
    id: "feed",
    label: "Feed",
    path: "/feed",
    description: "Organization activity feed and update timeline.",
    keywords: ["feed", "timeline", "activity", "updates"],
  },
  {
    id: "feedback",
    label: "Feedback",
    path: "/feedback",
    description: "Feedback board with ideas, votes, comments, and review status.",
    keywords: ["feedback", "idea", "comment", "board", "thread", "vote"],
  },
  {
    id: "notes",
    label: "Notes",
    path: "/notes",
    description: "Project notes tree, editor, and sidekick panels.",
    keywords: ["notes", "editor", "document", "writing"],
  },
  {
    id: "integrations",
    label: "Integrations",
    path: "/integrations",
    description: "Third-party integrations, providers, and model connection settings.",
    keywords: ["integrations", "providers", "models", "api", "connections"],
  },
  {
    id: "profile",
    label: "Profile",
    path: "/profile",
    description: "User profile and account summary.",
    keywords: ["profile", "account", "summary"],
  },
];

let cachedAppsPromise = null;

function parseStringLiteral(block, fieldName) {
  const match = block.match(new RegExp(`${fieldName}:\\s*"([^"]+)"`));
  return match ? match[1].trim() : null;
}

function parseStringArray(block, fieldName) {
  const match = block.match(new RegExp(`${fieldName}:\\s*\\[((?:.|\\n)*?)\\]`));
  if (!match) {
    return [];
  }
  return unique([...match[1].matchAll(/"([^"]+)"/g)].map((entry) => entry[1]));
}

function parseAppsFromRegistry(source) {
  const apps = [];
  const pattern = /createAppDefinition\(\s*\{([\s\S]*?)\}\s*,/g;
  for (const match of source.matchAll(pattern)) {
    const block = match[1];
    const id = parseStringLiteral(block, "id");
    const label = parseStringLiteral(block, "label");
    const basePath = parseStringLiteral(block, "basePath");
    if (!id || !label || !basePath) {
      continue;
    }
    apps.push({
      id,
      label,
      path: basePath,
      description: parseStringLiteral(block, "agentDescription") || `${label} app`,
      keywords: parseStringArray(block, "agentKeywords"),
    });
  }
  return apps;
}

function unique(values, limit = DEFAULT_APP_LIMIT) {
  return [...new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => String(value || "").trim())
      .filter(Boolean),
  )].slice(0, limit);
}

function truncateText(value, limit = MAX_COMMIT_LOG_CHARS) {
  const text = String(value || "").replace(/\s+\n/g, "\n").trim();
  if (text.length <= limit) {
    return text;
  }
  return `${text.slice(0, limit - 24).trimEnd()}\n... [truncated]`;
}

function extractMatches(source, pattern, limit = DEFAULT_APP_LIMIT) {
  return unique([...String(source || "").matchAll(pattern)].map((entry) => entry[1]), limit);
}

function extractJsxAttributeStringValues(source, attributeName, limit = DEFAULT_APP_LIMIT) {
  const escapedAttribute = escapeRegex(attributeName);
  const directPattern = new RegExp(`${escapedAttribute}\\s*=\\s*"([^"]+)"`, "g");
  const expressionPattern = new RegExp(`${escapedAttribute}\\s*=\\s*\\{([^}]+)\\}`, "g");
  return unique([
    ...[...String(source || "").matchAll(directPattern)].map((entry) => entry[1]),
    ...[...String(source || "").matchAll(expressionPattern)]
      .flatMap((entry) => [...entry[1].matchAll(/"([^"]+)"/g)].map((match) => match[1])),
  ], limit);
}

function escapeRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function walkSourceFiles(dirPath) {
  const entries = await fs.readdir(dirPath, { withFileTypes: true }).catch(() => []);
  const files = [];
  for (const entry of entries) {
    const nextPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walkSourceFiles(nextPath));
      continue;
    }
    if (
      entry.isFile()
      && !entry.name.endsWith(".test.tsx")
      && !entry.name.endsWith(".test.ts")
      && !entry.name.endsWith(".module.css")
      && !entry.name.endsWith(".d.ts")
    ) {
      files.push(nextPath);
    }
  }
  return files;
}

async function resolveRouteImportPath(routeDir, specifier) {
  if (!specifier.startsWith(".")) return null;
  const resolved = path.resolve(routeDir, specifier);
  const candidates = [
    resolved,
    `${resolved}.tsx`,
    `${resolved}.ts`,
    path.join(resolved, "index.tsx"),
    path.join(resolved, "index.ts"),
  ];
  for (const candidate of candidates) {
    const stat = await fs.stat(candidate).catch(() => null);
    if (stat?.isFile() || stat?.isDirectory()) {
      return candidate;
    }
  }
  return null;
}

async function collectImportedSourceFiles(filePath, seen, depth = 0) {
  if (depth > 4 || seen.has(filePath) || seen.size > 420) return [];
  seen.add(filePath);

  const stat = await fs.stat(filePath).catch(() => null);
  if (!stat) return [];
  if (stat.isDirectory()) {
    const files = await walkSourceFiles(filePath);
    const nested = [];
    for (const file of files) {
      nested.push(...await collectImportedSourceFiles(file, seen, depth + 1));
    }
    return unique([...files, ...nested], 420);
  }
  if (!stat.isFile() || !/\.[cm]?[jt]sx?$/.test(filePath)) return [];

  const source = await fs.readFile(filePath, "utf8").catch(() => "");
  const imported = [];
  for (const match of source.matchAll(/(?:from\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\))/g)) {
    const specifier = match[1] || match[2];
    const resolved = await resolveRouteImportPath(path.dirname(filePath), specifier);
    if (!resolved) continue;
    imported.push(resolved);
    imported.push(...await collectImportedSourceFiles(resolved, seen, depth + 1));
  }
  return unique([filePath, ...imported], 420);
}

async function routeOwnedSourceFiles(routePath, routeSource) {
  const routeDir = path.dirname(routePath);
  const files = [];
  const seen = new Set();
  for (const match of routeSource.matchAll(/from\s+["']([^"']+)["']/g)) {
    const resolved = await resolveRouteImportPath(routeDir, match[1]);
    if (!resolved) continue;
    const stat = await fs.stat(resolved).catch(() => null);
    if (stat?.isDirectory()) {
      files.push(...await walkSourceFiles(resolved));
    } else if (stat?.isFile()) {
      files.push(resolved);
    }
    files.push(...await collectImportedSourceFiles(resolved, seen));
  }
  return unique(files, 420);
}

function routeTokensForApp(app) {
  return unique([
    app.id,
    String(app.path || "").replace(/^\/+/, ""),
  ]).filter(Boolean);
}

function routeKindsForApp(app, routeSource) {
  const routeAlternation = routeTokensForApp(app).map(escapeRegex).join("|");
  const basePattern = new RegExp(`path:\\s*"(?:${routeAlternation})"[\\s\\S]{0,260}?element:\\s*(?:<[^>]+>|null)`, "i");
  const detailPattern = new RegExp(`path:\\s*"(?:${routeAlternation})\\/:[^"]+"[\\s\\S]{0,260}?element:\\s*(?:<[^>]+>|null)`, "i");
  const kindFor = (pattern) => {
    const snippet = routeSource.match(pattern)?.[0] || "";
    if (/ShellRoutePlaceholder/.test(snippet)) return "placeholder";
    if (/IndexRedirect/.test(snippet)) return "redirect";
    if (/element:\s*null/.test(snippet)) return "shell";
    if (/element:\s*</.test(snippet)) return "direct";
    return "unknown";
  };
  return {
    baseRouteKind: kindFor(basePattern),
    detailRouteKind: kindFor(detailPattern),
  };
}

function summarizeSitemapCoverage(apps) {
  const appSummaries = apps.map((app) => {
    const sourceContext = app.sourceContext || {};
    const routeHints = sourceContext.routeHints || [];
    const surfaces = sourceContext.surfaces || [];
    const contexts = sourceContext.contexts || [];
    const contextAnchors = sourceContext.contextAnchors || [];
    const actions = sourceContext.actions || [];
    const fields = sourceContext.fields || [];
    const proofSignals = sourceContext.proofSignals || [];
    const ariaLabels = sourceContext.ariaLabels || [];
    const missing = [];
    if (routeHints.length === 0) missing.push("route-hints");
    if (surfaces.length === 0 && proofSignals.length === 0 && contexts.length === 0) missing.push("proof-surface-handles");
    if (proofSignals.length > 0 && contextAnchors.length === 0) missing.push("context-anchors");
    if (ariaLabels.length === 0) missing.push("aria-labels");
    if (sourceContext.baseRouteKind === "placeholder") missing.push("base-route-placeholder");
    if (sourceContext.baseRouteKind === "unknown") missing.push("base-route-unknown");
    return {
      id: app.id,
      label: app.label,
      routeHintCount: routeHints.length,
      surfaceCount: surfaces.length,
      contextCount: contexts.length,
      contextAnchorCount: contextAnchors.length,
      actionCount: actions.length,
      fieldCount: fields.length,
      proofSignalCount: proofSignals.length,
      ariaLabelCount: ariaLabels.length,
      baseRouteKind: sourceContext.baseRouteKind,
      detailRouteKind: sourceContext.detailRouteKind,
      missing,
    };
  });
  return {
    appCount: apps.length,
    appsWithRouteHints: appSummaries.filter((app) => app.routeHintCount > 0).length,
    appsWithProofHandles: appSummaries.filter((app) => app.surfaceCount > 0 || app.proofSignalCount > 0 || app.contextCount > 0).length,
    appsWithContextAnchors: appSummaries.filter((app) => app.contextAnchorCount > 0).length,
    appsWithAriaLabels: appSummaries.filter((app) => app.ariaLabelCount > 0).length,
    appGaps: appSummaries.filter((app) => app.missing.length > 0),
  };
}

function buildCaptureSeedProfile(app) {
  const sourceContext = app.sourceContext || {};
  const seededSurface = SEEDED_CAPTURE_SURFACES[app.id] || null;
  const capabilities = unique([
    "proof-data-populated",
    `app:${app.id}`,
    ...(seededSurface?.capabilities || []),
    ...(app.id === "agents" ? ["agent-chat-ready", "sidebar-list-populated", "sidekick-context-populated"] : []),
    ...(app.id === "aura3d" ? ["asset-gallery-populated", "image-gallery-populated", "project-selected"] : []),
    ...(app.id === "projects" ? ["project-selected", "run-history-populated"] : []),
    ...(app.id === "tasks" ? ["run-history-populated", "project-selected"] : []),
    ...(sourceContext.surfaces?.some((handle) => /sidekick/i.test(handle)) ? ["sidekick-context-populated"] : []),
    ...(sourceContext.surfaces?.some((handle) => /list|row|sidebar/i.test(handle)) ? ["sidebar-list-populated"] : []),
    ...(sourceContext.proofSignals?.some((handle) => /gallery|image|model|preview/i.test(handle)) ? ["asset-gallery-populated"] : []),
  ], 18);
  return {
    purpose: "Seed realistic demo state before capture so Browser Use does not screenshot empty product shells.",
    runtimeSeedSupport: seededSurface ? "supported" : "unknown",
    seededData: seededSurface?.seededData || [],
    capabilities,
    preferredStableSurface: seededSurface?.preferredStableSurface || "Populated desktop product state with proof data visible before screenshot capture.",
    recommendedProofHandles: unique(sourceContext.proofSignals || [], 12),
    recommendedContextHandles: unique([
      ...(sourceContext.contexts || []),
      ...(sourceContext.contextAnchors || []),
      ...(sourceContext.surfaces || []).filter((handle) => /panel|list|row|sidebar|sidekick|toolbar|tab/i.test(handle)),
    ], 18),
    readinessSignals: unique([
      "desktop shell is visible",
      `${app.label} route is active`,
      "target surface contains seeded product data",
      ...(sourceContext.proofSignals?.length ? ["at least one data-agent-proof handle is visible"] : []),
      ...(sourceContext.contextAnchors?.length ? ["nearest data-agent-context-anchor remains in the crop"] : []),
    ], 12),
    avoid: [
      "auth/login screen",
      "loading spinner",
      "empty placeholder",
      "mostly black shell with no populated app data",
      "mobile or narrow responsive layout",
    ],
  };
}

export async function buildAuraNavigationSitemap() {
  const apps = await listAuraNavigationApps();
  return {
    schemaVersion: SITEMAP_GENERATOR_VERSION,
    generatedAt: new Date().toISOString(),
    purpose: "Generated Aura desktop sitemap for changelog media inference and Browser Use navigation.",
    desktopCapturePolicy: DESKTOP_CAPTURE_POLICY,
    updatePolicy: [
      "Regenerate this sitemap from the current codebase for every media run.",
      "Use app registry metadata, route hints, aria labels, and data-agent-* handles as navigation evidence.",
      "Use data-agent-context for the product boundary and data-agent-context-anchor for titles, tabs, toolbars, or navigation that must remain visible around the proof.",
      "Prefer generated sitemap evidence over static scenario scripts.",
      "Treat captureSeedProfile as the contract for data-first capture: choose candidates whose target surface can be seeded, and request those capabilities before Browser Use navigates.",
      "Place data-agent-proof on the concrete visual evidence, not on a giant page container; if a changed desktop feature lacks proof handles, add durable product semantics in the UI instead of a one-off screenshot script.",
    ],
    coverage: summarizeSitemapCoverage(apps),
    apps: apps.map((app) => ({
      ...app,
      captureSeedProfile: buildCaptureSeedProfile(app),
    })),
  };
}

async function inspectAppSource(app) {
  const appDir = path.join(APPS_ROOT, app.id);
  const routePath = path.join(appDir, "routes.tsx");
  const routeSource = await fs.readFile(routePath, "utf8").catch(() => "");
  const files = unique([
    ...await walkSourceFiles(appDir),
    ...await routeOwnedSourceFiles(routePath, routeSource),
  ], 420);
  const source = (await Promise.all(files.map((filePath) => fs.readFile(filePath, "utf8").catch(() => "")))).join("\n");
  const ariaLabels = extractJsxAttributeStringValues(source, "aria-label", 32);
  const surfaces = extractJsxAttributeStringValues(source, "data-agent-surface", 32);
  const contexts = extractJsxAttributeStringValues(source, "data-agent-context", 32);
  const contextAnchors = extractJsxAttributeStringValues(source, "data-agent-context-anchor", 32);
  const actions = extractJsxAttributeStringValues(source, "data-agent-action", 32);
  const fields = extractJsxAttributeStringValues(source, "data-agent-field", 32);
  const proofSignals = extractJsxAttributeStringValues(source, "data-agent-proof", 32);

  return {
    appDir: toRepoRelativePath(appDir),
    routePath: toRepoRelativePath(routePath),
    routeHints: extractMatches(routeSource, /path:\s*"([^"]+)"/g, 16),
    ...routeKindsForApp(app, routeSource),
    surfaces,
    contexts,
    contextAnchors,
    actions,
    fields,
    proofSignals,
    ariaLabels,
  };
}

function cloneApp(app) {
  return {
    ...app,
    keywords: [...(app.keywords || [])],
    captureSeedProfile: app.captureSeedProfile
      ? {
          ...app.captureSeedProfile,
          runtimeSeedSupport: app.captureSeedProfile.runtimeSeedSupport || "unknown",
          seededData: [...(app.captureSeedProfile.seededData || [])],
          capabilities: [...(app.captureSeedProfile.capabilities || [])],
          preferredStableSurface: app.captureSeedProfile.preferredStableSurface || null,
          recommendedProofHandles: [...(app.captureSeedProfile.recommendedProofHandles || [])],
          recommendedContextHandles: [...(app.captureSeedProfile.recommendedContextHandles || [])],
          readinessSignals: [...(app.captureSeedProfile.readinessSignals || [])],
          avoid: [...(app.captureSeedProfile.avoid || [])],
        }
      : null,
    sourceContext: app.sourceContext
      ? Object.fromEntries(
          Object.entries(app.sourceContext).map(([key, value]) => [
            key,
            Array.isArray(value) ? [...value] : value,
          ]),
        )
      : null,
  };
}

export async function listAuraNavigationApps() {
  cachedAppsPromise ??= (async () => {
    const registryPath = resolveDemoRepoPath("interface", "src", "apps", "registry.ts");
    const registrySource = await fs.readFile(registryPath, "utf8").catch(() => "");
    const apps = parseAppsFromRegistry(registrySource);
    const source = apps.length > 0 ? apps : FALLBACK_APPS;
    return Promise.all(source.map(async (app) => {
      const appWithSource = {
        ...app,
        sourceContext: await inspectAppSource(app),
      };
      return {
        ...appWithSource,
        captureSeedProfile: buildCaptureSeedProfile(appWithSource),
      };
    }));
  })();

  return (await cachedAppsPromise).map(cloneApp);
}

function scoreAppForChange(app, changedFiles, prompt, commitLog) {
  const haystack = [
    prompt,
    commitLog,
    ...changedFiles,
  ].join("\n").toLowerCase();
  let score = 0;
  if (changedFiles.some((file) => file.includes(`/apps/${app.id}/`) || file.includes(`/apps/${app.id}.`))) {
    score += 8;
  }
  if (changedFiles.some((file) => file.startsWith(`interface/src/apps/${app.id}/`))) {
    score += 10;
  }
  for (const token of [app.id, app.label, ...(app.keywords || [])]) {
    const normalized = String(token || "").toLowerCase();
    if (normalized && haystack.includes(normalized)) {
      score += normalized === app.id ? 3 : 2;
    }
  }
  const semanticHandles = [
    ...(app.sourceContext?.surfaces || []),
    ...(app.sourceContext?.contexts || []),
    ...(app.sourceContext?.contextAnchors || []),
    ...(app.sourceContext?.actions || []),
    ...(app.sourceContext?.fields || []),
    ...(app.sourceContext?.proofSignals || []),
    ...(app.sourceContext?.ariaLabels || []),
  ];
  for (const handle of semanticHandles) {
    const normalized = String(handle || "").toLowerCase();
    if (normalized && haystack.includes(normalized)) {
      score += 4;
    }
  }
  return score;
}

function isMobileOnlyFile(filePath) {
  const normalized = String(filePath || "").toLowerCase();
  return (
    normalized.includes("/android/")
    || normalized.includes("/ios/")
    || normalized.includes("mobile")
    || normalized.includes("capacitor")
    || normalized.endsWith(".ipa")
    || normalized.endsWith(".apk")
    || normalized.includes(".github/workflows/android-")
    || normalized.includes(".github/workflows/ios-")
    || normalized.includes(".github/workflows/release-mobile")
  );
}

function hasDesktopUiFile(filePath) {
  const normalized = String(filePath || "").toLowerCase();
  return normalized.startsWith("interface/src/apps/")
    || normalized.startsWith("interface/src/components/")
    || normalized.startsWith("interface/src/routes/")
    || normalized.startsWith("interface/src/layout")
    || normalized.startsWith("interface/src/features/");
}

function mobileSignalDetails(value) {
  const normalized = String(value || "").toLowerCase();
  const signals = [
    ["android", /\bandroid\b/],
    ["ios", /\bios\b|\biphone\b|\bipad\b/],
    ["mobile", /\bmobile\b|\bnative app\b/],
    ["mobile artifact", /\b(?:apk|ipa|app store|play store|capacitor)\b/],
  ];
  return signals
    .filter(([, pattern]) => pattern.test(normalized))
    .map(([label]) => label);
}

function desktopSignalDetails(value) {
  const normalized = String(value || "").toLowerCase();
  const signals = [
    ["desktop", /\bdesktop\b/],
    ["web", /\bweb(?: app)?\b|\bbrowser\b/],
    ["product surface", /\b(chat|agent|project|task|process|feedback|notes|model picker|3d|integrations)\b/],
  ];
  return signals
    .filter(([, pattern]) => pattern.test(normalized))
    .map(([label]) => label);
}

function inferMediaEligibility(prompt, changedFiles, commitLog) {
  const normalizedPrompt = String(prompt || "").toLowerCase();
  const normalizedCommitLog = String(commitLog || "").toLowerCase();
  const files = Array.isArray(changedFiles) ? changedFiles.filter(Boolean) : [];
  const mobileOnlyFiles = files.length > 0 && files.every(isMobileOnlyFile);
  const hasDesktopEvidence = files.some(hasDesktopUiFile);
  const commitMobileSignals = mobileSignalDetails(normalizedCommitLog);
  const commitDesktopSignals = desktopSignalDetails(normalizedCommitLog);
  const commitLooksMobileOnly = commitMobileSignals.length > 0
    && commitDesktopSignals.length === 0
    && !hasDesktopEvidence;
  const promptLooksMobileOnly = /\b(android|ios|ipad|iphone|mobile|apk|ipa|native app)\b/i.test(normalizedPrompt)
    && !/\b(desktop|web app|browser|chat|agent|project|task|process|feedback|notes|model picker)\b/i.test(normalizedPrompt);

  if (commitLooksMobileOnly) {
    return {
      shouldAttemptCapture: false,
      reason: `commit log is mobile-only (${commitMobileSignals.join(", ")}); changelog media capture is desktop-only`,
    };
  }

  if (mobileOnlyFiles) {
    return {
      shouldAttemptCapture: false,
      reason: "changed files are mobile-only; changelog media capture is desktop-only",
    };
  }

  if (promptLooksMobileOnly && !hasDesktopEvidence) {
    return {
      shouldAttemptCapture: false,
      reason: "story appears mobile-only and has no desktop UI file evidence",
    };
  }

  return {
    shouldAttemptCapture: true,
    reason: hasDesktopEvidence
      ? "desktop UI file evidence is present"
      : commitDesktopSignals.length > 0
        ? `commit log contains desktop/product surface signal(s): ${commitDesktopSignals.join(", ")}`
      : "no mobile-only evidence; agent may attempt a desktop proof if the story is visually provable",
  };
}

export async function buildAuraNavigationContract({ prompt = "", changedFiles = [], commitLog = "" } = {}) {
  const sitemap = await buildAuraNavigationSitemap();
  const apps = sitemap.apps;
  const commitLogExcerpt = truncateText(commitLog);
  const mediaEligibility = inferMediaEligibility(prompt, changedFiles, commitLogExcerpt);
  const rankedApps = apps
    .map((app) => ({
      ...app,
      relevanceScore: scoreAppForChange(app, changedFiles, prompt, commitLogExcerpt),
    }))
    .sort((left, right) => right.relevanceScore - left.relevanceScore || left.label.localeCompare(right.label));

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    purpose: "Guide an AI browser agent to the correct Aura product screen from changelog or commit context.",
    desktopCapturePolicy: sitemap.desktopCapturePolicy,
    mediaEligibility,
    sitemapCoverage: sitemap.coverage,
    rules: [
      "Use commitContext.logExcerpt as the first eligibility signal; mobile-only commit logs should not proceed to browser capture.",
      "Prefer changed-file evidence over vague wording.",
      "Use data-agent-* attributes, aria labels, and route hints as stable navigation handles.",
      "Use data-agent-context as the product boundary and data-agent-context-anchor as the visible title/tab/toolbar context to keep in the screenshot.",
      "Use data-agent-proof as the concrete evidence to capture; avoid giant proof containers that hide the real changed object.",
      "Capture only desktop product UI at the requested desktop viewport. Never capture mobile, native iOS, native Android, or narrow responsive layouts.",
      "Do not capture auth, loading, empty placeholder, or generic landing states.",
      "If mediaEligibility.shouldAttemptCapture is false, return shouldCapture=false and explain why instead of navigating.",
      "If the change is not provable in one static screenshot, return shouldCapture=false instead of forcing a weak image.",
    ],
    changedFiles: unique(changedFiles, 80),
    commitContext: {
      logExcerpt: commitLogExcerpt,
      hasCommitLog: commitLogExcerpt.length > 0,
    },
    likelyApps: mediaEligibility.shouldAttemptCapture
      ? rankedApps.filter((app) => app.relevanceScore > 0).slice(0, 6).map((app) => ({
        id: app.id,
        label: app.label,
        path: app.path,
        relevanceScore: app.relevanceScore,
        reason: "matched prompt, changed files, commit log, app keywords, or agent surfaces",
      }))
      : [],
    apps: rankedApps.map((app) => ({
      id: app.id,
      label: app.label,
      path: app.path,
      description: app.description,
      keywords: app.keywords,
      sourceContext: app.sourceContext,
    })),
  };
}
