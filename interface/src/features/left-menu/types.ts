import type { ComponentType, ReactNode } from "react";

export interface LeftMenuItemEntry {
  kind: "item";
  id: string;
  label: string;
  icon?: ReactNode;
  suffix?: ReactNode;
  disabled?: boolean;
  selected?: boolean;
  testId?: string;
  onSelect: () => void;
}

/**
 * Escape hatch for apps that need a richer row than the standard
 * icon/label/suffix leaf (e.g. the Agents list, which renders an avatar,
 * preview line, and timestamp). The app supplies the already-rendered row
 * as `content`; the tree only owns layout, virtualization, and the reveal
 * cascade. Keeps `features/left-menu` free of any app-component imports.
 */
export interface LeftMenuCustomEntry {
  kind: "custom";
  id: string;
  content: ReactNode;
  /** Initial virtualizer size estimate; real height is measured from the DOM. */
  estimatedHeight?: number;
  testId?: string;
}

export type LeftMenuLeafEntry = LeftMenuItemEntry | LeftMenuCustomEntry;

export interface LeftMenuEmptyEntry {
  id: string;
  label: string;
  icon?: ReactNode;
  testId?: string;
}

export interface LeftMenuGroupEntry {
  kind: "group";
  id: string;
  label: string;
  icon?: ReactNode;
  /** Icon shown instead of `icon` while the group is expanded. */
  expandedIcon?: ReactNode;
  suffix?: ReactNode;
  variant?: "default" | "section";
  expanded: boolean;
  selected?: boolean;
  testId?: string;
  toggleMode?: "activate" | "secondary";
  children: LeftMenuEntry[];
  emptyState?: LeftMenuEmptyEntry | null;
  onActivate: () => void;
  onToggle?: () => void;
}

export type LeftMenuEntry = LeftMenuGroupEntry | LeftMenuLeafEntry;

export interface DesktopLeftMenuPaneDefinition {
  appId: string;
  Pane: ComponentType;
}
