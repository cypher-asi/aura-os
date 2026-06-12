import { useCallback, useMemo, useState, type ReactElement } from "react";

import { ListItem } from "../ListItem";
import type { ListTreeNode } from "./types";
import styles from "./ListTree.module.css";

export type ListTreeProps = {
  nodes: ListTreeNode[];
  /** Controlled selection. Omit to let the tree track its own. */
  selectedId?: string | null;
  /** Initial selection when uncontrolled. */
  defaultSelectedId?: string | null;
  onSelect?: (node: ListTreeNode) => void;
  /** Controlled expansion. Omit to let the tree track its own. */
  expandedIds?: string[];
  defaultExpandedIds?: string[];
  onExpand?: (nodeId: string, expanded: boolean) => void;
  /** Clicking a parent row also toggles its expansion. */
  expandOnSelect?: boolean;
  /** Left padding in px added per nesting level. Defaults to 20. */
  indent?: number;
  /** Node currently in inline-rename mode. */
  editingNodeId?: string | null;
  onRenameCommit?: (nodeId: string, newLabel: string) => void;
  onRenameCancel?: (nodeId: string) => void;
  className?: string;
};

type TreeState = {
  expandedIds: ReadonlySet<string>;
  selectedId: string | null;
  indent: number;
  expandOnSelect: boolean;
  editingNodeId: string | null;
  handleSelect: (node: ListTreeNode) => void;
  handleExpand: (nodeId: string, expanded: boolean) => void;
  handleRenameCommit?: (nodeId: string, newLabel: string) => void;
  handleRenameCancel?: (nodeId: string) => void;
};

/**
 * Data-driven tree of {@link ListItem} rows. Owns selection and
 * expansion state (controlled or uncontrolled), nests infinitely, and
 * supports inline rename. Replaces the zui `Explorer` everywhere in
 * aura-os (drag-drop and multi-select were unused and are dropped).
 */
export function ListTree({
  nodes,
  selectedId,
  defaultSelectedId = null,
  onSelect,
  expandedIds,
  defaultExpandedIds,
  onExpand,
  expandOnSelect = false,
  indent = 20,
  editingNodeId = null,
  onRenameCommit,
  onRenameCancel,
  className,
}: ListTreeProps): ReactElement {
  const [internalExpandedIds, setInternalExpandedIds] = useState<Set<string>>(
    () => new Set(defaultExpandedIds),
  );
  const [internalSelectedId, setInternalSelectedId] = useState<string | null>(
    defaultSelectedId,
  );

  const isExpansionControlled = expandedIds !== undefined;
  const controlledExpandedSet = useMemo(
    () => (expandedIds !== undefined ? new Set(expandedIds) : null),
    [expandedIds],
  );
  const expandedSet = controlledExpandedSet ?? internalExpandedIds;
  const effectiveSelectedId =
    selectedId !== undefined ? selectedId : internalSelectedId;

  const handleExpand = useCallback(
    (nodeId: string, expanded: boolean) => {
      if (!isExpansionControlled) {
        setInternalExpandedIds((prev) => {
          const next = new Set(prev);
          if (expanded) next.add(nodeId);
          else next.delete(nodeId);
          return next;
        });
      }
      onExpand?.(nodeId, expanded);
    },
    [isExpansionControlled, onExpand],
  );

  const handleSelect = useCallback(
    (node: ListTreeNode) => {
      setInternalSelectedId(node.id);
      if (expandOnSelect && node.children) {
        handleExpand(node.id, !expandedSet.has(node.id));
      }
      onSelect?.(node);
    },
    [expandOnSelect, handleExpand, expandedSet, onSelect],
  );

  const tree: TreeState = {
    expandedIds: expandedSet,
    selectedId: effectiveSelectedId,
    indent,
    expandOnSelect,
    editingNodeId,
    handleSelect,
    handleExpand,
    handleRenameCommit: onRenameCommit,
    handleRenameCancel: onRenameCancel,
  };

  if (nodes.length === 0) {
    return (
      <div className={className ? `${styles.empty} ${className}` : styles.empty}>
        No items to display
      </div>
    );
  }

  return (
    <div
      role="tree"
      className={className ? `${styles.tree} ${className}` : styles.tree}
    >
      {nodes.map((node) => (
        <ListTreeItem key={node.id} node={node} depth={0} tree={tree} />
      ))}
    </div>
  );
}

type ListTreeItemProps = {
  node: ListTreeNode;
  depth: number;
  tree: TreeState;
};

function ListTreeItem({ node, depth, tree }: ListTreeItemProps): ReactElement {
  const isParent = node.children != null;
  const isExpanded = tree.expandedIds.has(node.id);
  const icon =
    isExpanded && node.expandedIcon != null ? node.expandedIcon : node.icon;

  return (
    <ListItem
      id={node.id}
      title={node.label}
      secondary={node.secondary}
      icon={icon}
      status={node.status}
      copyText={node.copyText}
      depth={depth}
      indent={tree.indent}
      selected={tree.selectedId === node.id}
      disabled={node.disabled}
      hasChildren={isParent}
      expanded={isParent ? isExpanded : undefined}
      onExpandedChange={
        isParent ? (next) => tree.handleExpand(node.id, next) : undefined
      }
      onSelect={() => tree.handleSelect(node)}
      editing={tree.editingNodeId === node.id}
      onRenameCommit={(value) => tree.handleRenameCommit?.(node.id, value)}
      onRenameCancel={() => tree.handleRenameCancel?.(node.id)}
    >
      {node.children?.map((child) => (
        <ListTreeItem key={child.id} node={child} depth={depth + 1} tree={tree} />
      ))}
    </ListItem>
  );
}
