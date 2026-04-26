import {
  createElement,
  lazy,
  Suspense,
  type ComponentType,
  type ReactNode,
} from "react";
import type { RouteObject } from "react-router-dom";
import {
  Box,
  Brain,
  Bug,
  Check,
  Circle,
  CircleUserRound,
  Cpu,
  Cross,
  FileText,
  FolderOpen,
  GitCommitVertical,
  Plug,
  Store,
} from "lucide-react";
import type { AuraApp, AuraAppModule } from "./types";
import { agentsRoutes } from "./agents/routes";
import { marketplaceRoutes } from "./marketplace/routes";
import { projectsRoutes } from "./projects/routes";
import { tasksRoutes } from "./tasks/routes";
import { processRoutes } from "./process/routes";
import { feedRoutes } from "./feed/routes";
import { notesRoutes } from "./notes/routes";
import { feedbackRoutes } from "./feedback/routes";
import { integrationsRoutes } from "./integrations/routes";
import { debugRoutes } from "./debug/routes";
import { profileRoutes } from "./profile/routes";
import { aura3dRoutes } from "./aura3d/routes";
import { desktopRoutes } from "./desktop/routes";

type AppModuleLoader = () => Promise<AuraAppModule>;

const EmptyComponent = () => null;
function wrapLazyAppComponent<Props extends object>(
  loadApp: AppModuleLoader,
  selectComponent: (app: AuraAppModule) => ComponentType<Props> | undefined,
  fallbackRender?: (props: Props) => ReactNode,
): ComponentType<Props> {
  const LazyComponent = lazy(async () => {
    const app = await loadApp();
    return {
      default: selectComponent(app) ?? (EmptyComponent as ComponentType<Props>),
    };
  });

  function WrappedComponent(props: Props) {
    return createElement(
      Suspense,
      { fallback: fallbackRender ? fallbackRender(props) : null },
      createElement<Props>(LazyComponent, props),
    );
  }

  return WrappedComponent;
}

function createAppDefinition(
  metadata: Pick<AuraApp, "id" | "label" | "agentDescription" | "agentKeywords" | "icon" | "basePath" | "searchPlaceholder"> & {
    routes: RouteObject[];
    bareMainPanel?: boolean;
  },
  loadApp: AppModuleLoader,
  options?: {
    hasDesktopLeftMenuPane?: boolean;
    hasResponsiveControls?: boolean;
    hasSidekickPanel?: boolean;
    hasSidekickTaskbar?: boolean;
    hasPreviewPanel?: boolean;
    hasPreviewHeader?: boolean;
    hasProvider?: boolean;
    includePrefetch?: boolean;
  },
): AuraApp {
  let cachedAppPromise: Promise<AuraAppModule> | null = null;
  const loadAppOnce: AppModuleLoader = () => {
    cachedAppPromise ??= loadApp();
    return cachedAppPromise;
  };

  return {
    ...metadata,
    preload: () => loadAppOnce(),
    LeftPanel: wrapLazyAppComponent(loadAppOnce, (app) => app.LeftPanel),
    MainPanel: wrapLazyAppComponent(loadAppOnce, (app) => app.MainPanel) as AuraApp["MainPanel"],
    ...(options?.hasDesktopLeftMenuPane
      ? {
          DesktopLeftMenuPane: wrapLazyAppComponent(
            loadAppOnce,
            (app) => app.DesktopLeftMenuPane,
          ),
        }
      : {}),
    ...(options?.hasResponsiveControls
      ? {
          ResponsiveControls: wrapLazyAppComponent(
            loadAppOnce,
            (app) => app.ResponsiveControls,
          ),
        }
      : {}),
    ...(options?.hasSidekickPanel
      ? {
          SidekickPanel: wrapLazyAppComponent(
            loadAppOnce,
            (app) => app.SidekickPanel,
          ),
        }
      : {}),
    ...(options?.hasSidekickTaskbar
      ? {
          SidekickTaskbar: wrapLazyAppComponent(
            loadAppOnce,
            (app) => app.SidekickTaskbar,
          ),
        }
      : {}),
    ...(options?.hasPreviewPanel
      ? {
          PreviewPanel: wrapLazyAppComponent(
            loadAppOnce,
            (app) => app.PreviewPanel,
          ),
        }
      : {}),
    ...(options?.hasPreviewHeader
      ? {
          PreviewHeader: wrapLazyAppComponent(
            loadAppOnce,
            (app) => app.PreviewHeader,
          ),
        }
      : {}),
    ...(options?.hasProvider
      ? {
          Provider: wrapLazyAppComponent(
            loadAppOnce,
            (app) => app.Provider,
          ) as AuraApp["Provider"],
        }
      : {}),
    ...(options?.includePrefetch
      ? {
          onPrefetch: () => {
            void loadAppOnce().then((app) => app.onPrefetch?.());
          },
        }
      : {}),
  };
}

