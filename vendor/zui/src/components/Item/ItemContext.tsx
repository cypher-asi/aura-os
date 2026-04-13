import { createContext, useContext, useState, useCallback, useMemo } from 'react';
import type { ItemListContextValue, ItemListProviderProps } from './types';
import { getItemRange } from './hooks';

// ============================================================================
// Context
// ============================================================================

const ItemListContext = createContext<ItemListContextValue | null>(null);

/**
 * useItemListContext - Hook to access item list state
 *
 * Must be used within an ItemListProvider.
 *
 * @example
 * ```tsx
 * function MyItem({ id }) {
 *   const { selectedIds, selectItem, toggleExpanded } = useItemListContext();
 *   const isSelected = selectedIds.has(id);
 *   // ...
 * }
 * ```
 */
export function useItemListContext(): ItemListContextValue {
  const context = useContext(ItemListContext);
  if (!context) {
    throw new Error('useItemListContext must be used within an ItemListProvider');
  }
  return context;
}

/**
 * useItemListContextOptional - Hook to optionally access item list state
 *
 * Returns null if not within an ItemListProvider.
 * Useful for components that can work both with and without a provider.
 */
export function useItemListContextOptional(): ItemListContextValue | null {
  return useContext(ItemListContext);
}

// ============================================================================
// Provider
// ============================================================================

/**
 * ItemListProvider - Provider for item list state management
 *
 * Manages selection, expansion, and drag-drop state for a list of items.
 * Use this when you need shared state across multiple Item components.
 *
 * @example
 * ```tsx
 * function FileExplorer({ files }) {
 *   const itemIds = useMemo(() => flattenFileIds(files), [files]);
 *
 *   return (
 *     <ItemListProvider
 *       itemIds={itemIds}
 *       enableMultiSelect
 *       enableDragDrop
 *       onSelectionChange={(ids) => console.log('Selected:', ids)}
 *       onDrop={(dragId, targetId, pos) => handleDrop(dragId, targetId, pos)}
 *     >
 *       {files.map(file => <FileItem key={file.id} file={file} />)}
 *     </ItemListProvider>
 *   );
 * }
 * ```
 */
export function ItemListProvider({
  children,
  defaultSelectedIds = [],
  defaultExpandedIds = [],
  enableMultiSelect = false,
  enableDragDrop = false,
  onSelectionChange,
  onExpansionChange,
  onDrop,
  itemIds = [],
}: ItemListProviderProps) {
  // Selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(defaultSelectedIds)
  );
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(
    defaultSelectedIds.length > 0 ? defaultSelectedIds[defaultSelectedIds.length - 1] : null
  );

  // Expansion state
  const [expandedIds, setExpandedIds] = useState<Set<string>>(
    () => new Set(defaultExpandedIds)
  );

  // Select a single item (clears other selections)
  const selectItem = useCallback(
    (id: string) => {
      const newSelected = new Set([id]);
      setSelectedIds(newSelected);
      setLastSelectedId(id);
      onSelectionChange?.(Array.from(newSelected));
    },
    [onSelectionChange]
  );

  // Toggle selection of an item (for Ctrl+click)
  const toggleSelection = useCallback(
    (id: string) => {
      setSelectedIds((prev) => {
        const newSelected = new Set(prev);
        if (newSelected.has(id)) {
          newSelected.delete(id);
        } else {
          newSelected.add(id);
        }
        onSelectionChange?.(Array.from(newSelected));
        return newSelected;
      });
      setLastSelectedId(id);
    },
    [onSelectionChange]
  );

  // Select a range of items (for Shift+click)
  const selectRange = useCallback(
    (fromId: string, toId: string) => {
      const range = getItemRange(itemIds, fromId, toId);
      const newSelected = new Set(range);
      setSelectedIds(newSelected);
      setLastSelectedId(toId);
      onSelectionChange?.(Array.from(newSelected));
    },
    [itemIds, onSelectionChange]
  );

  // Clear all selections
  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
    setLastSelectedId(null);
    onSelectionChange?.([]);
  }, [onSelectionChange]);

  // Toggle expansion of an item
  const toggleExpanded = useCallback(
    (id: string) => {
      setExpandedIds((prev) => {
        const newExpanded = new Set(prev);
        const isExpanding = !newExpanded.has(id);
        if (isExpanding) {
          newExpanded.add(id);
        } else {
          newExpanded.delete(id);
        }
        onExpansionChange?.(id, isExpanding);
        return newExpanded;
      });
    },
    [onExpansionChange]
  );

  // Memoize context value
  const value = useMemo<ItemListContextValue>(
    () => ({
      selectedIds,
      expandedIds,
      lastSelectedId,
      selectItem,
      toggleSelection,
      selectRange,
      clearSelection,
      toggleExpanded,
      enableMultiSelect,
      enableDragDrop,
      onSelectionChange,
      onExpansionChange,
      onDrop,
      itemIds,
    }),
    [
      selectedIds,
      expandedIds,
      lastSelectedId,
      selectItem,
      toggleSelection,
      selectRange,
      clearSelection,
      toggleExpanded,
      enableMultiSelect,
      enableDragDrop,
      onSelectionChange,
      onExpansionChange,
      onDrop,
      itemIds,
    ]
  );

  return (
    <ItemListContext.Provider value={value}>
      {children}
    </ItemListContext.Provider>
  );
}
