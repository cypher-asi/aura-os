import {
  createElement,
  lazy,
  Suspense,
  type ComponentType,
  type ReactNode,
} from "react";
import type { RouteObject } from "react-router-dom";
import {
  Brain,
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
import { profileRoutes } from "./profile/routes";
import { desktopRoutes } from "./desktop/routes";

type AppModuleLoader = () => Promise<AuraAppModule>;

const EmptyComponent = () => null;
function wrapLazyAppComponent<Props>(
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
      createElement(LazyComponent as ComponentType<any>, props as any),
    );
  }

  return WrappedComponent;
}

function createAppDefinition(
  metadata: Pick<AuraApp, "id" | "label" | "icon" | "basePath" | "searchPlaceholder"> & {
    routes: RouteObject[];
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
const loadNotesApp = () =>
  import("./notes/NotesApp").then((module) => module.NotesApp);
const loadProfileApp = () =>
  import("./profile/ProfileApp").then((module) => module.ProfileApp);
const loadDesktopApp = () =>
  import("./desktop/DesktopApp/index").then((module) => module.DesktopApp);

export const apps: AuraApp[] = [
  createAppDefinition(
    {
      id: "agents",
      label: "Agents",
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
      id: "profile",
      label: "Profile",
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
      id: "desktop",
      label: "Desktop",
      icon: Circle,
      basePath: "/desktop",
      routes: desktopRoutes,
    },
    loadDesktopApp,
  ),
];