const loadAgentsApp = () =>
  import("./agents/AgentsApp").then((module) => module.AgentsApp);
const loadMarketplaceApp = () =>
  import("./marketplace/MarketplaceApp").then((module) => module.MarketplaceApp);
const loadProjectsApp = () =>
  import("./projects/ProjectsApp").then((module) => module.ProjectsApp);
const loadTasksApp = () =>
  import("./tasks/TasksApp").then((module) => module.TasksApp);
const loadProcessApp = () =>
  import("./process/ProcessApp").then((module) => module.ProcessApp);
const loadFeedApp = () =>
  import("./feed/FeedApp").then((module) => module.FeedApp);
const loadFeedbackApp = () =>
  import("./feedback/FeedbackApp").then((module) => module.FeedbackApp);
const loadIntegrationsApp = () =>
  import("./integrations/IntegrationsApp").then((module) => module.IntegrationsApp);
const loadDebugApp = () =>
  import("./debug/DebugApp").then((module) => module.DebugApp);
const loadNotesApp = () =>
  import("./notes/NotesApp").then((module) => module.NotesApp);
const loadProfileApp = () =>
  import("./profile/ProfileApp").then((module) => module.ProfileApp);
const loadAura3DApp = () =>
  import("./aura3d/Aura3DApp").then((module) => module.Aura3DApp);
const loadDesktopApp = () =>
  import("./desktop/DesktopApp/index").then((module) => module.DesktopApp);

