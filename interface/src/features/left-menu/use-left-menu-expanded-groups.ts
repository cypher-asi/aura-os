import { useCallback, useEffect, useMemo, useState } from "react";

export interface UseLeftMenuExpandedGroupsOptions {
  /**
   * Optional persistence adapter. When provided, the set of collapsed
   * group ids is seeded from `load()` on mount and written back on
   * every change via `save()`. Callers typically back this by
   * `localStorage` so the user's expand/collapse choices survive
   * reloads (see the Debug app).
   */
  persistence?: {
    load: () => readonly string[];
    save: (collapsedIds: string[]) => void;
  };
}

export function useLeftMenuExpandedGroups(
  defaultExpandedIds: readonly string[],
  options: UseLeftMenuExpandedGroupsOptions = {},
): {
  expandedIds: string[];
  setGroupExpanded: (groupId: string, expanded: boolean) => void;
  toggleGroup: (groupId: string) => void;
} {
  const { persistence } = options;
  const initialCollapsed = useMemo(
    () => new Set(persistence ? persistence.load() : []),
    // Only read from storage once on mount; later writes go through
    // `save()`. Re-running `load()` on every render would fight with
    // our own writes and reset transient UI state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(
    () => initialCollapsed,
  );
  const [expandedIds, setExpandedIds] = useState<string[]>(() =>
    defaultExpandedIds.filter((id) => !initialCollapsed.has(id)),
  );

  useEffect(() => {
    setExpandedIds((previousIds) => {
      const previousSet = new Set(previousIds);
      const nextIds = defaultExpandedIds.filter(
        (groupId) => !previousSet.has(groupId) && !collapsedIds.has(groupId),
      );
      return nextIds.length > 0 ? [...previousIds, ...nextIds] : previousIds;
    });
  }, [collapsedIds, defaultExpandedIds]);

  const setGroupExpanded = useCallback(
    (groupId: string, expanded: boolean) => {
      setExpandedIds((previousIds) => {
        if (expanded) {
          return previousIds.includes(groupId)
            ? previousIds
            : [...previousIds, groupId];
        }
        return previousIds.filter((existingId) => existingId !== groupId);
      });

      setCollapsedIds((previousIds) => {
        const nextIds = new Set(previousIds);
        if (expanded) {
          nextIds.delete(groupId);
        } else {
          nextIds.add(groupId);
        }
        if (persistence) persistence.save([...nextIds]);
        return nextIds;
      });
    },
    [persistence],
  );

  const toggleGroup = useCallback(
    (groupId: string) => {
      setGroupExpanded(groupId, !expandedIds.includes(groupId));
    },
    [expandedIds, setGroupExpanded],
  );

  return { expandedIds, setGroupExpanded, toggleGroup };
}
