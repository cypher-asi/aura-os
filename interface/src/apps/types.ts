import type { LucideIcon } from "lucide-react";
import type { ReactNode, ComponentType } from "react";
import type { RouteObject } from "react-router-dom";

export interface AuraApp {
  id: string;
  label: string;
  /** Short phrase agents can use to recognize this app in the UI and prompts. */
  agentDescription?: string;
  /** Searchable keywords that help browser agents match changelog themes to this app. */
  agentKeywords?: string[];
  icon: LucideIcon;
  basePath: string;
  LeftPanel: ComponentType;
  /** Optional persistent desktop left menu pane used by the shared shell host. */
  DesktopLeftMenuPane?: ComponentType;
  /**
   * Wraps the active route element. The shell renders this inside a persistent
   * `ResponsiveMainLane` (the "middle root panel") so that switching between
   * apps swaps inner content rather than tearing down the visible container.
   * Apps therefore return inner JSX only — no `<Lane>` / `<ResponsiveMainLane>`
   * wrapper of their own. To opt out (e.g. the Desktop wallpaper surface), set
   * `bareMainPanel: true` and the shell will render `MainPanel` directly inside
   * `mainPanelHost` without the persistent lane.
   */
  MainPanel: ComponentType<{ children?: ReactNode }>;
  /**
   * When true, the shell renders this app's `MainPanel` directly inside
   * `mainPanelHost` without wrapping it in the persistent `ResponsiveMainLane`.
   * Used by the Desktop app, whose marquee surface needs a transparent
   * full-bleed area over the wallpaper rather than a Lane chrome.
   */
  bareMainPanel?: boolean;
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
   * When true, this app starts in the "Hidden" section of the Apps modal and
   * is omitted from the visible taskbar strip until the user explicitly drags
   * it into the visible section. Honored only on first load (when the user
   * has no saved hidden-apps entry); once the user customizes their layout
   * the saved value wins.
   */
  defaultHidden?: boolean;
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
