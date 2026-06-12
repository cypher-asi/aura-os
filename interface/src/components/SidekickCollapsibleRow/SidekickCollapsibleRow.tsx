import type { ReactNode } from "react";

import { ListItem } from "../ListItem";
import styles from "./SidekickCollapsibleRow.module.css";

interface SidekickCollapsibleRowProps {
  expanded: boolean;
  onToggle: () => void;
  label: ReactNode;
  /**
   * Right-aligned status content rendered after the label (e.g. the Run
   * pane's per-task status badge). The single section-specific affordance
   * a row is allowed to add on top of the shared Tasks / Specs styling.
   */
  suffix?: ReactNode;
  /**
   * When `false`, the chevron/label header is hidden and only the body is
   * rendered. Used by embedding surfaces (the Tasks-tab task preview) that
   * already label the section themselves.
   */
  showHeader?: boolean;
  /** Body, collapsed/expanded with the header chevron. */
  children?: ReactNode;
}

/**
 * Reusable collapsible item-row for the sidekick. Thin wrapper over the
 * shared `ListItem` primitive (the same row the Tasks / Specs / Files
 * trees use), so any sidekick section renders a visually identical
 * header with the standard animated expand/collapse.
 */
export function SidekickCollapsibleRow({
  expanded,
  onToggle,
  label,
  suffix,
  showHeader = true,
  children,
}: SidekickCollapsibleRowProps) {
  if (!showHeader) {
    return <div className={styles.row}>{children}</div>;
  }

  return (
    <ListItem
      className={styles.row}
      title={label}
      status={suffix}
      hasChildren
      expanded={expanded}
      onExpandedChange={onToggle}
      onSelect={onToggle}
    >
      {children}
    </ListItem>
  );
}