export const apps: AuraApp[] = [
  createAppDefinition(
    {
      id: "agents",
      label: "Agents",
      agentDescription: "Standalone agent library and chat surfaces.",
      agentKeywords: ["agent", "agents", "chat", "model", "assistant", "conversation"],
      icon: Brain,
      basePath: "/agents",
      searchPlaceholder: "Search",
      routes: agentsRoutes,
    },
    loadAgentsApp,
    {
      hasResponsiveControls: true,
      hasSidekickPanel: true,
      hasSidekickTaskbar: true,
      includePrefetch: true,
    },
  ),
  createAppDefinition(
    {
      id: "marketplace",
      label: "Marketplace",
      agentDescription: "Marketplace for discovering talent and reusable capabilities.",
      agentKeywords: ["marketplace", "talent", "skills", "templates", "browse"],
      icon: Store,
      basePath: "/marketplace",
      searchPlaceholder: "Search talent",
      routes: marketplaceRoutes,
    },
    loadMarketplaceApp,
    {
      hasDesktopLeftMenuPane: true,
      hasResponsiveControls: true,
      hasSidekickPanel: true,
      hasSidekickTaskbar: true,
    },
  ),
  createAppDefinition(
    {
      id: "projects",
      label: "Projects",
      agentDescription: "Project workspace, specs, tasks, and agent entry points.",
      agentKeywords: ["project", "projects", "workspace", "spec", "task", "planning"],
      icon: FolderOpen,
      basePath: "/projects",
      searchPlaceholder: "Search",
      routes: projectsRoutes,
    },
    loadProjectsApp,
    {
      hasDesktopLeftMenuPane: true,
      hasResponsiveControls: true,
      hasSidekickPanel: true,
      hasSidekickTaskbar: true,
      hasPreviewPanel: true,
      hasPreviewHeader: true,
    },
  ),
  createAppDefinition(
    {
      id: "tasks",
      label: "Tasks",
      agentDescription: "Task execution, automation, and run management.",
      agentKeywords: ["task", "tasks", "automation", "run", "execution", "queue"],
      icon: Check,
      basePath: "/tasks",
      searchPlaceholder: "Search",
      routes: tasksRoutes,
    },
    loadTasksApp,
    {
      hasDesktopLeftMenuPane: true,
      hasResponsiveControls: true,
      hasSidekickPanel: true,
      hasSidekickTaskbar: true,
      hasPreviewPanel: true,
      hasPreviewHeader: true,
      hasProvider: true,
    },
  ),
  createAppDefinition(
    {
      id: "process",
      label: "Processes",
      agentDescription: "Process builder and node-based automation workflows.",
      agentKeywords: ["process", "processes", "workflow", "nodes", "automation", "graph"],
      icon: Cpu,
      basePath: "/process",
      searchPlaceholder: "Search",
      routes: processRoutes,
    },
    loadProcessApp,
    {
      hasDesktopLeftMenuPane: true,
      hasResponsiveControls: true,
      hasSidekickPanel: true,
      hasSidekickTaskbar: true,
      hasProvider: true,
    },
  ),
  createAppDefinition(
    {
      id: "feed",
      label: "Feed",
      agentDescription: "Organization activity feed and updates timeline.",
      agentKeywords: ["feed", "activity", "timeline", "updates", "posts"],
      icon: GitCommitVertical,
      basePath: "/feed",
      routes: feedRoutes,
    },
    loadFeedApp,
    {
      hasResponsiveControls: true,
      hasSidekickPanel: true,
      hasSidekickTaskbar: true,
    },
  ),
  createAppDefinition(
    {
      id: "notes",
      label: "Notes",
      agentDescription: "Project notes with a tree, editor, and sidekick panels.",
      agentKeywords: ["notes", "documents", "editor", "toc", "table of contents", "writing"],
      icon: FileText,
      basePath: "/notes",
      searchPlaceholder: "Search notes",
      routes: notesRoutes,
    },
    loadNotesApp,
    {
      hasResponsiveControls: true,
      hasSidekickPanel: true,
      hasSidekickTaskbar: true,
    },
  ),
  createAppDefinition(
    {
      id: "feedback",
      label: "Feedback",
      agentDescription: "Feedback board with ideas, votes, comments, and review status.",
      agentKeywords: ["feedback", "ideas", "votes", "comments", "approval", "board", "thread"],
      icon: Cross,
      basePath: "/feedback",
      searchPlaceholder: "Search feedback",
      routes: feedbackRoutes,
    },
    loadFeedbackApp,
    {
      hasResponsiveControls: true,
      hasSidekickPanel: true,
      hasSidekickTaskbar: true,
    },
  ),
  createAppDefinition(
    {
      id: "integrations",
      label: "Integrations",
      agentDescription: "Configured third-party integrations and model providers.",
      agentKeywords: ["integrations", "providers", "api", "models", "secrets", "connections"],
      icon: Plug,
      basePath: "/integrations",
      searchPlaceholder: "Search integrations",
      routes: integrationsRoutes,
    },
    loadIntegrationsApp,
    {
      hasResponsiveControls: true,
    },
  ),
  createAppDefinition(
    {
      id: "debug",
      label: "Debug",
      agentDescription: "Internal debugging panels and run inspection tools.",
      agentKeywords: ["debug", "trace", "runs", "diagnostics"],
      icon: Bug,
      basePath: "/debug",
      searchPlaceholder: "Search runs",
      routes: debugRoutes,
    },
    loadDebugApp,
    {
      hasResponsiveControls: true,
      hasSidekickPanel: true,
      hasSidekickTaskbar: true,
    },
  ),
  createAppDefinition(
    {
      id: "profile",
      label: "Profile",
      agentDescription: "User profile and account summary.",
      agentKeywords: ["profile", "account", "summary", "stats"],
      icon: CircleUserRound,
      basePath: "/profile",
      searchPlaceholder: "Search",
      routes: profileRoutes,
    },
    loadProfileApp,
    {
      hasSidekickPanel: true,
      hasSidekickTaskbar: true,
    },
  ),
  createAppDefinition(
    {
      id: "aura3d",
      label: "AURA 3D",
      agentDescription: "3D asset creation studio with image generation, 3D model creation, and tokenization.",
      agentKeywords: ["3d", "model", "image", "generate", "imagine", "tokenize", "asset", "glb"],
      icon: Box,
      basePath: "/3d",
      routes: aura3dRoutes,
    },
    loadAura3DApp,
    {
      hasResponsiveControls: true,
      hasSidekickPanel: true,
      hasSidekickTaskbar: true,
    },
  ),
  createAppDefinition(
    {
      id: "desktop",
      label: "Desktop",
      agentDescription: "Shell overview and desktop surface for launching apps.",
      agentKeywords: ["desktop", "shell", "home", "workspace", "launcher"],
      icon: Circle,
      basePath: "/desktop",
      routes: desktopRoutes,
      bareMainPanel: true,
    },
    loadDesktopApp,
  ),
];
