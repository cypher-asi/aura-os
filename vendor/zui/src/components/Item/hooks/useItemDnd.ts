import { useState, useCallback } from 'react';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import type { UseItemDndOptions, UseItemDndReturn, DropPosition } from '../types';

/**
 * useItemDnd - Hook for drag-and-drop functionality on items
 *
 * Provides opt-in drag-drop support using @dnd-kit.
 * Can be used independently or combined with ItemListProvider.
 *
 * @example
 * ```tsx
 * function TreeItem({ id, hasChildren }) {
 *   const {
 *     setNodeRef,
 *     isDragging,
 *     isOver,
 *     dropPosition,
 *     dragAttributes,
 *     dragListeners,
 *     handleDragOver,
 *     handleDragLeave,
 *   } = useItemDnd({ id, enabled: true });
 *
 *   return (
 *     <Item
 *       ref={setNodeRef}
 *       {...dragAttributes}
 *       {...dragListeners}
 *       onDragOver={handleDragOver}
 *       onDragLeave={handleDragLeave}
 *       className={clsx(isDragging && 'dragging', isOver && 'dragOver')}
 *     >
 *       ...
 *     </Item>
 *   );
 * }
 * ```
 */
export function useItemDnd({
  id,
  enabled = true,
  disabled = false,
  data = {},
}: UseItemDndOptions): UseItemDndReturn {
  const [dropPosition, setDropPosition] = useState<DropPosition | null>(null);

  // Setup draggable
  const {
    attributes: dragAttributes,
    listeners: dragListeners,
    setNodeRef: setDraggableRef,
    isDragging,
  } = useDraggable({
    id,
    disabled: !enabled || disabled,
    data: {
      id,
      ...data,
    },
  });

  // Setup droppable
  const { setNodeRef: setDroppableRef, isOver } = useDroppable({
    id,
    disabled: !enabled || disabled,
    data: {
      id,
      ...data,
    },
  });

  // Combine refs for both draggable and droppable
  const setNodeRef = useCallback(
    (element: HTMLElement | null) => {
      setDraggableRef(element);
      setDroppableRef(element);
    },
    [setDraggableRef, setDroppableRef]
  );

  // Calculate drop position based on mouse Y position
  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      if (!enabled || disabled) return;

      const rect = e.currentTarget.getBoundingClientRect();
      const y = e.clientY - rect.top;
      const height = rect.height;
      const hasChildren = data.hasChildren as boolean | undefined;

      // Divide the item into zones for drop position
      if (hasChildren) {
        // For items with children: before (25%) | inside (50%) | after (25%)
        if (y < height * 0.25) {
          setDropPosition('before');
        } else if (y > height * 0.75) {
          setDropPosition('after');
        } else {
          setDropPosition('inside');
        }
      } else {
        // For leaf items: before (50%) | after (50%)
        if (y < height * 0.5) {
          setDropPosition('before');
        } else {
          setDropPosition('after');
        }
      }
    },
    [enabled, disabled, data.hasChildren]
  );

  // Clear drop position when drag leaves
  const handleDragLeave = useCallback(() => {
    setDropPosition(null);
  }, []);

  return {
    setNodeRef,
    isDragging,
    isOver,
    dropPosition,
    dragAttributes,
    dragListeners,
    handleDragOver,
    handleDragLeave,
  };
}
