import { useCallback, MouseEvent } from 'react';
import type { UseItemSelectionOptions } from '../types';

/**
 * useItemSelection - Hook for multi-select functionality on items
 *
 * Provides click handlers that support:
 * - Regular click: Select single item
 * - Ctrl/Cmd + click: Toggle selection (add/remove from selection)
 * - Shift + click: Range selection (select all items between last and current)
 *
 * @example
 * ```tsx
 * function ListItem({ id }) {
 *   const { selectedIds, selectItem, toggleSelection, selectRange, lastSelectedId, itemIds } = useContext(ItemListContext);
 *
 *   const handleClick = useItemSelection({
 *     id,
 *     enableMultiSelect: true,
 *     selectedIds,
 *     lastSelectedId,
 *     itemIds,
 *     selectItem,
 *     toggleSelection,
 *     selectRange,
 *   });
 *
 *   return <Item onClick={handleClick}>...</Item>;
 * }
 * ```
 */
export function useItemSelection({
  id,
  enableMultiSelect = false,
  lastSelectedId,
  selectItem,
  toggleSelection,
  selectRange,
}: UseItemSelectionOptions) {
  const handleClick = useCallback(
    (e: MouseEvent) => {
      e.stopPropagation();

      if (enableMultiSelect) {
        if (e.ctrlKey || e.metaKey) {
          // Ctrl/Cmd + click: toggle selection
          toggleSelection(id);
        } else if (e.shiftKey && lastSelectedId) {
          // Shift + click: range selection
          selectRange(lastSelectedId, id);
        } else {
          // Regular click: select single
          selectItem(id);
        }
      } else {
        // Single select mode
        selectItem(id);
      }
    },
    [id, enableMultiSelect, lastSelectedId, selectItem, toggleSelection, selectRange]
  );

  return handleClick;
}

/**
 * Helper function to select a range of items
 * Used by ItemListContext to implement range selection
 */
export function getItemRange(itemIds: string[], fromId: string, toId: string): string[] {
  const fromIndex = itemIds.indexOf(fromId);
  const toIndex = itemIds.indexOf(toId);

  if (fromIndex === -1 || toIndex === -1) {
    return [toId];
  }

  const start = Math.min(fromIndex, toIndex);
  const end = Math.max(fromIndex, toIndex);

  return itemIds.slice(start, end + 1);
}
