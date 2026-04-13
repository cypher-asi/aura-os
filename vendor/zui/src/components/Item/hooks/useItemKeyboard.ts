import { useCallback, KeyboardEvent } from 'react';
import type { UseItemKeyboardOptions } from '../types';

/**
 * useItemKeyboard - Hook for keyboard navigation on items
 *
 * Provides keyboard handlers for:
 * - Enter/Space: Select item
 * - ArrowRight: Expand item (if has children and collapsed)
 * - ArrowLeft: Collapse item (if has children and expanded)
 *
 * @example
 * ```tsx
 * function TreeItem({ id, hasChildren, expanded }) {
 *   const handleKeyDown = useItemKeyboard({
 *     id,
 *     hasChildren,
 *     expanded,
 *     onSelect: (id) => selectItem(id),
 *     onToggleExpanded: (id) => toggleExpanded(id),
 *   });
 *
 *   return <Item onKeyDown={handleKeyDown}>...</Item>;
 * }
 * ```
 */
export function useItemKeyboard({
  id,
  disabled = false,
  hasChildren = false,
  expanded = false,
  onSelect,
  onToggleExpanded,
  expandOnSelect = false,
}: UseItemKeyboardOptions) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (disabled) return;

      switch (e.key) {
        case 'Enter':
        case ' ':
          e.preventDefault();
          if (onSelect) {
            onSelect(id);
          }
          // Optionally expand/collapse when selecting
          if (expandOnSelect && hasChildren && onToggleExpanded) {
            onToggleExpanded(id);
          }
          break;

        case 'ArrowRight':
          // Expand if collapsed and has children
          if (hasChildren && !expanded && onToggleExpanded) {
            e.preventDefault();
            onToggleExpanded(id);
          }
          break;

        case 'ArrowLeft':
          // Collapse if expanded and has children
          if (hasChildren && expanded && onToggleExpanded) {
            e.preventDefault();
            onToggleExpanded(id);
          }
          break;

        case 'ArrowUp':
          // Navigate to previous item (let parent handle this)
          break;

        case 'ArrowDown':
          // Navigate to next item (let parent handle this)
          break;

        case 'Home':
          // Navigate to first item (let parent handle this)
          break;

        case 'End':
          // Navigate to last item (let parent handle this)
          break;
      }
    },
    [id, disabled, hasChildren, expanded, onSelect, onToggleExpanded, expandOnSelect]
  );

  return handleKeyDown;
}
