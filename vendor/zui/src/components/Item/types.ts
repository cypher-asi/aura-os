import { ReactNode, MouseEvent, KeyboardEvent, HTMLAttributes, CSSProperties } from 'react';

/**
 * Drop position for drag-and-drop operations
 */
export type DropPosition = 'before' | 'after' | 'inside';

/**
 * Drag event handler type
 */
export type DragStartHandler = (id: string, event: React.DragEvent) => void;

/**
 * Drop event handler type
 */
export type DropHandler = (
  draggedId: string,
  targetId: string,
  position: DropPosition
) => void;

/**
 * Base props for the Item component
 */
export interface ItemProps extends Omit<HTMLAttributes<HTMLButtonElement>, 'onClick' | 'onKeyDown'> {
  /** Unique identifier for the item */
  id?: string;
  /** Whether the item is selected */
  selected?: boolean;
  /** Alias for selected (NavItem compatibility) */
  active?: boolean;
  /** Whether the item is disabled */
  disabled?: boolean;
  /** Left indentation in pixels (for nested items) */
  indent?: number;
  /** Click handler */
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
  /** Keyboard event handler */
  onKeyDown?: (event: KeyboardEvent<HTMLButtonElement>) => void;
  /** Item content (use Item.Icon, Item.Label, etc.) */
  children: ReactNode;
  /** ARIA role override (default: depends on context) */
  role?: string;
  /** Whether the item has children (for tree items) */
  hasChildren?: boolean;
  /** Whether children are expanded (for tree items) */
  expanded?: boolean;
  /** Nesting level (for accessibility) */
  level?: number;
}

/**
 * Props for the Item.Icon subcomponent
 */
export interface ItemIconProps {
  /** Icon element to render */
  children: ReactNode;
  /** Additional CSS class */
  className?: string;
}

/**
 * Props for the Item.Label subcomponent
 */
export interface ItemLabelProps {
  /** Label text or element */
  children: ReactNode;
  /** Additional CSS class */
  className?: string;
}

/**
 * Props for the Item.Chevron subcomponent
 */
export interface ItemChevronProps {
  /** Whether the item is expanded */
  expanded?: boolean;
  /** Toggle handler */
  onToggle?: (event: MouseEvent<HTMLButtonElement>) => void;
  /** Additional CSS class */
  className?: string;
  /** Size of the chevron button */
  size?: 'sm' | 'md';
  /** Whether to show a spacer when no chevron is needed */
  showSpacer?: boolean;
}

/**
 * Props for the Item.Action subcomponent
 */
export interface ItemActionProps {
  /** Action content (buttons, icons, etc.) */
  children: ReactNode;
  /** Additional CSS class */
  className?: string;
}

/**
 * Props for the Item.Spacer subcomponent (placeholder for chevron alignment)
 */
export interface ItemSpacerProps {
  /** Additional CSS class */
  className?: string;
}

/**
 * Props for the ItemDetailed component - a detailed item with icon, label, and description.
 * Used for mega menus, detailed lists, and other contexts requiring rich item display.
 */
export interface ItemDetailedProps {
  /** Unique identifier for the item */
  id: string;
  /** Icon displayed on the left */
  icon?: ReactNode;
  /** Primary text label */
  label: string;
  /** Secondary description text below the label */
  description?: string;
  /** Whether the item is disabled */
  disabled?: boolean;
  /** Whether the item is selected */
  selected?: boolean;
  /** Click handler */
  onClick?: () => void;
  /** Additional CSS class */
  className?: string;
  /** Inline styles */
  style?: CSSProperties;
  /** ARIA role override */
  role?: string;
  /** Tab index override */
  tabIndex?: number;
}

/**
 * Context value for item list state management
 */
