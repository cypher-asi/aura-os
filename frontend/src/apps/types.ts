import type { LucideIcon } from "lucide-react";
import type { ReactNode, ComponentType } from "react";

export interface AuraApp {
  id: string;
  label: string;
  icon: LucideIcon;
  basePath: string;
  LeftPanel: ComponentType;
  MainPanel: ComponentType;
  SidekickPanel?: ComponentType;
  /** Rendered in the sidekick Lane's `header` slot (e.g. tab bar). */
  SidekickTaskbar?: ComponentType;
  /** Rendered in the sidekick Lane's `taskbar` slot (e.g. automation bar). */
  SidekickHeader?: ComponentType;
  /** Hook returning true when the sidekick lane should collapse to zero width. */
  useSidekickCollapsed?: () => boolean;
  PreviewPanel?: ComponentType;
  PreviewHeader?: ComponentType;
  Provider?: ComponentType<{ children: ReactNode }>;
  /** Placeholder text shown in the sidebar search input when this app is active. */
  searchPlaceholder?: string;
}
