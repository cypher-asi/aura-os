import type { ReactNode } from "react";
import { Item } from "@cypher-asi/zui";
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
  /** Body, rendered only while expanded. */
  children?: ReactNode;
}

/**
 * Reusable collapsible item-row for the sidekick. Wraps the shared zui
 * `Item` primitive (the same one the Tasks / Specs `Explorer` rows use)
 * and applies the exact compact row styling those sections get, so any
 * sidekick section renders a visually identical header. The body is left
 * to the consumer and only mounted while expanded.
 */
export function SidekickCollapsibleRow({
  expanded,
  onToggle,
  label,
  suffix,
  showHeader = true,
  children,
}: SidekickCollapsibleRowProps) {
  return (
    <div className={styles.row}>
      {showHeader && (
        <Item
          className={styles.header}
          hasChildren
          expanded={expanded}
          onClick={onToggle}
        >
          <Item.Label>{label}</Item.Label>
          {suffix}
          <Item.Chevron size="sm" expanded={expanded} onToggle={onToggle} />
        </Item>
      )}
      {expanded && children}
    </div>
  );
}
