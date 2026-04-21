import path from "node:path";
import { promises as fs } from "node:fs";

const FALLBACK_APPS = [
  {
    id: "desktop",
    label: "Desktop",
    entryPath: "/desktop",
    description: "Shell overview and desktop surface for launching apps.",
    keywords: ["desktop", "shell", "workspace", "home", "launcher"],
  },
  {
    id: "agents",
    label: "Agents",
    entryPath: "/agents",
    description: "Standalone agent library and chat surfaces.",
    keywords: ["agent", "agents", "chat", "assistant", "conversation", "model"],
  },
  {
    id: "projects",
    label: "Projects",
    entryPath: "/projects",
    description: "Project workspace, specs, tasks, and agent entry points.",
    keywords: ["project", "projects", "workspace", "spec", "specs", "planning"],
  },
  {
    id: "tasks",
    label: "Tasks",
    entryPath: "/tasks",
    description: "Task execution, automation, and run management.",
    keywords: ["task", "tasks", "run", "execution", "automation", "retry"],
  },
  {
    id: "process",
    label: "Processes",
    entryPath: "/process",
    description: "Process builder and node-based automation workflows.",
    keywords: ["process", "workflow", "graph", "nodes", "canvas"],
  },
  {
    id: "feed",
    label: "Feed",
    entryPath: "/feed",
    description: "Organization activity feed and update timeline.",
    keywords: ["feed", "timeline", "activity", "updates", "posts"],
  },
  {
    id: "feedback",
    label: "Feedback",
    entryPath: "/feedback",
    description: "Feedback board with ideas, votes, comments, and review status.",
    keywords: ["feedback", "ideas", "comment", "comments", "approval", "board", "thread", "vote"],
  },
  {
    id: "notes",
    label: "Notes",
    entryPath: "/notes",
    description: "Project notes with a tree, editor, and sidekick panels.",
    keywords: ["notes", "editor", "document", "documents", "toc", "table of contents", "writing"],
  },
  {
    id: "integrations",
    label: "Integrations",
    entryPath: "/integrations",
    description: "Configured third-party integrations and model providers.",
    keywords: ["integrations", "providers", "models", "api", "secrets", "connections"],
  },
  {
    id: "profile",
    label: "Profile",
    entryPath: "/profile",
    description: "User profile and account summary.",
    keywords: ["profile", "account", "summary", "stats"],
  },
];

const APPS_ROOT = path.join(process.cwd(), "interface", "src", "apps");
let cachedAppsPromise = null;

function parseStringLiteral(block, fieldName) {
  const match = block.match(new RegExp(`${fieldName}:\\s*"([^"]+)"`));
  return match ? match[1].trim() : null;
}

function parseKeywords(block, fieldName) {
  const match = block.match(new RegExp(`${fieldName}:\\s*\\[((?:.|\\n)*?)\\]`));
  if (!match) {
    return [];
  }

  return Array.from(
    new Set(
      [...match[1].matchAll(/"([^"]+)"/g)]
        .map((entry) => entry[1].trim())
        .filter(Boolean),
    ),
  );
}

function parseAppsFromRegistry(source) {
  const apps = [];
  const pattern = /createAppDefinition\(\s*\{([\s\S]*?)\}\s*,/g;

  for (const match of source.matchAll(pattern)) {
    const block = match[1];
    const id = parseStringLiteral(block, "id");
    const label = parseStringLiteral(block, "label");
    const entryPath = parseStringLiteral(block, "basePath");

    if (!id || !label || !entryPath) {
      continue;
    }

    apps.push({
      id,
      label,
      entryPath,
      description: parseStringLiteral(block, "agentDescription") || `${label} app`,
      keywords: parseKeywords(block, "agentKeywords"),
    });
  }

  return apps;
}

function normalizeArray(values, limit = 16) {
  return Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => String(value || "").trim())
        .filter(Boolean),
    ),
  ).slice(0, limit);
}

function escapeRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractStringMatches(source, pattern, limit = 16) {
  return normalizeArray(
    [...String(source || "").matchAll(pattern)].map((entry) => entry[1]),
    limit,
  );
}

async function walkFiles(dirPath) {
  const entries = await fs.readdir(dirPath, { withFileTypes: true }).catch(() => []);
  const files = [];

  for (const entry of entries) {
    const nextPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walkFiles(nextPath));
      continue;
    }
    files.push(nextPath);
  }

  return files;
}

