import type { ReactNode } from "react";

/**
 * Data node for {@link ListTree} (and for the LeftMenu pipeline, which
 * shares the same node shape). Replaces the zui `ExplorerNode` /
 * `ExplorerNodeWithSuffix` types.
 */
export type ListTreeNode = {
  id: string;
  label: string;
  /** Muted second line rendered under the label. */
  secondary?: ReactNode;
  icon?: ReactNode;
  /** Icon swapped in while the node is expanded (e.g. an open folder). */
  expandedIcon?: ReactNode;
  /** Right-aligned status content (status icon, badge, row actions). */
  status?: ReactNode;
  /** When provided, the row renders a copy button for this text. */
  copyText?: string;
  disabled?: boolean;
  metadata?: Record<string, unknown>;
  children?: ListTreeNode[];
};
