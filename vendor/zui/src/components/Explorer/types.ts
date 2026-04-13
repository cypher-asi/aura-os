import { ReactNode } from 'react';

/**
 * Represents a single node in the explorer tree
 */
export interface ExplorerNode {
  /** Unique identifier for the node */
  id: string;
  /** Display text for the node */
  label: string;
  /** Optional icon to display before the label */
  icon?: ReactNode;
  /** Optional content rendered after the label (e.g. status icons) */
  suffix?: ReactNode;
  /** Child nodes */
  children?: ExplorerNode[];
  /** Custom metadata that can be attached to the node */
  metadata?: Record<string, unknown>;
  /** Whether the node is disabled (cannot be selected or dragged) */
  disabled?: boolean;
}

/**
 * Main props for the Explorer component
 */
export interface ExplorerProps {
  /** Tree data structure to render */
  data: ExplorerNode[];
  /** Callback when selection changes */
  onSelect?: (selectedIds: string[]) => void;
  /** Callback when a node is expanded or collapsed */
  onExpand?: (nodeId: string, expanded: boolean) => void;
  /** Callback when a drag and drop operation completes */
  onDrop?: (draggedId: string, targetId: string, position: DropPosition) => void;
  /** IDs of nodes that should be expanded by default */
  defaultExpandedIds?: string[];
  /** IDs of nodes that should be selected by default */
  defaultSelectedIds?: string[];
  /** Additional CSS class name */
  className?: string;
  /** Whether to enable drag and drop (default: true) */
  enableDragDrop?: boolean;
  /** Whether to enable multi-selection (default: true) */
  enableMultiSelect?: boolean;
  /** Whether selecting a parent toggles expand/collapse */
  expandOnSelect?: boolean;
  /** Whether to show inline search input (default: false) */
  searchable?: boolean;
  /** Placeholder text for search input */
  searchPlaceholder?: string;
  /** Callback when search query changes */
  onSearch?: (query: string) => void;
  /** Whether to use compact item height (default: true). When false, items match typical menu item height. */
  compact?: boolean;
  /** Position of the expand/collapse chevron (default: 'left') */
  chevronPosition?: 'left' | 'right';
}

/**
 * Props for the Item component
 */
export interface ItemProps {
  /** The node data to render */
  node: ExplorerNode;
  /** Current nesting level (0-based) */
  level: number;
  /** Path to this node (array of IDs from root to this node) */
  path: string[];
}

/**
 * Position where an item can be dropped
 */
export type DropPosition = 'before' | 'after' | 'inside';

/**
 * Internal context state for the Explorer
 */
export interface ExplorerContextValue {
  /** Set of currently expanded node IDs */
  expandedIds: Set<string>;
  /** Set of currently selected node IDs */
  selectedIds: Set<string>;
  /** ID of the last selected node (for shift-click range selection) */
  lastSelectedId: string | null;
  /** Toggle expansion state of a node */
  toggleExpanded: (nodeId: string) => void;
  /** Set the expanded state of a node */
  setExpanded: (nodeId: string, expanded: boolean) => void;
  /** Select a single node */
  selectNode: (nodeId: string) => void;
  /** Toggle selection of a node */
  toggleSelection: (nodeId: string) => void;
  /** Select a range of nodes */
  selectRange: (fromId: string, toId: string) => void;
  /** Clear all selections */
  clearSelection: () => void;
  /** Whether multi-select is enabled */
  enableMultiSelect: boolean;
  /** Whether drag and drop is enabled */
  enableDragDrop: boolean;
  /** Whether selecting a parent toggles expand/collapse */
  expandOnSelect: boolean;
  /** Current search query */
  searchQuery: string;
  /** Set of node IDs that match the search query */
  matchingIds: Set<string>;
  /** Filtered tree data (only matching nodes and ancestors) */
  filteredData: ExplorerNode[];
  /** Currently focused node ID (for keyboard navigation) */
  focusedId: string | null;
  /** Move focus to next/previous item */
  moveFocus: (direction: 'up' | 'down') => void;
  /** Select the currently focused item */
  selectFocused: () => void;
  /** Set focused ID */
  setFocusedId: (id: string | null) => void;
  /** Callback for selection changes */
  onSelect?: (selectedIds: string[]) => void;
  /** Callback for expansion changes */
  onExpand?: (nodeId: string, expanded: boolean) => void;
  /** Callback for drop operations */
  onDrop?: (draggedId: string, targetId: string, position: DropPosition) => void;
  /** Flat array of all nodes in the tree */
  flatNodes: FlatNode[];
  /** Whether to use compact item height */
  compact: boolean;
  /** Position of the expand/collapse chevron */
  chevronPosition: 'left' | 'right';
}

/**
 * Flattened node representation for easier traversal
 */
export interface FlatNode {
  id: string;
  node: ExplorerNode;
  level: number;
  path: string[];
  parentId: string | null;
  hasChildren: boolean;
}
