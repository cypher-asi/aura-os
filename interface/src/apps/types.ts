import type { LucideIcon } from "lucide-react";
import type { ReactNode, ComponentType } from "react";
import type { RouteObject } from "react-router-dom";

export interface AuraApp {
  id: string;
  label: string;
  icon: LucideIcon;
  basePath: string;
  LeftPanel: ComponentType;
  /** Optional persistent desktop left menu pane used by the shared shell host. */
  DesktopLeftMenuPane?: ComponentType;
  /**
   * Wraps the active route element. The shell renders this as chrome around
   * the matched `<Outlet />`, so panel-scoped setup (e.g. `ResponsiveMainLane`)
   * stays in the app rather than leaking into every route element.
   */
  MainPanel: ComponentType<{ children?: ReactNode }>;
  ResponsiveControls?: ComponentType;
  SidekickPanel?: ComponentType;
  /** Rendered in the sidekick Lane's `header` slot (e.g. tab bar). */
  SidekickTaskbar?: ComponentType;
  PreviewPanel?: ComponentType;
  PreviewHeader?: ComponentType;
  Provider?: ComponentType<{ children: ReactNode }>;
  /** Placeholder text shown in the sidebar search input when this app is active. */
  searchPlaceholder?: string;
  /**
   * Routes owned by this app. `App.tsx` flattens these under the shell layout,
   * making the app module the single source of truth for which pathnames it
   * handles. Each route's `path` should be absolute (relative to the shell
   * layout's base — typically `<appId>` / `<appId>/:id`).
   */
  routes: RouteObject[];
  /**
   * Starts loading the app module without activating any optional prefetch side effects.
   * Returns the underlying module Promise so callers (e.g. the boot reveal gate in
   * `lib/boot-shell.ts`) can await readiness of the initial shell app before revealing
   * the desktop window, avoiding an "empty shell chrome, then content fills in" blink.
   */
  preload?: () => Promise<unknown>;
  /** Called on hover/focus of the nav rail item to warm caches before navigation. */
  onPrefetch?: () => void;
}

/**
 * Shape of the lazy-loaded module exported from each `apps/<name>/<Name>App.ts`.
 * These modules provide the panel components, icon, and metadata but are kept
 * free of routing concerns — the registry pairs them with a statically-loaded
 * `routes` list so large panel code doesn't need to be evaluated just to
 * resolve which URLs the app owns.
 */
export type AuraAppModule = Omit<AuraApp, "routes" | "preload">;