function detectRouteKind(routeSource, routePattern) {
  const match = String(routeSource || "").match(routePattern);
  const snippet = match?.[0] || "";

  if (/ShellRoutePlaceholder/.test(snippet)) {
    return "placeholder";
  }
  if (/IndexRedirect/.test(snippet)) {
    return "redirect";
  }
  if (/element:\s*</.test(snippet)) {
    return "direct";
  }
  return "unknown";
}

function analyzeRoutes(app, routeSource) {
  const escapedId = escapeRegex(app.id);
  const basePattern = new RegExp(`path:\\s*"${escapedId}"[\\s\\S]{0,220}?element:\\s*<[^>]+>`, "i");
  const detailPattern = new RegExp(`path:\\s*"${escapedId}\\/:[^"]+"[\\s\\S]{0,220}?element:\\s*<[^>]+>`, "i");

  return {
    routeHints: extractStringMatches(routeSource, /path:\s*"([^"]+)"/g, 10),
    baseRouteKind: detectRouteKind(routeSource, basePattern),
    detailRouteKind: detectRouteKind(routeSource, detailPattern),
  };
}

async function inspectAppSource(app) {
  const appDir = path.join(APPS_ROOT, app.id);
  const routePath = path.join(appDir, "routes.tsx");
  const routeSource = await fs.readFile(routePath, "utf8").catch(() => "");
  const files = (await walkFiles(appDir)).filter((filePath) =>
    !filePath.endsWith(".test.tsx")
    && !filePath.endsWith(".module.css")
    && !filePath.endsWith("/index.ts")
  );
  const contents = await Promise.all(files.map((filePath) => fs.readFile(filePath, "utf8").catch(() => "")));
  const source = contents.join("\n");
  const ariaLabels = extractStringMatches(source, /aria-label\s*=\s*"([^"]+)"/g, 24);
  const surfaces = extractStringMatches(source, /data-agent-surface\s*=\s*"([^"]+)"/g, 24);
  const actions = extractStringMatches(source, /data-agent-action\s*=\s*"([^"]+)"/g, 24);
  const fields = extractStringMatches(source, /data-agent-field\s*=\s*"([^"]+)"/g, 24);
  const createLabels = normalizeArray([
    ...ariaLabels.filter((label) => /\b(new|create|add|post)\b/i.test(label)),
    ...actions.filter((label) => /\b(open|submit|create|add|new|post)\b/i.test(label)),
  ], 12);

  return {
    appDir: path.relative(process.cwd(), appDir).replace(/\\/g, "/"),
    routePath: path.relative(process.cwd(), routePath).replace(/\\/g, "/"),
    ...analyzeRoutes(app, routeSource),
    surfaces,
    actions,
    fields,
    ariaLabels,
    createLabels,
  };
}

function cloneApps(apps) {
  return apps.map((app) => ({
    ...app,
    keywords: [...(app.keywords ?? [])],
    sourceContext: app.sourceContext
      ? {
          ...app.sourceContext,
          routeHints: [...(app.sourceContext.routeHints ?? [])],
          surfaces: [...(app.sourceContext.surfaces ?? [])],
          actions: [...(app.sourceContext.actions ?? [])],
          fields: [...(app.sourceContext.fields ?? [])],
          ariaLabels: [...(app.sourceContext.ariaLabels ?? [])],
          createLabels: [...(app.sourceContext.createLabels ?? [])],
        }
      : null,
  }));
}

export async function listDemoAgentApps() {
  cachedAppsPromise ??= (async () => {
    const registryPath = path.join(process.cwd(), "interface", "src", "apps", "registry.ts");

    try {
      const source = await fs.readFile(registryPath, "utf8");
      const parsed = parseAppsFromRegistry(source);
      if (parsed.length > 0) {
        const enriched = await Promise.all(
          parsed.map(async (app) => ({
            ...app,
            sourceContext: await inspectAppSource(app),
          })),
        );
        return cloneApps(enriched);
      }
    } catch {
      // Fall back to a minimal app list when the source registry cannot be read.
    }

    return cloneApps(FALLBACK_APPS.map((app) => ({
      ...app,
      sourceContext: {
        appDir: `interface/src/apps/${app.id}`,
        routePath: `interface/src/apps/${app.id}/routes.tsx`,
        routeHints: [app.entryPath],
        baseRouteKind: "unknown",
        detailRouteKind: "unknown",
        surfaces: [],
        actions: [],
        fields: [],
        ariaLabels: [],
        createLabels: [],
      },
    })));
  })();

  return cloneApps(await cachedAppsPromise);
}
