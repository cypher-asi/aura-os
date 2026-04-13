import { useCallback, useEffect, useState } from "react";

export function useLeftMenuExpandedGroups(
  defaultExpandedIds: readonly string[],
): {
  expandedIds: string[];
  setGroupExpanded: (groupId: string, expanded: boolean) => void;
  toggleGroup: (groupId: string) => void;
} {
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => new Set());
  const [expandedIds, setExpandedIds] = useState<string[]>(() => [...defaultExpandedIds]);

  useEffect(() => {
    setExpandedIds((previousIds) => {
      const previousSet = new Set(previousIds);
      const nextIds = defaultExpandedIds.filter(
        (groupId) => !previousSet.has(groupId) && !collapsedIds.has(groupId),
      );
      return nextIds.length > 0 ? [...previousIds, ...nextIds] : previousIds;
    });
  }, [collapsedIds, defaultExpandedIds]);

  const setGroupExpanded = useCallback((groupId: string, expanded: boolean) => {
    setExpandedIds((previousIds) => {
      if (expanded) {
        return previousIds.includes(groupId) ? previousIds : [...previousIds, groupId];
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
      return nextIds;
    });
  }, []);

  const toggleGroup = useCallback(
    (groupId: string) => {
      setGroupExpanded(groupId, !expandedIds.includes(groupId));
    },
    [expandedIds, setGroupExpanded],
  );

  return { expandedIds, setGroupExpanded, toggleGroup };
}