export interface ItemListContextValue {
  /** Set of currently selected item IDs */
  selectedIds: Set<string>;
  /** Set of currently expanded item IDs */
  expandedIds: Set<string>;
  /** ID of the last selected item (for range selection) */
  lastSelectedId: string | null;
  /** Select a single item */
  selectItem: (id: string) => void;
  /** Toggle item selection (for Ctrl+click) */
  toggleSelection: (id: string) => void;
  /** Select a range of items (for Shift+click) */
  selectRange: (fromId: string, toId: string) => void;
  /** Clear all selections */
  clearSelection: () => void;
  /** Toggle expansion state of an item */
  toggleExpanded: (id: string) => void;
  /** Whether multi-select is enabled */
  enableMultiSelect: boolean;
  /** Whether drag-drop is enabled */
  enableDragDrop: boolean;
  /** Callback when selection changes */
  onSelectionChange?: (selectedIds: string[]) => void;
  /** Callback when expansion changes */
  onExpansionChange?: (id: string, expanded: boolean) => void;
  /** Callback when drop occurs */
  onDrop?: DropHandler;
  /** Flat list of all items for range selection */
  itemIds: string[];
}

/**
 * Props for the ItemListProvider component
 */
export interface ItemListProviderProps {
  /** Child components */
  children: ReactNode;
  /** Default selected item IDs */
  defaultSelectedIds?: string[];
  /** Default expanded item IDs */
  defaultExpandedIds?: string[];
  /** Whether multi-select is enabled */
  enableMultiSelect?: boolean;
  /** Whether drag-drop is enabled */
  enableDragDrop?: boolean;
  /** Callback when selection changes */
  onSelectionChange?: (selectedIds: string[]) => void;
  /** Callback when expansion changes */
  onExpansionChange?: (id: string, expanded: boolean) => void;
  /** Callback when drop occurs */
  onDrop?: DropHandler;
  /** Flat list of all item IDs (for range selection) */
  itemIds?: string[];
}

/**
 * Drag-drop hook options
 */
export interface UseItemDndOptions {
  /** Item ID */
  id: string;
  /** Whether drag-drop is enabled */
  enabled?: boolean;
  /** Whether the item is disabled */
  disabled?: boolean;
  /** Custom data to attach to drag operation */
  data?: Record<string, unknown>;
}

/**
 * Drag-drop hook return value
 */
export interface UseItemDndReturn {
  /** Ref for the draggable/droppable element */
  setNodeRef: (element: HTMLElement | null) => void;
  /** Whether the item is being dragged */
  isDragging: boolean;
  /** Whether something is being dragged over this item */
  isOver: boolean;
  /** Current drop position */
  dropPosition: DropPosition | null;
  /** Drag attributes for the element (from @dnd-kit) */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  dragAttributes: any;
  /** Drag listeners for the element (from @dnd-kit) */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  dragListeners: any;
  /** Handler for drag over events */
  handleDragOver: (event: React.DragEvent) => void;
  /** Handler for drag leave events */
  handleDragLeave: () => void;
}

/**
 * Keyboard navigation hook options
 */
export interface UseItemKeyboardOptions {
  /** Item ID */
  id: string;
  /** Whether the item is disabled */
  disabled?: boolean;
  /** Whether the item has children */
  hasChildren?: boolean;
  /** Whether children are expanded */
  expanded?: boolean;
  /** Callback when item is selected */
  onSelect?: (id: string) => void;
  /** Callback when expansion is toggled */
  onToggleExpanded?: (id: string) => void;
  /** Whether expanding on select is enabled */
  expandOnSelect?: boolean;
}

/**
 * Multi-select hook options
 */
export interface UseItemSelectionOptions {
  /** Item ID */
  id: string;
  /** Whether multi-select is enabled */
  enableMultiSelect?: boolean;
  /** Current selected IDs */
  selectedIds: Set<string>;
  /** Last selected ID for range selection */
  lastSelectedId: string | null;
  /** All item IDs in order (for range selection) */
  itemIds: string[];
  /** Select single item */
  selectItem: (id: string) => void;
  /** Toggle selection */
  toggleSelection: (id: string) => void;
  /** Select range */
  selectRange: (fromId: string, toId: string) => void;
}
