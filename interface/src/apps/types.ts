import type { LucideIcon } from "lucide-react";
import type { ReactNode, ComponentType } from "react";

export interface AuraApp {
  id: string;
  label: string;
  icon: LucideIcon;
  basePath: string;
  LeftPanel: ComponentType;
  /** Optional persistent desktop left menu pane used by the shared shell host. */
  DesktopLeftMenuPane?: ComponentType;
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
  /** Starts loading the app module without activating any optional prefetch side effects. */
  preload?: () => void;
  /** Called on hover/focus of the nav rail item to warm caches before navigation. */
  onPrefetch?: () => void;
}
