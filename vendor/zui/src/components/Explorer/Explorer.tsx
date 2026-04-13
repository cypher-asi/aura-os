import { useCallback, useState, KeyboardEvent, useRef } from 'react';
import {
  DndContext,
  DragOverlay,
  DragStartEvent,
  DragEndEvent,
  DragOverEvent,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCenter,
  useDraggable,
  useDroppable,
} from '@dnd-kit/core';
import clsx from 'clsx';
import { Item } from '../Item';
import { Search } from '../Search';
import { ExplorerProvider, useExplorerContext } from './ExplorerContext';
import type { ExplorerProps, ExplorerNode, DropPosition } from './types';
import styles from './Explorer.module.css';

// Indentation constants for compact mode
const BASE_INDENT_COMPACT = 12;
const INDENT_STEP_COMPACT = 20;

// Indentation constants for menu-height mode
const BASE_INDENT_MENU = 12;
const INDENT_STEP_MENU = 24;

/**
 * Internal props for ExplorerItem
 */
interface ExplorerItemProps {
  node: ExplorerNode;
  level: number;
  path: string[];
  dropTargetId: string | null;
  activeDropPosition: DropPosition | null;
}

/**
 * ExplorerItem - Renders a single tree item using the unified Item component
 */
function ExplorerItem({ node, level, path, dropTargetId, activeDropPosition }: ExplorerItemProps) {
  const {
    expandedIds,
    selectedIds,
    lastSelectedId,
    toggleExpanded,
    selectNode,
    toggleSelection,
    selectRange,
    enableMultiSelect,
    enableDragDrop,
    expandOnSelect,
    searchQuery,
    matchingIds,
    focusedId,
    compact,
    chevronPosition,
  } = useExplorerContext();

  const isMatch = matchingIds.has(node.id);
  const isFocused = focusedId === node.id;
  const isActiveDropTarget = dropTargetId === node.id;

  const itemRef = useRef<HTMLButtonElement>(null);

  const isExpanded = expandedIds.has(node.id);
  const isSelected = selectedIds.has(node.id);
  const hasChildren = !!node.children;
  const isDisabled = node.disabled || false;

  // Drag and drop setup
  const {
    attributes,
    listeners,
    setNodeRef: setDraggableRef,
    isDragging,
  } = useDraggable({
    id: node.id,
    disabled: !enableDragDrop || isDisabled,
    data: { node, path },
  });

  const { setNodeRef: setDroppableRef, isOver: _isOver } = useDroppable({
    id: node.id,
    disabled: !enableDragDrop || isDisabled,
    data: { node, path },
  });

  // Combine refs
  const setRefs = useCallback(
    (element: HTMLButtonElement | null) => {
      setDraggableRef(element);
      setDroppableRef(element);
      (itemRef as React.MutableRefObject<HTMLButtonElement | null>).current = element;
    },
    [setDraggableRef, setDroppableRef]
  );

  // Handle click for selection
  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      if (isDisabled) return;
      e.stopPropagation();

      const hasModifier = e.ctrlKey || e.metaKey || e.shiftKey;

      if (enableMultiSelect) {
        if (e.ctrlKey || e.metaKey) {
          toggleSelection(node.id);
        } else if (e.shiftKey && lastSelectedId) {
          selectRange(lastSelectedId, node.id);
        } else {
          selectNode(node.id);
        }
      } else {
        selectNode(node.id);
      }

      if (expandOnSelect && hasChildren && !hasModifier) {
        toggleExpanded(node.id);
      }
    },
    [isDisabled, enableMultiSelect, lastSelectedId, node.id, selectNode, toggleSelection, selectRange, expandOnSelect, hasChildren, toggleExpanded]
  );

  // Handle chevron click
  const handleChevronClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (hasChildren && !isDisabled) {
        toggleExpanded(node.id);
      }
    },
    [hasChildren, isDisabled, node.id, toggleExpanded]
  );

  // Handle keyboard navigation
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (isDisabled) return;

      switch (e.key) {
        case 'Enter':
        case ' ':
          e.preventDefault();
          selectNode(node.id);
          if (expandOnSelect && hasChildren) {
            toggleExpanded(node.id);
          }
          break;
        case 'ArrowRight':
          if (hasChildren && !isExpanded) {
            e.preventDefault();
            toggleExpanded(node.id);
          }
          break;
        case 'ArrowLeft':
          if (hasChildren && isExpanded) {
            e.preventDefault();
            toggleExpanded(node.id);
          }
          break;
      }
    },
    [isDisabled, hasChildren, isExpanded, node.id, selectNode, toggleExpanded, expandOnSelect]
  );

  const indent = compact
    ? BASE_INDENT_COMPACT + level * INDENT_STEP_COMPACT
    : BASE_INDENT_MENU + level * INDENT_STEP_MENU;

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { role: _role, ...restAttributes } = attributes;

  // Merge click handler with dnd-kit listeners
  const mergedOnClick = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      handleClick(e);
      if (listeners?.onClick) {
        (listeners.onClick as (e: React.MouseEvent) => void)(e);
      }
    },
    [handleClick, listeners]
  );

  // Highlight matching text in label
  const renderLabel = () => {
    if (!searchQuery.trim() || !isMatch) {
      return node.label;
    }

    const lowerLabel = node.label.toLowerCase();
    const lowerQuery = searchQuery.toLowerCase();
    const index = lowerLabel.indexOf(lowerQuery);

    if (index === -1) return node.label;

    const before = node.label.slice(0, index);
    const match = node.label.slice(index, index + searchQuery.length);
    const after = node.label.slice(index + searchQuery.length);

    return (
      <>
        {before}
        <mark className={styles.highlight}>{match}</mark>
        {after}
      </>
    );
  };

  const chevronElement = hasChildren ? (
    <Item.Chevron
      className={styles.chevronButton}
      size="sm"
      expanded={isExpanded}
      onToggle={handleChevronClick}
    />
  ) : (
    chevronPosition === 'left' ? <Item.Spacer className={styles.leafSpacer} /> : null
  );

  return (
    <div className={styles.item}>
      <Item
        ref={setRefs}
        id={node.id}
        className={clsx(
          styles.itemContent,
          !compact && styles.itemMenuHeight,
          isSelected && styles.itemSelected,
          isDisabled && styles.itemDisabled,
          isDragging && styles.itemDragging,
          isActiveDropTarget && styles.itemDragOver,
          isMatch && styles.itemMatch,
          isFocused && styles.itemFocused
        )}
        indent={indent}
        selected={isSelected}
        disabled={isDisabled}
        onKeyDown={handleKeyDown}
        level={level}
        hasChildren={hasChildren}
        expanded={isExpanded}
        role="treeitem"
        {...restAttributes}
        {...listeners}
        onClick={mergedOnClick}
      >
        {chevronPosition === 'left' && chevronElement}

        {node.icon ? (
          <Item.Icon className={styles.icon}>{node.icon}</Item.Icon>
        ) : (
          <span className={styles.iconSpacer} />
        )}
        <Item.Label className={styles.label}>{renderLabel()}</Item.Label>
        {node.suffix && <span className={styles.suffix}>{node.suffix}</span>}

        {chevronPosition === 'right' && chevronElement}

        {isActiveDropTarget && activeDropPosition === 'before' && <div className={styles.dropIndicatorBefore} />}
        {isActiveDropTarget && activeDropPosition === 'after' && <div className={styles.dropIndicatorAfter} />}
        {isActiveDropTarget && activeDropPosition === 'inside' && <div className={styles.dropIndicatorInside} />}
      </Item>

      {hasChildren && (
        <div className={clsx(styles.children, !isExpanded && styles.childrenCollapsed)}>
          <div className={styles.childrenInner}>
            {node.children!.map((child) => (
              <ExplorerItem 
                key={child.id} 
                node={child} 
                level={level + 1} 
                path={[...path, child.id]}
                activeDropPosition={activeDropPosition}
                dropTargetId={dropTargetId}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Internal component that renders the explorer items
 */
function ExplorerContent() {
  const { flatNodes, selectedIds, onDrop, searchQuery, filteredData, enableDragDrop } = useExplorerContext();
  const [activeNode, setActiveNode] = useState<ExplorerNode | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; position: DropPosition } | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor)
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const node = flatNodes.find((n) => n.id === event.active.id)?.node;
    if (node) setActiveNode(node);
  }, [flatNodes]);

  const handleDragOver = useCallback(
    (event: DragOverEvent) => {
      if (!enableDragDrop) return;
      
      const { active, over } = event;
      if (!over || !active) {
        setDropTarget(null);
        return;
      }

      // Get the target node element to calculate position
      const targetElement = document.querySelector(`[id="${over.id}"]`);
      if (!targetElement) {
        setDropTarget(null);
        return;
      }

      const targetNode = flatNodes.find((n) => n.id === over.id);
      if (!targetNode) {
        setDropTarget(null);
        return;
      }

      // Calculate drop position based on pointer position
      const rect = targetElement.getBoundingClientRect();
      const pointerY = (event.activatorEvent as MouseEvent | null)?.clientY ?? event.delta.y;
      const y = pointerY - rect.top;
      const height = rect.height;

      let position: DropPosition;
      if (targetNode.hasChildren) {
        if (y < height * 0.25) position = 'before';
        else if (y > height * 0.75) position = 'after';
        else position = 'inside';
      } else {
        position = y < height * 0.5 ? 'before' : 'after';
      }

      setDropTarget({ id: over.id as string, position });
    },
    [flatNodes, enableDragDrop]
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      setActiveNode(null);
      
      const finalPosition = dropTarget?.position;
      setDropTarget(null);

      if (!over || active.id === over.id) return;

      const draggedNode = flatNodes.find((n) => n.id === active.id);
      const targetNode = flatNodes.find((n) => n.id === over.id);

      if (!draggedNode || !targetNode) return;
      if (targetNode.path.includes(active.id as string)) return;

      const position: DropPosition = finalPosition ?? (targetNode.hasChildren ? 'inside' : 'after');
      onDrop?.(active.id as string, over.id as string, position);
    },
    [flatNodes, onDrop, dropTarget]
  );

  // Use filtered data when searching, otherwise use all data
  const displayData = searchQuery.trim() ? filteredData : flatNodes.filter((n) => n.level === 0).map((n) => n.node);

  if (displayData.length === 0) {
    return <div className={styles.empty}>{searchQuery.trim() ? 'No matches found' : 'No items to display'}</div>;
  }

  const selectedCount = selectedIds.size;
  const isDraggingMultiple = activeNode && selectedIds.has(activeNode.id) && selectedCount > 1;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      <div role="tree">
        {displayData.map((node) => (
          <ExplorerItem 
            key={node.id} 
            node={node} 
            level={0} 
            path={[node.id]}
            activeDropPosition={dropTarget?.position ?? null}
            dropTargetId={dropTarget?.id ?? null}
          />
        ))}
      </div>

      <DragOverlay>
        {activeNode ? (
          <div className={styles.dragOverlay}>
            {activeNode.icon && <div className={styles.dragOverlayIcon}>{activeNode.icon}</div>}
            <div className={styles.dragOverlayLabel}>{activeNode.label}</div>
            {isDraggingMultiple && <div className={styles.dragOverlayCount}>{selectedCount}</div>}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

/**
 * Inner component that renders search with keyboard navigation
 */
function ExplorerSearch({
  searchQuery,
  searchPlaceholder,
  onSearchChange,
  onSearchClear,
}: {
  searchQuery: string;
  searchPlaceholder?: string;
  onSearchChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onSearchClear: () => void;
}) {
  const { moveFocus, selectFocused, focusedId } = useExplorerContext();

  const handleSearchKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          moveFocus('down');
          break;
        case 'ArrowUp':
          e.preventDefault();
          moveFocus('up');
          break;
        case 'Enter':
          e.preventDefault();
          if (focusedId) {
            selectFocused();
            onSearchClear();
          }
          break;
      }
    },
    [moveFocus, selectFocused, focusedId, onSearchClear]
  );

  return (
    <div className={styles.searchContainer}>
      <Search
        size="sm"
        placeholder={searchPlaceholder}
        value={searchQuery}
        onChange={onSearchChange}
        onKeyDown={handleSearchKeyDown}
        showClear
        onClear={onSearchClear}
      />
    </div>
  );
}

/**
 * Explorer - A tree component for displaying hierarchical data
 */
export function Explorer({
  data,
  onSelect,
  onExpand,
  onDrop,
  defaultExpandedIds,
  defaultSelectedIds,
  className,
  enableDragDrop = true,
  enableMultiSelect = true,
  expandOnSelect = false,
  searchable = false,
  searchPlaceholder,
  onSearch,
  compact = true,
  chevronPosition = 'left',
}: ExplorerProps) {
  const [searchQuery, setSearchQuery] = useState('');

  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const query = e.target.value;
      setSearchQuery(query);
      onSearch?.(query);
    },
    [onSearch]
  );

  const handleSearchClear = useCallback(() => {
    setSearchQuery('');
    onSearch?.('');
  }, [onSearch]);

  return (
    <div className={clsx(styles.explorer, className)}>
      <ExplorerProvider
        data={data}
        defaultExpandedIds={defaultExpandedIds}
        defaultSelectedIds={defaultSelectedIds}
        enableMultiSelect={enableMultiSelect}
        enableDragDrop={enableDragDrop}
        expandOnSelect={expandOnSelect}
        searchQuery={searchQuery}
        onSelect={onSelect}
        onExpand={onExpand}
        onDrop={onDrop}
        compact={compact}
        chevronPosition={chevronPosition}
      >
        {searchable && (
          <ExplorerSearch
            searchQuery={searchQuery}
            searchPlaceholder={searchPlaceholder}
            onSearchChange={handleSearchChange}
            onSearchClear={handleSearchClear}
          />
        )}
        <ExplorerContent />
      </ExplorerProvider>
    </div>
  );
}
