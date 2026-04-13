import type { ComponentType, ReactNode } from "react";

export interface LeftMenuLeafEntry {
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
  suffix?: ReactNode;
  expanded: boolean;
  selected?: boolean;
  testId?: string;
  toggleMode?: "activate" | "secondary";
  children: LeftMenuLeafEntry[];
  emptyState?: LeftMenuEmptyEntry | null;
  onActivate: () => void;
  onToggle?: () => void;
}

export type LeftMenuEntry = LeftMenuGroupEntry | LeftMenuLeafEntry;

export interface DesktopLeftMenuPaneDefinition {
  appId: string;
  Pane: ComponentType;
}
